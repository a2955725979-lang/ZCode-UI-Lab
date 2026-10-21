import { afterEach, describe, expect, it } from "vitest";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import type { MessageId, MessagePart, ProjectId, SessionId, WorkspaceId } from "@zcode/contracts";
import { zcodeProtocolMethods, type ZCodeProtocolMessage } from "@zcode/shared";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";

const WORKSPACE = "/fixture/workspace";
const stores: ReturnType<typeof createSqliteSessionStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function fixture() {
  const store = createSqliteSessionStore({ dbPath: ":memory:" });
  stores.push(store);
  // 只读分页绝不能构造 runtime；此函数被调用即为测试失败。
  const server = new ZCodeProtocolAgentServer({
    cwd: WORKSPACE,
    sessionStore: store,
    createZCodeApp: () => {
      throw new Error("task search activated runtime");
    },
  });
  return { server, store };
}

async function seed(
  store: ReturnType<typeof createSqliteSessionStore>,
  id: string,
  assistantText: string,
  workspaceIdentity?: string,
) {
  const sessionId = id as SessionId;
  await store.createSession({
    id: sessionId,
    projectID: "project_fixture" as ProjectId,
    ...(workspaceIdentity ? { workspaceID: workspaceIdentity as WorkspaceId } : {}),
    taskType: "interactive",
    slug: id,
    directory: WORKSPACE,
    path: WORKSPACE,
    title: id,
    version: "fixture",
    time: { created: 1, updated: 2 },
  });
  await store.saveMessage({
    id: `${id}_user` as MessageId,
    sessionID: sessionId,
    role: "user",
    time: { created: 1 },
    agent: "zcode-agent",
    model: { providerID: "glm" as never, modelID: "glm-5" as never },
    tools: {},
  });
  await store.savePart({
    id: `${id}_user_text` as MessagePart["id"],
    sessionID: sessionId,
    messageID: `${id}_user` as MessageId,
    type: "text",
    text: `问题 ${id} ::next-prompt{label="用户原文" prompt="保留"}`,
    time: { start: 1, end: 1 },
  });
  await store.saveMessage({
    id: `${id}_assistant` as MessageId,
    sessionID: sessionId,
    role: "assistant",
    time: { created: 2, completed: 2 },
    parentID: `${id}_user` as MessageId,
    providerID: "glm" as never,
    modelID: "glm-5" as never,
    mode: "build",
    agent: "zcode-agent",
    path: { cwd: WORKSPACE, root: WORKSPACE },
    cost: 0,
    tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  });
  await store.savePart({
    id: `${id}_assistant_text` as MessagePart["id"],
    sessionID: sessionId,
    messageID: `${id}_assistant` as MessageId,
    type: "text",
    text: assistantText,
    time: { start: 2, end: 2 },
  });
}

async function request(server: ZCodeProtocolAgentServer, params: unknown) {
  return server.handleMessage({
    id: "search",
    method: zcodeProtocolMethods.taskIndexReadPersistedSearchPage,
    params,
  } as ZCodeProtocolMessage);
}

describe("持久任务冷搜索页", () => {
  it("分页遍历 dormant 会话，严格隔离完整 workspace 身份并剥离助手建议", async () => {
    const { server, store } = fixture();
    await seed(store, "a", '回答 A\n::next-prompt{label="继续" prompt="下一步"}');
    await seed(store, "b", '回答 B\n::next-prompt{label="坏的"}');
    await seed(store, "remote", "远端机密", "wsl:host:/fixture/workspace");
    const first = await request(server, { workspacePath: WORKSPACE, limit: 1 });
    expect(first).toMatchObject({
      result: {
        complete: false,
        items: [{ sessionId: "a", searchableText: expect.stringContaining("回答 A") }],
      },
    });
    const firstResult = (
      first as { result: { nextCursor: string; items: Array<{ searchableText: string }> } }
    ).result;
    expect(firstResult.items[0]!.searchableText).toContain("用户原文");
    expect(firstResult.items[0]!.searchableText).not.toContain('label="继续"');
    const second = await request(server, {
      workspacePath: WORKSPACE,
      limit: 1,
      cursor: firstResult.nextCursor,
    });
    expect(second).toMatchObject({
      result: { complete: true, items: [{ sessionId: "b" }] },
    });
    const secondText = (second as { result: { items: Array<{ searchableText: string }> } }).result
      .items[0]!.searchableText;
    expect(secondText).toContain("回答 B");
    expect(secondText).not.toContain('label="坏的"');
    expect(
      await request(server, {
        workspacePath: WORKSPACE,
        workspaceIdentity: "other",
        cursor: firstResult.nextCursor,
      }),
    ).toMatchObject({
      error: { code: -32602 },
    });
  });
});
