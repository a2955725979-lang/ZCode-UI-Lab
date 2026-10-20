import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { parseFollowupSuggestions, type FollowupSuggestion } from "@zcode/shared";

export { parseFollowupSuggestions, stripFollowupSuggestionDirectives } from "@zcode/shared";
export type { FollowupSuggestion } from "@zcode/shared";

export function getLatestFollowupSuggestions(
  snapshot: ConversationSnapshot | null,
): readonly FollowupSuggestion[] {
  if (!snapshot || snapshot.control.phase !== "completedSuccess") return [];
  const rows = snapshot.rows.window;
  const latest = rows.filter((row) => row.kind === "turnHeader").at(-1);
  if (!latest || latest.state !== "completedSuccess") return [];
  const turnKey = latest.productTurnId ?? latest.turnId;
  const assistantRows = rows.filter(
    (row) => row.kind === "assistantText" && (row.productTurnId ?? row.turnId) === turnKey,
  );
  if (assistantRows.some((row) => row.kind === "assistantText" && row.state !== "complete"))
    return [];
  return parseFollowupSuggestions(
    assistantRows.map((row) => (row.kind === "assistantText" ? row.text : "")).join("\n"),
  ).suggestions;
}
