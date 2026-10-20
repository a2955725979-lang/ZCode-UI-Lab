// 兼容旧 UI 入口：解析规则由共享纯函数唯一维护，避免终端回放与 Web 分歧。
export {
  extractAssistantDirectives,
  findMarkdownCodeRanges,
  overlapsAssistantTextRanges,
  findUnclosedAssistantDirectiveStart,
  findAssistantDirectivePrefixStart,
} from "@zcode/shared";
export type {
  ParsedAssistantDirective,
  AssistantTextRange,
  AssistantDirectiveSyntaxOptions,
  AssistantDirectivePrefixOptions,
} from "@zcode/shared";
