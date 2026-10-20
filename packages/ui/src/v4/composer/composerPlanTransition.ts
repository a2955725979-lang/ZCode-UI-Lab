import type { V4ComposerDraft } from "@/v4/composer/composerDraftStore.js";
import type { SessionConfigState } from "@zcode/shared/zcode-protocol-v4";

/** 新工具结果设置 Plan；已消费集合阻止其它 owner 的旧快照反复覆盖手动选择。 */
export function applyComposerPlanTransition(
  draft: V4ComposerDraft,
  transition: SessionConfigState["planTransition"],
): V4ComposerDraft {
  if (
    !transition ||
    draft.lastPlanTransitionId === transition.toolCallId ||
    draft.consumedPlanTransitionIds?.includes(transition.toolCallId)
  )
    return draft;
  return {
    ...draft,
    lastPlanTransitionId: transition.toolCallId,
    // legacy lastId 也已经消费；不能只记新 ID，令另一旧 owner 再把它重放回来。
    consumedPlanTransitionIds: [
      ...new Set([
        ...(draft.consumedPlanTransitionIds ?? []),
        ...(draft.lastPlanTransitionId !== undefined ? [draft.lastPlanTransitionId] : []),
        transition.toolCallId,
      ]),
    ],
    planEnabled: transition.planEnabled,
  };
}
