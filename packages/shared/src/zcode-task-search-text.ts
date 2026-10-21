import type { ZCodeMessageWithParts } from "./zcode-protocol-legacy-types.js";
import { getZCodeUserVisibleMessages } from "./zcode-session-visible-content.js";
import { stripFollowupSuggestionDirectives } from "./followup-suggestions.js";

const TASK_SEARCH_TEXT_MAX_CHARS = 200_000;

/** 实时索引和冷历史回填共用同一正文投影，避免旧建议元数据重新进入搜索。 */
export function buildZCodeTaskSearchableText(
  messages: readonly ZCodeMessageWithParts[],
  options: Parameters<typeof getZCodeUserVisibleMessages>[1] = {},
): string {
  const parts: string[] = [];
  let total = 0;
  for (const message of getZCodeUserVisibleMessages(messages, options)) {
    if (message.info.role !== "user" && message.info.role !== "assistant") continue;
    const textParts = message.parts.filter((part) => part.type === "text");
    const chosen = message.info.role === "assistant" ? textParts.slice(-1) : textParts;
    for (const part of chosen) {
      const content =
        message.info.role === "assistant"
          ? stripFollowupSuggestionDirectives(part.text)
          : part.text;
      if (!content.trim()) continue;
      parts.push(content);
      total += content.length;
      if (total >= TASK_SEARCH_TEXT_MAX_CHARS) break;
    }
    if (total >= TASK_SEARCH_TEXT_MAX_CHARS) break;
  }
  return parts.join("\n").slice(0, TASK_SEARCH_TEXT_MAX_CHARS);
}
