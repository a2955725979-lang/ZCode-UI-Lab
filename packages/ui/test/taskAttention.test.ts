import { describe, expect, it } from "vitest";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { deriveTaskAttention, isTaskAttentionItem, taskAttentionKey } from "@/lib/taskAttention.js";
import { attachTaskListRowActivity, type TaskListRowActivity } from "@/v4/taskListRowActivity.js";

function task(overrides: Partial<ZCodeTaskMeta> = {}): ZCodeTaskMeta {
  return {
    taskId: "session-1",
    traceId: "trace-1",
    title: "Task",
    workspacePath: "/shared",
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    ...overrides,
  };
}
function active(meta: ZCodeTaskMeta, overrides: Partial<TaskListRowActivity> = {}) {
  return attachTaskListRowActivity(meta, {
    phase: "running",
    lastActivityAt: 1,
    hasBackgroundWork: false,
    ...overrides,
  });
}

describe("task attention facts", () => {
  it("uses the same case-insensitive plan approval semantics as the dialog", () => {
    expect(
      deriveTaskAttention(
        task({
          pendingInteraction: {
            kind: "userInput",
            interactionId: "plan",
            toolName: " exitplanmode ",
          },
        }),
      ),
    ).toEqual({ kind: "permission", interactionId: "plan" });
  });
  it("treats zero live counts as cleared even when metadata retains an old interaction", () => {
    const stale = task({ pendingInteraction: { kind: "userInput", interactionId: "old" } });
    expect(
      deriveTaskAttention(
        active(stale, { pendingInteractions: { permissionCount: 0, userInputCount: 0 } }),
      ),
    ).toBeNull();
    expect(deriveTaskAttention(stale)).toEqual({ kind: "userInput", interactionId: "old" });
  });
  it("uses live phases instead of a persisted previous error", () => {
    const oldError = task({ status: "error" });
    expect(deriveTaskAttention(active(oldError))).toBeNull();
    expect(deriveTaskAttention(active(oldError, { phase: "completedSuccess" }))).toBeNull();
    expect(deriveTaskAttention(oldError)).toEqual({ kind: "error" });
    expect(deriveTaskAttention(active(task(), { phase: "error" }))).toEqual({ kind: "error" });
  });
  it("uses live counts when old metadata identifies a different interaction", () => {
    const oldPermission = task({
      pendingInteraction: { kind: "permission", interactionId: "old-permission" },
    });
    expect(
      deriveTaskAttention(
        active(oldPermission, { pendingInteractions: { permissionCount: 0, userInputCount: 1 } }),
      ),
    ).toEqual({ kind: "userInput" });
  });
  it("keeps plan approval in confirmation and retains ordinary questions", () => {
    expect(
      deriveTaskAttention(
        task({
          pendingInteraction: {
            kind: "userInput",
            interactionId: "plan",
            toolName: "ExitPlanMode",
          },
        }),
      ),
    ).toEqual({ kind: "permission", interactionId: "plan" });
    expect(
      isTaskAttentionItem(
        task({
          pendingInteraction: {
            kind: "userInput",
            interactionId: "ask",
            toolName: "AskUserQuestion",
          },
        }),
      ),
    ).toBe(true);
    expect(isTaskAttentionItem(task())).toBe(false);
  });
  it("isolates identical paths and session IDs on different remote workspaces", () => {
    expect(taskAttentionKey(task({ workspaceIdentity: "remote:a" }))).not.toBe(
      taskAttentionKey(task({ workspaceIdentity: "remote:b" })),
    );
    expect(taskAttentionKey(task({ workspaceIdentity: "  " }))).toBe(taskAttentionKey(task()));
  });
});
