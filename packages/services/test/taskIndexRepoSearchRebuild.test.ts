import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDataBaseDir } from "../src/paths.js";
import { TaskIndexRepo } from "../src/session/taskIndexRepo.js";

let dir: string;
let repo: TaskIndexRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "task-search-rebuild-"));
  setDataBaseDir(dir);
  repo = new TaskIndexRepo();
});

afterEach(() => {
  repo.close();
  setDataBaseDir(null);
  rmSync(dir, { recursive: true, force: true });
});

const meta = (taskId: string, workspaceIdentity?: string) => ({
  taskId,
  traceId: `trace_${taskId}`,
  title: `标题 ${taskId}`,
  workspacePath: "/repo",
  ...(workspaceIdentity ? { workspaceIdentity } : {}),
  createdAt: 1,
  updatedAt: 2,
  mode: "build" as const,
  provider: "glm" as const,
});

describe("TaskIndexRepo 正文版本与冷历史 CAS", () => {
  it("空库在 CLI 明确完成枚举前仍报告未就绪", async () => {
    await expect(
      repo.queryTaskList({ workspaceScopes: [{ workspacePath: "/repo" }], search: "没有" }),
    ).rejects.toMatchObject({ code: "TASK_SEARCH_INDEX_NOT_READY" });
    await repo.markSearchRebuildComplete({ workspacePath: "/repo" });
    await expect(
      repo.queryTaskList({ workspaceScopes: [{ workspacePath: "/repo" }], search: "没有" }),
    ).resolves.toMatchObject({ total: 0 });
  });

  it("旧/缺正文版本显式未就绪，不能把空搜索结果当完成", async () => {
    await repo.seedTaskMetaIfMissing(meta("cold"));
    await expect(
      repo.queryTaskList({ workspaceScopes: [{ workspacePath: "/repo" }], search: "任意词" }),
    ).rejects.toMatchObject({ code: "TASK_SEARCH_INDEX_NOT_READY" });
    await repo.applyRebuiltSearchableText({
      workspacePath: "/repo",
      taskId: "cold",
      sourceRevision: "branch-a:1",
      searchableText: "任意词",
    });
    await repo.markSearchRebuildComplete({ workspacePath: "/repo" });
    await expect(
      repo.queryTaskList({ workspaceScopes: [{ workspacePath: "/repo" }], search: "任意词" }),
    ).resolves.toMatchObject({ total: 1 });
  });

  it("冷回填只更新待重建行，保留 live 正文和 pin/archive/title", async () => {
    await repo.seedTaskMetaIfMissing(meta("cold"));
    await repo.updateTaskState({
      workspacePath: "/repo",
      taskId: "cold",
      patch: { pinned: true, archived: true, title: "我改过的标题", titleOverridden: true },
    });
    expect(
      await repo.applyRebuiltSearchableText({
        workspacePath: "/repo",
        taskId: "cold",
        sourceRevision: "branch-a:1",
        searchableText: "原历史正文",
      }),
    ).toBe("applied");
    await repo.syncTaskMeta({ meta: meta("cold"), searchableText: "更新的 live 正文" });
    expect(
      await repo.applyRebuiltSearchableText({
        workspacePath: "/repo",
        taskId: "cold",
        sourceRevision: "branch-a:1",
        searchableText: "陈旧冷正文",
      }),
    ).toBe("already-current");
    const listed = await repo.listTaskMetas({ workspacePath: "/repo", includeDeleted: true });
    expect(listed[0]).toMatchObject({ title: "我改过的标题", titleOverridden: true });
    await repo.markSearchRebuildComplete({ workspacePath: "/repo" });
    const match = await repo.queryTaskList({
      workspaceScopes: [{ workspacePath: "/repo" }],
      kind: "archived",
      search: "live 正文",
    });
    expect(match.items[0]).toMatchObject({ taskId: "cold", searchSnippet: "更新的 live 正文" });
    expect(
      await repo.queryTaskList({
        workspaceScopes: [{ workspacePath: "/repo" }],
        kind: "archived",
        search: "陈旧冷正文",
      }),
    ).toMatchObject({ total: 0 });
  });

  it("workspace identity 和 deleted tombstone 不接受冷回填", async () => {
    await repo.seedTaskMetaIfMissing(meta("remote", "remote:one"));
    expect(
      await repo.applyRebuiltSearchableText({
        workspacePath: "/repo",
        workspaceIdentity: "remote:two",
        taskId: "remote",
        sourceRevision: "branch-a:1",
        searchableText: "不能串入",
      }),
    ).toBe("missing");
    await repo.updateTaskState({
      workspacePath: "/repo",
      workspaceIdentity: "remote:one",
      taskId: "remote",
      patch: { deleted: true },
    });
    expect(
      await repo.applyRebuiltSearchableText({
        workspacePath: "/repo",
        workspaceIdentity: "remote:one",
        taskId: "remote",
        sourceRevision: "branch-a:1",
        searchableText: "不能复活",
      }),
    ).toBe("deleted");
  });

  it("旧冷页不会覆盖随后到达的实时正文，rewind 以新 snapshot 为准", async () => {
    await repo.seedTaskMetaIfMissing(meta("rewind"));
    await repo.applyRebuiltSearchableText({
      workspacePath: "/repo",
      taskId: "rewind",
      sourceRevision: "a".repeat(64),
      searchableText: "旧分支文本",
    });
    await repo.syncTaskMeta({ meta: meta("rewind"), searchableText: "rewind 后实时文本" });
    expect(
      await repo.applyRebuiltSearchableText({
        workspacePath: "/repo",
        taskId: "rewind",
        sourceRevision: "b".repeat(64),
        searchableText: "过期冷页文本",
      }),
    ).toBe("already-current");
    await repo.markSearchRebuildComplete({ workspacePath: "/repo" });
    expect(
      await repo.queryTaskList({
        workspaceScopes: [{ workspacePath: "/repo" }],
        search: "rewind 后实时文本",
      }),
    ).toMatchObject({ total: 1 });
    expect(
      await repo.queryTaskList({
        workspaceScopes: [{ workspacePath: "/repo" }],
        search: "过期冷页文本",
      }),
    ).toMatchObject({ total: 0 });
  });

  it("已完成枚举后新建任务暂未就绪，live 正文落库后恢复搜索", async () => {
    await repo.markSearchRebuildComplete({ workspacePath: "/repo" });
    await repo.seedTaskMetaIfMissing(meta("new"));
    await expect(
      repo.queryTaskList({ workspaceScopes: [{ workspacePath: "/repo" }], search: "新内容" }),
    ).rejects.toMatchObject({ code: "TASK_SEARCH_INDEX_NOT_READY" });
    await repo.syncTaskMeta({ meta: meta("new"), searchableText: "新内容" });
    expect(
      await repo.queryTaskList({ workspaceScopes: [{ workspacePath: "/repo" }], search: "新内容" }),
    ).toMatchObject({ total: 1 });
  });

  it("已就绪后仅写元数据的新行也撤销就绪，跨列表分区检查 pending", async () => {
    await repo.markSearchRebuildComplete({ workspacePath: "/repo" });
    await repo.syncTaskMeta({ meta: meta("archived-new"), archived: true });
    await expect(
      repo.queryTaskList({
        workspaceScopes: [{ workspacePath: "/repo" }],
        kind: "active",
        search: "任何词",
      }),
    ).rejects.toMatchObject({ code: "TASK_SEARCH_INDEX_NOT_READY" });
    await repo.applyRebuiltSearchableText({
      workspacePath: "/repo",
      taskId: "archived-new",
      sourceRevision: "c".repeat(64),
      searchableText: "归档内容",
    });
    await expect(
      repo.queryTaskList({ workspaceScopes: [{ workspacePath: "/repo" }], search: "任何词" }),
    ).resolves.toMatchObject({ total: 0 });
  });
});
