// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ZCodeElicitationRequest } from "@zcode/shared";
import { ElicitationDialog, normalizeElicitationQuestions } from "@/ElicitationDialog.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";
import { shouldIgnoreEscapeForStopGeneration } from "@/v4/composer/escapeStop.js";

function request(requestId = "collaboration-ask"): ZCodeElicitationRequest {
  return {
    type: "elicitation_request",
    taskId: "collaboration-task",
    traceId: "trace",
    requestId,
    message: "第一题",
    options: [],
    questions: [
      {
        question: "第一题",
        header: "方案",
        options: [
          { value: "first", label: "方案一", preview: "<script>alert(1)</script>\n完整预览" },
        ],
      },
      { question: "第二题", header: "保障", options: [{ value: "second", label: "方案二" }] },
    ],
  };
}
function mount(props: Record<string, unknown> = {}) {
  return render(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(ElicitationDialog, { request: request(), onRespond: vi.fn(), ...props }),
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ordinary question collaboration", () => {
  it.each(["option", "textarea", "card", "collapsed", "plan"])(
    "keeps %s Escape from the window stop shortcut through the actual DOM event path",
    (target) => {
      const onRespond = vi.fn();
      const ask = request();
      if (target === "plan") ask.schema = { interaction: "plan_approval", toolName: "ExitPlanMode" };
      const { container } = mount({ request: ask, onRespond });
      const stop = vi.fn();
      const listener = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !shouldIgnoreEscapeForStopGeneration(event)) stop();
      };
      window.addEventListener("keydown", listener);
      try {
        const card = container.querySelector<HTMLDivElement>("[data-elicitation-dialog-card]")!;
        if (target === "collapsed") fireEvent.keyDown(card, { key: "Escape" });
        const element = target === "option" || target === "plan"
          ? container.querySelector('button[role="option"]')!
          : target === "textarea" ? container.querySelector("textarea")!
          : target === "collapsed" ? container.querySelector('button[aria-label="展开: 第一题"]')!
          : card;
        fireEvent.keyDown(element, { key: "Escape" });
        expect(stop).not.toHaveBeenCalled();
        if (target === "plan") expect(onRespond.mock.calls[0]?.[1]).toBe("decline");
        else expect(onRespond).not.toHaveBeenCalled();
        const composer = document.createElement("textarea");
        container.append(composer);
        fireEvent.keyDown(composer, { key: "Escape" });
        expect(stop).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener("keydown", listener);
      }
    },
  );
  it("keeps card focus programmatic and expands from the whole collapsed summary", () => {
    const { container } = mount();
    const card = container.querySelector<HTMLDivElement>("[data-elicitation-dialog-card]")!;
    expect(card.tabIndex).toBe(-1);
    card.focus();
    expect(document.activeElement).toBe(card);
    fireEvent.keyDown(card, { key: "Escape" });
    const summaries = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-expanded="false"][aria-label="展开: 第一题"]',
    );
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.getAttribute("aria-label")).toBe("展开: 第一题");
    expect(summaries[0]!.textContent).toContain("1 / 2");
    expect(summaries[0]!.querySelector("button")).toBeNull();
    fireEvent.click(summaries[0]!.querySelector("span span:last-child")!);
    expect(
      container.querySelector("[data-elicitation-dialog-body]")?.classList.contains("hidden"),
    ).toBe(false);
    const option = container.querySelector<HTMLButtonElement>('button[role="option"]')!;
    expect(option.hasAttribute("data-slot")).toBe(false);
  });
  it("distinguishes question-text and whole-card labels in both locales", () => {
    expect(zhCN["chat.elicitation.expandQuestion"]).toBe("展开全文");
    expect(zhCN["chat.elicitation.collapseQuestion"]).toBe("收起全文");
    expect(zhCN["chat.elicitation.expandDialog"]).toBe("展开");
    expect(zhCN["chat.elicitation.collapseDialog"]).toBe("收起");
    expect(enUS["chat.elicitation.expandQuestion"]).toBe("Show full question");
    expect(enUS["chat.elicitation.collapseQuestion"]).toBe("Hide full question");
    expect(enUS["chat.elicitation.expandDialog"]).toBe("Expand");
    expect(enUS["chat.elicitation.collapseDialog"]).toBe("Collapse");
  });
  it.each([false, true])("mobile text-input viewport=%s controls keyboard hints", (mobile) => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: mobile && query.includes("max-width: 767px"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { container } = mount();
    const hint = container.querySelector("[data-elicitation-dialog-footer] > p")!;
    expect(hint.classList.contains("hidden")).toBe(mobile);
    expect(hint.className).toContain("[@media(hover:none)]:hidden");
  });
  it("preserves option preview as inert text", () => {
    expect(normalizeElicitationQuestions(request())[0]?.options[0]?.preview).toContain("完整预览");
    const { container } = mount();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
  });
  it("Enter advances text; Shift+Enter preserves newlines; shortcut submits partial answers with IME protection", () => {
    const onRespond = vi.fn();
    const { container } = mount({ onRespond });
    const input = container.querySelector("textarea")!;
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(onRespond).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe("第一题");
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe("第二题");
    fireEvent.keyDown(container.querySelector("textarea")!, { key: "Enter", ctrlKey: true });
    expect(onRespond).toHaveBeenCalledWith("collaboration-ask", "accept", {
      answers: { 第一题: "第一行\n第二行" },
      answer_0: "第一行\n第二行",
    });
  });
  it("selects and advances choices; final Enter submits immediately", () => {
    const onRespond = vi.fn();
    const { container } = mount({ onRespond });
    fireEvent.click(container.querySelector('button[role="option"]')!);
    expect(container.querySelector("textarea")?.getAttribute("aria-label")).toBe("第二题");
    const finalOption = container.querySelector('button[role="option"]')!;
    fireEvent.focus(finalOption);
    fireEvent.keyDown(finalOption, { key: "Enter" });
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith("collaboration-ask", "accept", {
      answers: { 第一题: "first", 第二题: "second" },
      answer_0: "first",
      answer_1: "second",
    });
  });
  it("multi-choice Space toggles and final Enter submits selected answers", () => {
    const onRespond = vi.fn();
    const multi = request();
    multi.questions = [{ ...multi.questions![0]!, multiSelect: true }];
    const { container } = mount({ request: multi, onRespond });
    const option = container.querySelector('button[role="checkbox"]')!;
    fireEvent.focus(option);
    fireEvent.keyDown(option, { key: " " });
    expect(option.getAttribute("aria-checked")).toBe("true");
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.keyDown(option, { key: "Enter" });
    expect(onRespond).toHaveBeenCalledWith("collaboration-ask", "accept", {
      answers: { 第一题: "first" },
      answer_0: ["first"],
      answer: ["first"],
    });
  });
  it("Escape toggles the inline card at all widths without response and retains the draft", () => {
    const onRespond = vi.fn();
    const onFirstInteraction = vi.fn();
    const { container } = mount({ onRespond, onFirstInteraction });
    const card = container.querySelector('[data-elicitation-dialog-card="true"]')!;
    fireEvent.keyDown(card, { key: "Escape" });
    expect(onFirstInteraction).toHaveBeenCalledWith("navigation");
    const body = container.querySelector('[data-elicitation-dialog-body="true"]')!;
    expect(body.classList.contains("hidden")).toBe(true);
    fireEvent.keyDown(card, { key: "Escape" });
    expect(body.classList.contains("hidden")).toBe(false);
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "保留草稿" } });
    fireEvent.keyDown(card, { key: "Escape" });
    fireEvent.keyDown(card, { key: "Escape" });
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("保留草稿");
    expect(container.querySelector("[data-elicitation-defer]")).toBeNull();
    expect(onRespond).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('[data-elicitation-skip="true"]')!);
    expect(onRespond).toHaveBeenCalledWith("collaboration-ask", "accept", { answers: {} });
  });
  it("shows failure with retained answer and disables response actions while pending", () => {
    const { container, rerender } = mount();
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "保留草稿" } });
    rerender(
      createElement(
        ZCodeIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(ElicitationDialog, {
          request: request(),
          onRespond: vi.fn(),
          responding: true,
          responseError: "提交失败，请重试",
        }),
      ),
    );
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("保留草稿");
    expect(
      container.querySelector<HTMLButtonElement>('[data-elicitation-submit="true"]')?.disabled,
    ).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("提交失败");
  });
});
