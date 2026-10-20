import { describe, expect, it } from "vitest";
import type { ToolCallRow } from "@zcode/shared/zcode-protocol-v4";
import type { ConversationTurnWorkSegment } from "@/v4/conversationTurnWorkSegments.js";
import { resolveChatHistoryDefaultOpen } from "@/v4/chatWorkDisclosure.js";
function segment(status: ToolCallRow["status"]): ConversationTurnWorkSegment {
  return {
    key: "turn",
    flowItems: [],
    assistantHistoryRows: [],
    assistantFollowingRows: [],
    assistantHistoryDefaultOpen: true,
    workStatus: { state: "running" },
    assistantWorkRows: [
      {
        rowId: 1,
        createdAt: 1,
        createdAtSeq: 1,
        turnId: "turn",
        kind: "toolCall",
        toolCallId: "tool",
        toolName: "Read",
        status,
        input: {},
      } as ToolCallRow,
    ],
  };
}
describe("Chat live work disclosure", () => {
  it("folds routine running detail while preserving Work behavior", () => {
    expect(resolveChatHistoryDefaultOpen(segment("running"), true)).toBe(false);
    expect(resolveChatHistoryDefaultOpen(segment("running"), false)).toBe(true);
  });
  it.each(["pendingApproval", "error", "cancelled"] as const)(
    "keeps %s evidence visible",
    (status) => {
      expect(resolveChatHistoryDefaultOpen(segment(status), true)).toBe(true);
    },
  );
  it("keeps interrupted history open", () => {
    expect(
      resolveChatHistoryDefaultOpen(
        { ...segment("success"), workStatus: { state: "interrupted" } },
        true,
      ),
    ).toBe(true);
  });
});
