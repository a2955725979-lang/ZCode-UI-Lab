import { describe, expect, it } from "vitest";
import {
  parseFollowupSuggestions as sharedParse,
  stripFollowupSuggestionDirectives as sharedStrip,
} from "@zcode/shared";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import {
  getLatestFollowupSuggestions,
  parseFollowupSuggestions,
  stripFollowupSuggestionDirectives,
} from "@/v4/followupSuggestions.js";
import { normalizeConversationShareMarkdown } from "@/v4/conversationShareMarkdown.js";

const directive = '::next-prompt{label="检查结果" prompt="请检查结果并说明依据"}';
const suggestion = { label: "检查结果", prompt: "请检查结果并说明依据" };

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

describe("next-prompt suffix metadata", () => {
  it("旧 UI API 直接复用同一共享纯函数", () => {
    expect(parseFollowupSuggestions).toBe(sharedParse);
    expect(stripFollowupSuggestionDirectives).toBe(sharedStrip);
  });
  it.each([0, 1, 3, 4])("只提取末尾连续指令，最多三条：%i", (count) => {
    const content = ["已完成", ...Array<string>(count).fill(directive)].join("\n\n");
    const expected = { text: "已完成", suggestions: Array(Math.min(count, 3)).fill(suggestion) };
    expect(parseFollowupSuggestions(`${content}\n\n`)).toEqual(
      count ? expected : { ...expected, text: `${content}\n\n` },
    );
    expect(stripFollowupSuggestionDirectives(content)).toBe("已完成");
    expect(normalizeConversationShareMarkdown(content)).toBe("已完成");
  });

  it.each([
    '::next-prompt{label="缺少正文"}',
    '::next-prompt{label="" prompt="正文"}',
    "::next-prompt{broken stuff}",
    '::next-prompt{label="a" prompt="b" unexpected="x"}',
    `${directive} 尾随正文`,
    '::next-prompt{label="未闭合',
  ])("畸形尾候选移除正文但不生成按钮：%s", (tail) => {
    for (const streaming of [false, true]) {
      expect(parseFollowupSuggestions(`正文😀\n${tail}`, { streaming })).toEqual({
        text: "正文😀",
        suggestions: [],
      });
      expect(stripFollowupSuggestionDirectives(`正文😀\n${tail}`, { streaming })).toBe("正文😀");
    }
    expect(normalizeConversationShareMarkdown(`正文😀\n${tail}`)).toBe("正文😀");
    expect(getLatestFollowupSuggestions(snapshot("completedSuccess", `正文😀\n${tail}`))).toEqual(
      [],
    );
  });

  it("合法与畸形候选混合时剥离整个尾部，只把合法项变成按钮", () => {
    const malformed = '::next-prompt{label="Only label"}';
    const content = `正文\n${directive}\n\n${malformed}\n${directive}\n`;
    expect(parseFollowupSuggestions(content)).toEqual({
      text: "正文",
      suggestions: [suggestion, suggestion],
    });
    expect(normalizeConversationShareMarkdown(content)).toBe("正文");
  });

  it("跨物理行的候选不是连续尾部，保留整段示例", () => {
    const text = '::next-prompt{label="检查" prompt="第一行\n第二行"}';
    expect(parseFollowupSuggestions(text)).toEqual({ text, suggestions: [] });
    expect(parseFollowupSuggestions(text, { streaming: true })).toEqual({ text, suggestions: [] });
  });

  it.each([
    `${directive}\n后面仍有正文`,
    "::next-prompt{broken}\n后面仍有正文",
    `正文里的 ${directive}`,
    `\`${directive}\``,
    `\`\`\`text\n${directive}\n\`\`\``,
    "```text\n::next-prompt{broken}\n```",
    `~~~text\n${directive}`,
    `> ${directive}`,
    "> 引用示例\n::next-prompt{broken}",
    `> 引用示例\n${directive}`,
    `- ${directive}`,
    "- 列表示例\n::next-prompt{broken}",
    `1. 列表示例\n${directive}`,
    `- 列表示例\n\n  ${directive}`,
    `    ${directive}`,
    `\t${directive}`,
  ])("正文、代码块、引用和列表示例保留：%s", (text) => {
    for (const streaming of [false, true]) {
      expect(parseFollowupSuggestions(text, { streaming })).toEqual({ text, suggestions: [] });
      expect(stripFollowupSuggestionDirectives(text, { streaming })).toBe(text);
    }
  });

  it.each(["> 引用\n>", "> > 引用\n> >", "-", "1.", "* * *"])(
    "空容器段落或分隔线之后的顶层尾指令可提取：%s",
    (body) => {
      expect(parseFollowupSuggestions(`${body}\n${directive}`)).toEqual({
        text: body,
        suggestions: [suggestion],
      });
    },
  );

  it("代码和引用结束后才提取顶层后缀，正文中间的同名指令仍保留", () => {
    const body = `正文\n${directive}\n仍有正文\n\n> 引用\n${directive}\n\n\`\`\`\n${directive}\n\`\`\``;
    const content = `${body}\n\n${directive}`;
    expect(parseFollowupSuggestions(content)).toEqual({ text: body, suggestions: [suggestion] });
    expect(normalizeConversationShareMarkdown(content)).toBe(body);
  });

  it.each([
    "::",
    "::next",
    "::next-prompt",
    '::next-prompt{label="检查',
    '::next-prompt{label="检查" prompt="',
  ])("流式只隐藏下一步指令前缀：%s", (tail) => {
    expect(parseFollowupSuggestions(`正文\n${tail}`, { streaming: true })).toEqual({
      text: "正文",
      suggestions: [],
    });
    expect(stripFollowupSuggestionDirectives(`正文\n${tail}`)).toBe(
      tail.startsWith("::next-prompt{") ? "正文" : `正文\n${tail}`,
    );
    expect(parseFollowupSuggestions(`正文\n${tail}\n后文`, { streaming: true }).text).toBe(
      `正文\n${tail}\n后文`,
    );
    for (const prefix of ["```text\n", "> 引用\n", "- 列表\n"]) {
      const text = `${prefix}${tail}`;
      expect(parseFollowupSuggestions(text, { streaming: true })).toEqual({
        text,
        suggestions: [],
      });
    }
  });

  it.each(["::other", "::next-else", "::next-prompt-extra", "::next-prompt body"])(
    "流式分叉前缀和其它命令保持可见：%s",
    (tail) => {
      const text = `正文\n${tail}`;
      expect(parseFollowupSuggestions(text, { streaming: true })).toEqual({
        text,
        suggestions: [],
      });
    },
  );

  it("流式未闭合尾行之前的完整建议仍可解析", () => {
    expect(
      parseFollowupSuggestions(`正文\n${directive}\n::next-prompt{label="`, { streaming: true }),
    ).toEqual({ text: "正文", suggestions: [suggestion] });
  });

  it.each(["\r\n", "\r", "\n"])("CRLF/LF使用原文偏移，不改正文换行：%j", (newline) => {
    const body = `正文😀${newline}第二行`;
    expect(parseFollowupSuggestions(`${body}${newline}${directive}${newline}${newline}`)).toEqual({
      text: body,
      suggestions: [suggestion],
    });
    const example = `- 引用😀${newline}${directive}`;
    expect(parseFollowupSuggestions(example)).toEqual({ text: example, suggestions: [] });
    const malformed = `正文😀${newline}第二行${newline}::next-prompt{label="x"}`;
    expect(parseFollowupSuggestions(malformed)).toEqual({
      text: body,
      suggestions: [],
    });
  });

  it("参数中的引号、反斜杠、花括号与Markdown按共享语法转义", () => {
    const prompt = '检查 C:\\path 的 "quoted" 值和 }，保留 `code`';
    const escape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const label = '检查"引用';
    expect(
      parseFollowupSuggestions(
        `::next-prompt{label="${escape(label)}" prompt="${escape(prompt)}"}`,
      ),
    ).toEqual({ text: "", suggestions: [{ label, prompt }] });
  });

  it("只取最新正常完成轮，失败、中断、运行及新轮不回退旧建议", () => {
    expect(getLatestFollowupSuggestions(snapshot())).toEqual([suggestion]);
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
    const incomplete = snapshot();
    (incomplete.rows.window[1] as { state: string }).state = "streaming";
    expect(getLatestFollowupSuggestions(incomplete)).toEqual([]);
    expect(getLatestFollowupSuggestions(null)).toEqual([]);
  });
});
