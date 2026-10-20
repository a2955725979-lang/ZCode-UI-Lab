import { isV4PlanApproval } from "@/v4/pendingInteractionAdapter.js";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { getTaskListAttention, getTaskListRowActivity } from "@/v4/taskListRowActivity.js";

export interface TaskAttention {
  kind: "userInput" | "permission" | "error";
  interactionId?: string;
}

/** Controller/sessions-index 为实时事实；旧 meta 仅在相应事实缺席时兼容。 */
export function deriveTaskAttention(task: ZCodeTaskMeta): TaskAttention | null {
  const activity = getTaskListRowActivity(task);
  if (activity?.phase === "error") return { kind: "error" };
  const pending = task.pendingInteraction;
  const liveAttention = getTaskListAttention(task);
  // 显式零计数代表交互已收口，不能再用 meta 的旧 pendingInteraction 点亮入口。
  const hasLiveSummary = activity?.pendingInteractions !== undefined;
  const kind = liveAttention?.kind ?? (!hasLiveSummary ? pending?.kind : undefined);
  if (kind) {
    const isPlanApproval =
      kind === "userInput" && pending !== undefined && isV4PlanApproval(pending);
    return {
      kind: isPlanApproval ? "permission" : kind,
      ...(pending?.kind === kind ? { interactionId: pending.interactionId } : {}),
    };
  }
  // 运行或成功的新 phase 覆盖 tasks-index 持久化的上次错误，不能误报旧失败。
  return !activity && task.status === "error" ? { kind: "error" } : null;
}

/** 模块级稳定 predicate：跨 Chat/Work，仅供 Controller 既有列表投影筛选。 */
export function isTaskAttentionItem(task: ZCodeTaskMeta): boolean {
  return deriveTaskAttention(task) !== null;
}

export function taskAttentionKey(
  task: Pick<ZCodeTaskMeta, "workspacePath" | "workspaceIdentity" | "taskId">,
): string {
  return JSON.stringify([task.workspaceIdentity?.trim() || task.workspacePath, task.taskId]);
}
