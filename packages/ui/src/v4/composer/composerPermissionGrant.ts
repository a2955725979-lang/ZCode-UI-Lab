import type { V4ComposerDraft } from "@/v4/composer/composerDraftStore.js";
import type { SessionConfigState } from "@zcode/shared/zcode-protocol-v4";

/** 只消费明确审批事实；重复快照不能把用户后来改回的权限再刷成 yolo。 */
export function applyComposerPermissionGrant(
  draft: V4ComposerDraft,
  grant: SessionConfigState["permissionGrant"],
): V4ComposerDraft {
  if (
    !grant ||
    draft.lastPermissionGrantId === grant.interactionId ||
    draft.consumedPermissionGrantIds?.includes(grant.interactionId)
  )
    return draft;
  // 只比较单个 lastId 会使 G1/G2 两个 owner 的快照来回改写授权；集合随草稿持久化。
  return {
    ...draft,
    mode: "yolo",
    lastPermissionGrantId: grant.interactionId,
    consumedPermissionGrantIds: [
      ...new Set([
        ...(draft.consumedPermissionGrantIds ?? []),
        ...(draft.lastPermissionGrantId !== undefined ? [draft.lastPermissionGrantId] : []),
        grant.interactionId,
      ]),
    ],
  };
}
