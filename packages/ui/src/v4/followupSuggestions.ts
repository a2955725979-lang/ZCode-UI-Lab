import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { Lexer } from "marked";
import {
  extractAssistantDirectives,
  findAssistantDirectivePrefixStart,
  findMarkdownCodeRanges,
  findUnclosedAssistantDirectiveStart,
  overlapsAssistantTextRanges,
  type AssistantTextRange,
} from "@/lib/assistantDirectiveParser.js";

export interface FollowupSuggestion {
  label: string;
  prompt: string;
}

function findMarkdownExampleRanges(
  content: string,
  omitted: readonly AssistantTextRange[] = [],
): AssistantTextRange[] {
  // 已接受的 metadata 不属于正文。仅在分析副本中删除，避免参数里的 Markdown 延伸到后续指令。
  // 不能用空格等长遮蔽：同一行后续内容会被人为推成缩进代码。保留每个 UTF-16 字符的原文起止位置。
  let source = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let omittedIndex = 0;
  for (let index = 0; index < content.length; index += 1) {
    const range = omitted[omittedIndex];
    if (range && index === range[0]) {
      index = range[1] - 1;
      omittedIndex += 1;
      continue;
    }
    starts.push(index);
    const character = content[index]!;
    if (character === "\r") {
      if (content[index + 1] === "\n") index += 1;
      source += "\n";
    } else {
      source += character;
    }
    ends.push(index + 1);
  }
  const ranges: AssistantTextRange[] = [];
  const protect = (start: number, end: number) => {
    if (end > start) ranges.push([starts[start]!, ends[end - 1]!]);
  };
  for (const [start, end] of findMarkdownCodeRanges(source)) protect(start, end);
  for (const match of source.matchAll(/^(?: {4}|\t).*$/gm)) {
    const start = match.index ?? 0;
    protect(start, start + match[0].length);
  }
  // 普通列表续行是 list 内的 text；完整保护根容器，由 lexer 决定 loose/lazy 内容的结束位置。
  let cursor = 0;
  const tokens = Lexer.lex(source);
  for (const [index, token] of tokens.entries()) {
    let end = cursor + token.raw.length;
    if (!source.startsWith(token.raw, cursor)) {
      // Marked 的末尾 list raw 会把最终空格改为换行；只容许最后一块的纯尾空白差异。
      // 不搜索后方相同 raw，任何正文差异仍保守地保护原文。
      if (index !== tokens.length - 1 || source.slice(cursor).trimEnd() !== token.raw.trimEnd())
        return [[0, content.length]];
      end = source.length;
    }
    if (token.type === "blockquote" || token.type === "code" || token.type === "list") {
      protect(cursor, end);
    }
    cursor = end;
  }
  return ranges;
}

/** Metadata shares the assistant directive grammar, but examples remain ordinary Markdown. */
export function parseFollowupSuggestions(
  content: string,
  options: { streaming?: boolean } = {},
): {
  text: string;
  suggestions: readonly FollowupSuggestion[];
} {
  let protectedRanges = findMarkdownExampleRanges(content);
  let markdownContextChanged = false;
  const suggestions: FollowupSuggestion[] = [];
  const removed: AssistantTextRange[] = [];
  const directives = extractAssistantDirectives(content, "next-prompt");
  for (const directive of directives) {
    const parameters = directive.parameters;
    if (!parameters || Object.keys(parameters).length !== 2) continue;
    const label = parameters.label?.trim();
    const prompt = parameters.prompt?.trim();
    if (!label || !prompt) continue;
    if (markdownContextChanged) {
      protectedRanges = findMarkdownExampleRanges(content, removed);
      markdownContextChanged = false;
    }
    // 只判断指令开头的 Markdown 归属；参数里的清单/代码不应屏蔽本条或后续顶层 metadata。
    if (overlapsAssistantTextRanges(directive.start, directive.start + 1, protectedRanges))
      continue;
    if (suggestions.length < 3) suggestions.push({ label, prompt });
    removed.push([directive.start, directive.end]);
    markdownContextChanged = true;
  }
  if (options.streaming) {
    if (markdownContextChanged) protectedRanges = findMarkdownExampleRanges(content, removed);
    // 完整但非法的指令也不是流式尾部。排除所有完整指令，防止扫描参数内嵌套半截协议时吞掉后文。
    // 仍扫描原文，不因分析副本拼接产生新协议起点；非法指令在 Markdown 分析/正文中保留。
    const streamingProtectedRanges: AssistantTextRange[] = [
      ...protectedRanges,
      ...directives.map(({ start, end }) => [start, end] as const),
    ];
    const incomplete = findUnclosedAssistantDirectiveStart(
      content,
      "next-prompt",
      streamingProtectedRanges,
    );
    const prefix = findAssistantDirectivePrefixStart(
      content,
      ["next-prompt"],
      streamingProtectedRanges,
    );
    const hiddenTail = Math.min(incomplete ?? content.length, prefix ?? content.length);
    if (hiddenTail < content.length) removed.push([hiddenTail, content.length]);
  }
  if (removed.length === 0) return { text: content, suggestions };
  let text = "";
  let cursor = 0;
  for (const [start, end] of removed.sort(([left], [right]) => left - right)) {
    if (start >= cursor) text += content.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  text += content.slice(cursor);
  return { text: text.replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, "\n\n").trimEnd(), suggestions };
}

/** Use for timeline, clipboard and share: protocol metadata is never user prose. */
export function stripFollowupSuggestionDirectives(
  content: string,
  options: { streaming?: boolean } = {},
): string {
  return parseFollowupSuggestions(content, options).text;
}

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
