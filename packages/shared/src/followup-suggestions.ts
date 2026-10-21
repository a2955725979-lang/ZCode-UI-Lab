import { extractAssistantDirectives } from "./assistant-directive-parser.js";

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
  // 修复原因：原先任何 :: 尾行都会暂隐，误吞其它命令；只暂隐尚未写完的协议名称。
  if (options.streaming && tail?.topLevel && "::next-prompt".startsWith(tail.text)) {
    suffixStart = tail.start;
    index -= 1;
    skipBlankLines();
  }
  while (index >= 0) {
    const line = lines[index]!;
    if (!line.topLevel || !line.text.startsWith("::next-prompt{")) break;
    // 修复原因：畸形参数会让旧实现停止扫描，使协议尾部泄漏到渲染、复制和分享。
    // 候选行一律剥离；只有完整有效的参数才生成可点击建议。
    const suggestion = parseSuggestionLine(line.text);
    if (suggestion) suggestions.unshift(suggestion);
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
