import type { ConversationTurnWorkSegment } from "@/v4/conversationTurnWorkSegments.js";

/** Chat folds routine live detail, but never approval, error or interrupted evidence. */
export function resolveChatHistoryDefaultOpen(
  segment: ConversationTurnWorkSegment,
  isChatMode: boolean,
): boolean {
  if (!isChatMode || segment.workStatus?.state !== "running") {
    return segment.assistantHistoryDefaultOpen;
  }
  return segment.assistantWorkRows.some(
    (row) =>
      row.kind === "toolCall" &&
      (row.status === "pendingApproval" || row.status === "error" || row.status === "cancelled"),
  );
}
