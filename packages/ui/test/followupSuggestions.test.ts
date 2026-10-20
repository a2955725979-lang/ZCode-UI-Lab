import { describe, expect, it } from "vitest";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import {
  getLatestFollowupSuggestions,
  parseFollowupSuggestions,
  stripFollowupSuggestionDirectives,
} from "@/v4/followupSuggestions.js";

import { normalizeConversationShareMarkdown } from "@/v4/conversationShareMarkdown.js";

const directive = '::next-prompt{label="检查结果" prompt="请检查结果并说明依据"}';
function snapshot(state = "completedSuccess", text = directive): ConversationSnapshot {
  return {
    control: { phase: state },
    rows: {
      window: [
        { kind: "turnHeader", rowId: 1, turnId: "a", state },
        { kind: "assistantText", rowId: 2, turnId: "a", state: "complete", text },
      ],
    },
  } as unknown as ConversationSnapshot;
}
describe("next-prompt metadata", () => {
  it("提取最多三个建议，同时从正文中移除所有合法metadata", () => {
    const parsed = parseFollowupSuggestions(`已完成\n${Array(4).fill(directive).join("\n")}`);
    expect(parsed.suggestions).toHaveLength(3);
    expect(parsed.suggestions[0]).toEqual({ label: "检查结果", prompt: "请检查结果并说明依据" });
    expect(parsed.text).toBe("已完成");
    expect(stripFollowupSuggestionDirectives(directive)).toBe("");
  });
  it.each([
    `\`${directive}\``,
    `\`\`\`\n${directive}\n\`\`\``,
    `> ${directive}`,
    `    ${directive}`,
    `\t${directive}`,
    `- 示例\n\n\t\t${directive}`,
    `> 示例：\n${directive}`,
    `> 外层\n> > 内层\n${directive}`,
    `- > 引用示例：\n  ${directive}`,
    `- 示例\n\n  \`\`\`markdown\n  ${directive}\n  \`\`\``,
    `- 示例\n\n      ${directive}`,
    `> 引用😀\r\n${directive}`,
  ])("代码和引用示例保留原文 %s", (text) => {
    expect(parseFollowupSuggestions(text)).toEqual({ text, suggestions: [] });
  });
  it("空行结束引用后仍可提取真实 metadata，复制和分享保留引用示例", () => {
    const example = `> 示例：\n${directive}`;
    const content = `${example}\n\n${directive}`;
    expect(parseFollowupSuggestions(content)).toEqual({
      text: example,
      suggestions: [{ label: "检查结果", prompt: "请检查结果并说明依据" }],
    });
    expect(stripFollowupSuggestionDirectives(content)).toBe(example);
  });
  it("流式引用中的未完成 metadata 仍属于示例正文", () => {
    const content = '> 示例：\n::next-prompt{label="检查" prompt="';
    expect(parseFollowupSuggestions(content, { streaming: true })).toEqual({
      text: content,
      suggestions: [],
    });
  });
  it.each([
    "::next",
    "::next-prompt",
    '::next-prompt{label="检查',
    '::next-prompt{label="检查" prompt="',
  ])("流式前缀 %s 不泄露协议残片", (tail) => {
    expect(parseFollowupSuggestions(`正文\n${tail}`, { streaming: true }).text).toBe("正文");
    expect(stripFollowupSuggestionDirectives(`正文\n${tail}`)).toBe(`正文\n${tail}`);
  });
  it.each([
    '::next-prompt{label="缺少正文"}',
    '::next-prompt{label="" prompt="正文"}',
    "::next-prompt{broken stuff}",
    '::next-prompt{label="a" prompt="b" unexpected="x"}',
  ])("非法metadata保留可读原文 %s", (text) => {
    expect(parseFollowupSuggestions(text)).toEqual({ text, suggestions: [] });
  });
  it("转义引号和反斜杠按共享directive parser解析", () => {
    expect(
      parseFollowupSuggestions('::next-prompt{label="检查\\\"引用" prompt="检查 C:\\path"}')
        .suggestions,
    ).toEqual([{ label: '检查"引用', prompt: "检查 C:\\path" }]);
  });
  it("只取最新正常完成轮；失败、中断、运行和后续新轮不回退旧建议", () => {
    expect(getLatestFollowupSuggestions(snapshot())).toHaveLength(1);
    for (const state of ["error", "failed", "completedInterrupted", "running"])
      expect(getLatestFollowupSuggestions(snapshot(state))).toEqual([]);
    const newer = snapshot();
    newer.rows.window.push({
      kind: "turnHeader",
      rowId: 3,
      turnId: "b",
      state: "completedSuccess",
    } as never);
    expect(getLatestFollowupSuggestions(newer)).toEqual([]);
    expect(getLatestFollowupSuggestions(null)).toEqual([]);
  });
});

describe("next-prompt Markdown list boundaries", () => {
  const suggestion = { label: "检查结果", prompt: "请检查结果并说明依据" };
  it.each([
    `- 示例：\n${directive}`,
    `+ 示例：\n${directive}`,
    `* 示例：\n${directive}`,
    `1. 示例：\n${directive}`,
    `2) 示例：\n${directive}`,
    `10. 示例：\n${directive}`,
    `- [ ] 示例：\n${directive}`,
    `- ${directive}`,
    `- 示例：\n  ${directive}`,
    `- 示例：\n\n  ${directive}`,
    `1. 示例：\n\n   ${directive}`,
    `- 外层\n  - 内层\n${directive}`,
    `- 一项\n- 另一项\n${directive}`,
    `-\t示例：\n${directive}`,
    `- 示例：\n\n\t${directive}`,
    `- 示例😀：\r\n${directive}`,
    `1. 示例😀：\r${directive}`,
  ])("列表正文保留、不转成建议：%s", (content) => {
    for (const streaming of [false, true]) {
      expect(parseFollowupSuggestions(content, { streaming })).toEqual({
        text: content,
        suggestions: [],
      });
      expect(stripFollowupSuggestionDirectives(content, { streaming })).toBe(content);
    }
  });

  it.each([
    "- 示例：\n\n",
    "- 示例：\n\n ",
    "1. 示例：\n\n  ",
    "-\n",
    "\t- 示例\n",
    "- 示例：\n# 分隔\n",
    "- 示例：\n\n---\n",
    "- 示例：\n\n  ```\n  代码示例\n  ```\n",
  ])("列表已结束时仍提取顶层metadata：%s", (prefix) => {
    const content = `${prefix}${directive}`;
    expect(parseFollowupSuggestions(content)).toEqual({
      text: prefix.trimEnd(),
      suggestions: [suggestion],
    });
    expect(stripFollowupSuggestionDirectives(content)).toBe(prefix.trimEnd());
  });

  it.each([
    `- 示例：\n${directive}`,
    `1. 示例：\n${directive}`,
    `- 示例😀\r\n${directive}\n\n# 分隔\n\n- 示例😀\n${directive}`,
    `- 示例😀\r${directive}\n\n# 分隔\n\n- 示例😀\n${directive}`,
  ])("相同列表示例和真实metadata分别映射：%s", (example) => {
    const content = `${example}\n\n${directive}`;
    expect(parseFollowupSuggestions(content)).toEqual({
      text: example,
      suggestions: [suggestion],
    });
    expect(stripFollowupSuggestionDirectives(content)).toBe(example);
    expect(normalizeConversationShareMarkdown(content)).toBe(example);
    expect(getLatestFollowupSuggestions(snapshot("completedSuccess", content))).toEqual([
      suggestion,
    ]);
  });

  it.each(["- 示例：\n", "1. 示例😀：\r\n"])("列表内每个流式前缀保留原文：%s", (prefix) => {
    for (let length = 1; length <= directive.length; length += 1) {
      const content = `${prefix}${directive.slice(0, length)}`;
      expect(parseFollowupSuggestions(content, { streaming: true }), content).toEqual({
        text: content,
        suggestions: [],
      });
      expect(stripFollowupSuggestionDirectives(content, { streaming: true })).toBe(content);
    }
  });

  it("列表外半截metadata仍按流式规则暂存", () => {
    const example = `- 示例：\n${directive}`;
    expect(parseFollowupSuggestions(`${example}\n\n::next`, { streaming: true })).toEqual({
      text: example,
      suggestions: [],
    });
  });
});

describe("next-prompt top-level parameter context", () => {
  it.each([
    "请按清单复核：\n- 第一项\n- 第二项",
    "请按步骤复核：\n1. 第一项\n2. 第二项",
    "比较 `A` 和 `B`",
    "保留引用示例：\n> 样例",
    "查看代码示例：\n```\nexample\n```",
  ])("参数里的Markdown不改变顶层指令归属：%s", (prompt) => {
    const content = `::next-prompt{label="检查" prompt="${prompt}"}`;
    expect(parseFollowupSuggestions(content)).toEqual({
      text: "",
      suggestions: [{ label: "检查", prompt }],
    });
    expect(stripFollowupSuggestionDirectives(content)).toBe("");
    expect(normalizeConversationShareMarkdown(content)).toBe("");
    expect(parseFollowupSuggestions(content.slice(0, -2), { streaming: true }).text).toBe("");
  });
});

describe("next-prompt metadata isolates its parameter Markdown", () => {
  const suggestion = { label: "检查结果", prompt: "请检查结果并说明依据" };
  const prompts = [
    "按清单：\n- 第一\n- 第二",
    "按顺序：\r\n1. 第一\r\n2. 第二",
    "引用：\n> 示例",
    "代码：\n```\nexample\n```",
    "未闭合代码：\n```\nexample",
    "未闭合行内代码：`example",
  ];
  const metadata = (prompt: string) => `::next-prompt{label="步骤" prompt="${prompt}"}`;

  it.each(prompts)("连续合法metadata不受前一参数影响：%s", (prompt) => {
    for (const separator of ["", " ", "\n", "\r\n"]) {
      const content = `${metadata(prompt)}${separator}${directive}`;
      expect(parseFollowupSuggestions(content), separator).toEqual({
        text: "",
        suggestions: [{ label: "步骤", prompt }, suggestion],
      });
      expect(stripFollowupSuggestionDirectives(content)).toBe("");
      expect(normalizeConversationShareMarkdown(content)).toBe("");
    }
  });

  it.each(prompts)("参数后真实Markdown示例仍保留：%s", (prompt) => {
    for (const example of [
      `- 示例：\n${directive}`,
      `2. 示例：\n${directive}`,
      `> 示例：\n${directive}`,
      `\`\`\`\n${directive}\n\`\`\``,
      `    ${directive}`,
    ]) {
      for (const separator of ["", "\n", "\r\n"]) {
        const content = `${metadata(prompt)}${separator}${example}`;
        const expected = {
          text: `${separator}${example}`,
          suggestions: [{ label: "步骤", prompt }],
        };
        expect(parseFollowupSuggestions(content), `${separator}${example}`).toEqual(expected);
        expect(stripFollowupSuggestionDirectives(content)).toBe(expected.text);
        expect(normalizeConversationShareMarkdown(content)).toBe(expected.text);
      }
    }
  });

  it.each(prompts)("参数后的每个真实流式前缀不泄露：%s", (prompt) => {
    for (let length = 2; length < directive.length; length += 1) {
      const content = `${metadata(prompt)}\n${directive.slice(0, length)}`;
      expect(parseFollowupSuggestions(content, { streaming: true })).toEqual({
        text: "",
        suggestions: [{ label: "步骤", prompt }],
      });
    }
  });

  it.each(["嵌套 ::next-prompt{", "嵌套 ::next", '嵌套 ::next-prompt{label=\\"示例'])(
    "已接受参数内的半截协议不会截断后续正文：%s",
    (prompt) => {
      const first = metadata(prompt);
      for (const body of ["\n后续正文", `\n${directive}\n后续正文`]) {
        const suggestions = [{ label: "步骤", prompt: prompt.replace(/\\"/g, '"') }];
        if (body.includes(directive)) suggestions.push(suggestion);
        const expected = { text: body.replace(directive, ""), suggestions };
        expect(parseFollowupSuggestions(`${first}${body}`, { streaming: true })).toEqual(expected);
        expect(parseFollowupSuggestions(`${first}${body}\n::next`, { streaming: true })).toEqual({
          ...expected,
          text: expected.text.trimEnd(),
        });
      }
    },
  );

  it("展示数量达到上限后仍隔离参数，并保留后方真实列表示例", () => {
    const example = `- 示例：\n${directive}`;
    const content = `${Array(4).fill(metadata(prompts[0]!)).join("\n")}\n${example}`;
    const parsed = parseFollowupSuggestions(content);
    expect(parsed.suggestions).toEqual(Array(3).fill({ label: "步骤", prompt: prompts[0] }));
    expect(parsed.text.trimStart()).toBe(example);
    expect(parseFollowupSuggestions(`${content}\n\n::next`, { streaming: true })).toEqual(parsed);
  });
});

describe("next-prompt lexer final whitespace mapping", () => {
  it.each([" ", "  ", "\t", "\n ", "\r\n\t", "\r  "])("列表末尾空白仅影响raw尾部：%j", (tail) => {
    for (const marker of ["-", "2."]) {
      const content = `${marker} 示例😀\r\n${directive}${tail}`;
      expect(parseFollowupSuggestions(content, { streaming: true })).toEqual({
        text: content,
        suggestions: [],
      });
      expect(stripFollowupSuggestionDirectives(content)).toBe(content);
    }
  });
});

describe("next-prompt complete invalid directives are not streaming tails", () => {
  it.each([
    'label="" prompt="嵌套 ::next-prompt{"',
    'label="缺字段 ::next-prompt{"',
    'label="检查" prompt="嵌套 ::next-prompt{" unexpected="x"',
    'broken prompt="嵌套 ::next-prompt{"',
    'label="" prompt="嵌套 ::next"',
    'label="" prompt="嵌套 ::next-prompt{label=\\"样例"',
  ])("完整非法参数保留原文，不吞后续正文：%s", (parameters) => {
    const invalid = `::next-prompt{${parameters}}`;
    const content = `${invalid}\n后续正文`;
    for (const streaming of [false, true]) {
      expect(parseFollowupSuggestions(content, { streaming })).toEqual({
        text: content,
        suggestions: [],
      });
      expect(stripFollowupSuggestionDirectives(content, { streaming })).toBe(content);
    }
    expect(normalizeConversationShareMarkdown(content)).toBe(content);
    expect(parseFollowupSuggestions(`${content}\n::next`, { streaming: true })).toEqual({
      text: content,
      suggestions: [],
    });
    expect(
      parseFollowupSuggestions(`${invalid}\n${directive}\n后续正文`, { streaming: true }),
    ).toEqual({
      text: `${invalid}\n\n后续正文`,
      suggestions: [{ label: "检查结果", prompt: "请检查结果并说明依据" }],
    });
  });
});
