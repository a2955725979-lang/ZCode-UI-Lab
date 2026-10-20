// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement, useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { ConversationComposer } from "@/v4/ConversationComposer.js";
import { V4InteractionDialogs } from "@/v4/V4InteractionDialogs.js";

const { sendCommand, inputFocus, updateContent } = vi.hoisted(() => ({
  sendCommand: vi.fn(),
  inputFocus: vi.fn(),
  updateContent: vi.fn(),
}));
vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({ sendCommand }),
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/prompt-editor/ChatPromptEditor.js", () => ({
  ChatPromptEditor: (props: Record<string, unknown>) => {
    const editor = useRef<HTMLTextAreaElement | null>(null);
    const api = props.inputApiRef as { current: Record<string, unknown> };
    api.current = {
      focus: () => {
        inputFocus();
        editor.current?.focus();
      },
      clear: vi.fn(),
      getEditorState: () => null,
      getMarkdown: () => "",
      setEditorStateJson: vi.fn(),
      setText: vi.fn(),
    };
    return createElement(
      "div",
      null,
      props.topContent as ReactNode,
      createElement("textarea", {
        ref: editor,
        "data-testid": "retained-editor",
        onChange: (event: { target: { value: string } }) =>
          (props.onChange as (value: string) => void)(event.target.value),
        onKeyDown: (event: { key: string }) => {
          if (event.key === "Enter")
            (props.onSubmit as (value: string) => void)(editor.current?.value ?? "");
        },
      }),
      props.leadingActions as ReactNode,
    );
  },
}));
vi.mock("@/v4/composer/V4ComposerToolbar.js", () => ({
  V4ComposerModeSwitch: () => null,
  V4ComposerModelControls: () => null,
}));
vi.mock("@/v4/composer/useComposerAttachments.js", () => ({
  useComposerAttachments: () => ({
    attachmentInputRef: { current: null },
    attachments: [],
    attachmentError: null,
    hasAttachments: false,
    hasUnreadyAttachments: false,
    isDraggingOverComposer: false,
    adoptSentAttachments: vi.fn(),
    clearAttachments: vi.fn(),
    handleAttachmentInputChange: vi.fn(),
    handleDragLeaveComposer: vi.fn(),
    handleDragOverComposer: vi.fn(),
    handleDropComposer: vi.fn(),
    handlePaste: vi.fn(),
    handleWhiteboardMentionSelected: vi.fn(),
    openAttachmentPicker: vi.fn(),
    prepareForSend: vi.fn(async () => []),
    removeAttachment: vi.fn(),
    retryAttachment: vi.fn(),
    setAttachmentError: vi.fn(),
  }),
}));

type FixtureProps = {
  requestId?: string | null;
  active?: boolean;
  disabled?: boolean;
  sessionId?: string;
  workspaceIdentity?: string;
  showCard?: boolean;
  workDraft?: boolean;
  briefEnabled?: boolean;
  onSendText?: (text: string, options: unknown) => Promise<unknown>;
};
let serial = 0;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const noop = () => {};
const draft = { text: "保留原草稿", updatedAt: 1 };

function Fixture({
  requestId = null,
  active = true,
  disabled = false,
  sessionId = "focus-session",
  workspaceIdentity = "focus-workspace",
  showCard = true,
  workDraft = false,
  briefEnabled = true,
  onSendText = vi.fn(),
}: FixtureProps) {
  const interactionFocusBoundaryRef = useRef<HTMLDivElement | null>(null);
  const snapshot = {
    sessionId,
    pendingInteractions: requestId
      ? [
          {
            interactionId: requestId,
            kind: "userInput",
            anchorRowId: null,
            createdAt: 1,
            payload: {
              kind: "userInput",
              toolName: "AskUserQuestion",
              prompt: "请回答",
              freeText: true,
              questions: [
                {
                  question: "如何执行？",
                  header: "方案",
                  options: [{ value: "first", label: "方案一" }],
                },
              ],
            },
          },
        ]
      : [],
  } as ConversationSnapshot;
  return createElement(
    ZCodeIntlProvider,
    { initialLocale: "zh-CN" },
    createElement(
      "div",
      { ref: interactionFocusBoundaryRef },
      showCard
        ? createElement(V4InteractionDialogs, {
            sessionId,
            workspacePath: "/focus-workspace",
            workspaceIdentity,
            isActive: active,
            snapshot,
          })
        : null,
    ),
    createElement(ConversationComposer, {
      snapshot: null,
      sessionId,
      workspacePath: "/focus-workspace",
      workspaceIdentity,
      blockingRequestId: requestId,
      interactionFocusBoundaryRef,
      autoFocusEnabled: active,
      disabled,
      composerDraft: workDraft
        ? {
            ...draft,
            taskStart: { outcome: "可复核", deliverable: "报告", constraints: "保留原件" },
          }
        : draft,
      draftMode: workDraft,
      workMode: workDraft,
      workTaskBriefEnabled: briefEnabled,
      updateComposerContent: updateContent,
      replaceComposerDraft: noop,
      attachmentPut: vi.fn(),
      onSendText,
      onStop: noop,
      onSelectModel: noop,
      onSelectThought: noop,
      onSwitchMode: noop,
    }),
  );
}

async function flushFrames() {
  // 不依赖真实时钟：只推进已排队的 RAF，验证执行当拍的门控。
  await act(async () => {
    while (frames.size > 0) {
      const callbacks = Array.from(frames.values());
      frames.clear();
      for (const callback of callbacks) callback(0);
    }
  });
}
function setVisible(visible: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visible ? "visible" : "hidden",
  });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}
function focusOption(container: HTMLElement) {
  const option = container.querySelector<HTMLButtonElement>('button[role="option"]')!;
  act(() => option.focus());
  return option;
}
function editor(container: HTMLElement) {
  return container.querySelector<HTMLTextAreaElement>('[data-testid="retained-editor"]')!;
}
function outsideInput() {
  const outside = document.createElement("input");
  outside.dataset.testid = "outside";
  document.body.append(outside);
  return outside;
}
beforeEach(() => {
  serial += 1;
  frames.clear();
  inputFocus.mockClear();
  updateContent.mockClear();
  sendCommand.mockReset();
  sendCommand.mockImplementation(async (envelope) => ({
    commandId: envelope.commandId,
    status: "accepted",
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  setVisible(true);
});
afterEach(() => {
  cleanup();
  document.querySelector('[data-testid="outside"]')?.remove();
  vi.unstubAllGlobals();
});

describe("retained composer focus after inline interaction", () => {
  it("returns owned focus only after authoritative clear, without changing the retained draft", async () => {
    const view = render(createElement(Fixture));
    await flushFrames();
    const retainedEditor = editor(view.container);
    expect(document.activeElement).toBe(retainedEditor);
    inputFocus.mockClear();
    view.rerender(createElement(Fixture, { requestId: `answer-${serial}` }));
    const option = focusOption(view.container);
    fireEvent.keyDown(option, { key: "Enter" });
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    await flushFrames();
    expect(
      view.container.querySelector<HTMLElement>('[data-testid="v4-composer"]')!.style.display,
    ).toBe("none");
    expect(inputFocus).not.toHaveBeenCalled();
    view.rerender(createElement(Fixture));
    await flushFrames();
    expect(document.activeElement).toBe(retainedEditor);
    expect(inputFocus).toHaveBeenCalledTimes(1);
    expect(updateContent).not.toHaveBeenCalled();
  });

  it("supports initial pending card ownership and consecutive requests without focusing hidden composer", async () => {
    const view = render(createElement(Fixture, { requestId: `initial-${serial}` }));
    focusOption(view.container);
    await flushFrames();
    expect(inputFocus).not.toHaveBeenCalled();
    view.rerender(createElement(Fixture, { requestId: `next-${serial}` }));
    focusOption(view.container);
    await flushFrames();
    expect(inputFocus).not.toHaveBeenCalled();
    view.rerender(createElement(Fixture));
    await flushFrames();
    expect(document.activeElement).toBe(editor(view.container));
    expect(inputFocus).toHaveBeenCalledTimes(1);
  });

  it("does not let deferred initial draft restoration invent ownership after an untouched request clears", async () => {
    const view = render(
      createElement(Fixture, { requestId: `untouched-${serial}`, showCard: false }),
    );
    view.rerender(createElement(Fixture));
    await flushFrames();
    expect(inputFocus).not.toHaveBeenCalled();
  });

  it("keeps answers and card focus after failure", async () => {
    sendCommand.mockRejectedValueOnce(new Error("offline"));
    const view = render(createElement(Fixture, { requestId: `failure-${serial}` }));
    const input = view.container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "保留答案" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(view.container.textContent).toContain("提交失败"));
    await flushFrames();
    expect(input.value).toBe("保留答案");
    expect(document.activeElement).toBe(input);
    expect(inputFocus).not.toHaveBeenCalled();
  });

  it.each(["focus", "pointer"] as const)(
    "does not reclaim focus after outside %s, even when outside focus later falls back to body",
    async (navigation) => {
      const view = render(createElement(Fixture, { requestId: `outside-${serial}` }));
      focusOption(view.container);
      const outside = outsideInput();
      if (navigation === "focus") act(() => outside.focus());
      else fireEvent.pointerDown(outside);
      act(() => outside.blur());
      view.rerender(createElement(Fixture));
      await flushFrames();
      expect(inputFocus).not.toHaveBeenCalled();
    },
  );

  it.each(["inactive", "hidden", "workspace", "session"] as const)(
    "cancels ownership across %s changes",
    async (change) => {
      const requestId = `cancel-${serial}`;
      const view = render(createElement(Fixture, { requestId }));
      focusOption(view.container);
      if (change === "hidden") setVisible(false);
      const changed: FixtureProps =
        change === "inactive"
          ? { active: false }
          : // 新 scope 的卡片尚未投影；若它正常获得焦点，应拥有自己新的归还意图。
            change === "workspace"
            ? { workspaceIdentity: "different-workspace", showCard: false }
            : change === "session"
              ? { sessionId: "different-session", showCard: false }
              : {};
      view.rerender(createElement(Fixture, { ...changed, requestId }));
      await flushFrames();
      inputFocus.mockClear();
      view.rerender(createElement(Fixture, { ...changed, requestId: null }));
      await flushFrames();
      expect(inputFocus).not.toHaveBeenCalled();
      if (change === "hidden") setVisible(true);
      if (change === "inactive") view.rerender(createElement(Fixture, { active: true }));
      await flushFrames();
      expect(inputFocus).not.toHaveBeenCalled();
    },
  );

  it.each(["inactive", "hidden", "outside", "next-request"] as const)(
    "rechecks %s after focus return was queued",
    async (change) => {
      const view = render(createElement(Fixture, { requestId: `frame-${serial}` }));
      focusOption(view.container);
      view.rerender(createElement(Fixture));
      expect(frames.size).toBeGreaterThan(0);
      if (change === "inactive") view.rerender(createElement(Fixture, { active: false }));
      if (change === "hidden") setVisible(false);
      if (change === "outside") act(() => outsideInput().focus());
      if (change === "next-request")
        view.rerender(createElement(Fixture, { requestId: `frame-next-${serial}` }));
      await flushFrames();
      expect(inputFocus).not.toHaveBeenCalled();
    },
  );

  it("defers owned return until editable and cancels stale mount focus when a request arrives", async () => {
    const view = render(createElement(Fixture));
    // 挂载恢复先排帧，问题在它执行前到达。
    view.rerender(createElement(Fixture, { requestId: `late-${serial}` }));
    focusOption(view.container);
    await flushFrames();
    expect(inputFocus).not.toHaveBeenCalled();
    view.rerender(createElement(Fixture, { disabled: true }));
    await flushFrames();
    expect(inputFocus).not.toHaveBeenCalled();
    view.rerender(createElement(Fixture));
    await flushFrames();
    expect(document.activeElement).toBe(editor(view.container));
    expect(inputFocus).toHaveBeenCalledTimes(1);
  });
});

describe("Work brief submission through the retained composer", () => {
  it.each([false, true])(
    "brief setting=%s controls the actual outgoing prompt",
    async (briefEnabled) => {
      const onSendText = vi.fn(async () => ({ status: "accepted" }));
      const view = render(createElement(Fixture, { workDraft: true, briefEnabled, onSendText }));
      await flushFrames();
      const toggle = view.container.querySelector<HTMLButtonElement>(
        '[data-testid="work-task-brief-toggle"]',
      );
      expect(Boolean(toggle)).toBe(briefEnabled);
      if (toggle) {
        expect(toggle.getAttribute("aria-label")).toBe("任务简报（已填写）");
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(toggle.querySelector('[data-testid="work-task-brief-filled"]')).not.toBeNull();
      }
      fireEvent.change(editor(view.container), { target: { value: "整理资料" } });
      fireEvent.keyDown(editor(view.container), { key: "Enter" });
      await waitFor(() => expect(onSendText).toHaveBeenCalledTimes(1));
      expect(onSendText.mock.calls[0]?.[0]).toBe(
        briefEnabled
          ? "整理资料\n\n预期结果：可复核\n交付形式：报告\n约束与边界：保留原件"
          : "整理资料",
      );
    },
  );
  it("disabling an expanded brief hides it without writing or clearing stored fields", async () => {
    const view = render(createElement(Fixture, { workDraft: true }));
    await flushFrames();
    fireEvent.click(view.container.querySelector('[data-testid="work-task-brief-toggle"]')!);
    expect(view.container.querySelectorAll('[data-testid="work-task-brief"] input')).toHaveLength(
      3,
    );
    expect(view.container.querySelector('[data-testid="work-task-brief"] textarea')).toBeNull();
    const writesBefore = updateContent.mock.calls.length;
    view.rerender(createElement(Fixture, { workDraft: true, briefEnabled: false }));
    expect(view.container.querySelector('[data-testid="work-task-brief"]')).toBeNull();
    expect(updateContent.mock.calls.length).toBe(writesBefore);
    view.rerender(createElement(Fixture, { workDraft: true, briefEnabled: true }));
    expect(
      view.container.querySelector<HTMLInputElement>('[data-testid="work-task-brief-outcome"]')
        ?.value,
    ).toBe("可复核");
  });
});
