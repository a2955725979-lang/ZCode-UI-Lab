// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTextRow } from "@zcode/shared/zcode-protocol-v4";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { ConversationRowView } from "@/v4/ConversationRowView.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import { normalizeConversationShareMarkdown } from "@/v4/conversationShareMarkdown.js";

const context: ConversationRowRenderContext = {
  workspacePath: "/workspace",
  theme: "system",
  codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
};

function assistantRow(
  text: string,
  state: "complete" | "streaming" = "complete",
): AssistantTextRow {
  return {
    rowId: 9,
    entityId: "assistant-9",
    turnId: "turn-1",
    createdAt: 1_700_000_000_000,
    createdAtSeq: 9,
    kind: "assistantText",
    state,
    text,
  };
}

function rowView(row: AssistantTextRow) {
  return createElement(
    TooltipProvider,
    null,
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(ConversationRowView, { context, row }),
    ),
  );
}

function mount(row: AssistantTextRow) {
  return render(rowView(row));
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("next-prompt real conversation projection", () => {
  it("完成态实际渲染和复制按钮只消费正文，分享投影同样去掉畸形尾候选", () => {
    const copy = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: copy },
    });
    const text = '可见正文😀\r\n::next-prompt{label="Only label"}';
    const { container } = mount(assistantRow(text));

    const selectable = container.querySelector('[data-conversation-selectable="true"]');
    expect(selectable?.textContent).toContain("可见正文😀");
    expect(selectable?.textContent).not.toContain("::next-prompt");
    expect(normalizeConversationShareMarkdown(text)).toBe("可见正文😀");

    fireEvent.click(screen.getByTestId("v4-copy-9"));
    expect(copy).toHaveBeenCalledWith("可见正文😀");
  });

  it("流式实际渲染保留其它双冒号命令，只暂隐下一步指令名称前缀", () => {
    const { container, rerender } = mount(assistantRow("正文\n::other", "streaming"));
    const selectable = () => container.querySelector('[data-conversation-selectable="true"]');
    expect(selectable()?.textContent).toContain("::other");

    rerender(rowView(assistantRow("正文\n::next", "streaming")));
    expect(selectable()?.textContent).toContain("正文");
    expect(selectable()?.textContent).not.toContain("::next");
  });
});
