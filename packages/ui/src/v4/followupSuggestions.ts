import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { extractAssistantDirectives } from "@/lib/assistantDirectiveParser.js";

export interface FollowupSuggestion {
  label: string;
  prompt: string;
}

interface AssistantLine {
  start: number;
  text: string;
  topLevel: boolean;
}

function assistantLines(content: string): AssistantLine[] {
  const lines: AssistantLine[] = [];
  let fence: string | null = null;
  let containerParagraph = false;
  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    const text = match[0].replace(/[\r\n]+$/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    const blank = text.trim().length === 0;
    const container = /^ {0,3}(?:>|(?:[-+*]|\d+[.)])(?:[\t ]|$))/.test(text);
    const blockBoundary = /^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-*_][\t ]*){3,}$)/.test(text);
    const emptyContainer = /^ {0,3}(?:>[\t ]*)*(?:>|[-+*]|\d+[.)])[\t ]*$/.test(text);
    if (blank || blockBoundary || emptyContainer) containerParagraph = false;
    // 无空行的引用/列表续行仍属于示例；不再借 Markdown lexer 重建原文及 UTF-16 映射。
    const topLevel = !fence && !marker && !container && !containerParagraph && !/^[\t ]/.test(text);
    lines.push({ start: match.index, text, topLevel });
    if (marker) {
      if (!fence) fence = marker;
      else if (
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        /^ {0,3}(?:`+|~+)[\t ]*$/.test(text)
      )
        fence = null;
      containerParagraph = false;
    } else if (container && !emptyContainer && !blockBoundary) containerParagraph = true;
  }
  return lines;
}

function parseSuggestionLine(text: string): FollowupSuggestion | null {
  if (!text.startsWith("::next-prompt{")) return null;
  const [directive] = extractAssistantDirectives(text, "next-prompt");
  if (!directive || directive.start !== 0 || directive.end !== text.trimEnd().length) return null;
  const parameters = directive.parameters;
  if (!parameters || Object.keys(parameters).length !== 2) return null;
  const label = parameters.label?.trim();
  const prompt = parameters.prompt?.trim();
  return label && prompt ? { label, prompt } : null;
}

function hasClosingBrace(text: string): boolean {
  let quote: string | null = null;
  let escaped = false;
  for (const character of text) {
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === "}") return true;
  }
  return false;
}

/** Only a contiguous top-level suffix is metadata; examples and body text stay intact. */
export function parseFollowupSuggestions(
  content: string,
  options: { streaming?: boolean } = {},
): { text: string; suggestions: readonly FollowupSuggestion[] } {
  const lines = assistantLines(content);
  const suggestions: FollowupSuggestion[] = [];
  let index = lines.length - 1;
  let suffixStart = content.length;
  const skipBlankLines = () => {
    while (index >= 0 && !lines[index]!.text.trim()) index -= 1;
  };
  skipBlankLines();
  const tail = lines[index];
  // 流式暂存仅限最后一行；不能从正文里的未闭合指令吞掉后续段落。
  if (
    options.streaming &&
    tail?.topLevel &&
    tail.text.startsWith("::") &&
    !hasClosingBrace(tail.text)
  ) {
    suffixStart = tail.start;
    index -= 1;
    skipBlankLines();
  }
  while (index >= 0) {
    const line = lines[index]!;
    const suggestion = line.topLevel ? parseSuggestionLine(line.text) : null;
    if (!suggestion) break;
    suggestions.unshift(suggestion);
    suffixStart = line.start;
    index -= 1;
    skipBlankLines();
  }
  return {
    text: suffixStart < content.length ? content.slice(0, suffixStart).trimEnd() : content,
    suggestions: suggestions.slice(0, 3),
  };
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
