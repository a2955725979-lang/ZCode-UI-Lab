// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { V4InteractionDialogs } from "@/v4/V4InteractionDialogs.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import {
  consumeTaskInteractionOpenRequest,
  getTaskInteractionOpenRequest,
  requestTaskInteractionOpen,
} from "@/v4/taskAttentionNavigation.js";
const { sendCommand } = vi.hoisted(() => ({ sendCommand: vi.fn() }));
vi.mock("@/v4/V4ConversationContext.js", () => ({ useV4Conversation: () => ({ sendCommand }) }));
let serial = 0;
function snapshot(id: string, sessionId = "collaboration-session"): ConversationSnapshot {
  return {
    sessionId,
    pendingInteractions: [
      {
        interactionId: id,
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
    ],
  } as ConversationSnapshot;
}
function ui(state: ConversationSnapshot, extra: Record<string, unknown> = {}) {
  return createElement(
    ZCodeIntlProvider,
    { initialLocale: "zh-CN" },
    createElement(V4InteractionDialogs, {
      sessionId: state.sessionId,
      workspacePath: "/collaboration-workspace",
      snapshot: state,
      ...extra,
    }),
  );
}
function submit() {
  fireEvent.click(document.querySelector('[data-elicitation-submit="true"]')!);
}
beforeEach(() => {
  serial += 1;
  sendCommand.mockReset();
  sendCommand.mockImplementation(async (envelope) => ({
    commandId: envelope.commandId,
    status: "accepted",
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
  cleanup();
  const pending = getTaskInteractionOpenRequest();
  if (pending) consumeTaskInteractionOpenRequest(pending);
  vi.unstubAllGlobals();
});

describe("V4 ordinary question presentation and response lifecycle", () => {
  it("renders inline, collapses without response, and retains the draft across expansion and remount", async () => {
    const state = snapshot(`inline-${serial}`);
    const view = render(ui(state));
    const card = view.container.querySelector("[data-elicitation-dialog-card]")!;
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(view.container.querySelector("[data-elicitation-pending-entry]")).toBeNull();
    fireEvent.change(view.container.querySelector("textarea")!, {
      target: { value: "保留跨收起草稿" },
    });
    fireEvent.keyDown(card, { key: "Escape" });
    expect(
      view.container.querySelector("[data-elicitation-dialog-body]")?.classList.contains("hidden"),
    ).toBe(true);
    expect(sendCommand).not.toHaveBeenCalled();
    fireEvent.keyDown(card, { key: "Escape" });
    expect(view.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "保留跨收起草稿",
    );
    view.unmount();
    const remounted = render(ui(state));
    expect(remounted.container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "保留跨收起草稿",
    );
  });
  it("renders operable cards for inactive and hidden panes without stealing focus", async () => {
    const state = snapshot(`background-${serial}`);
    const previous = document.createElement("input");
    document.body.append(previous);
    previous.focus();
    const view = render(ui(state, { isActive: false }));
    expect(view.container.querySelector("[data-elicitation-dialog-card]")).not.toBeNull();
    expect(
      view.container.querySelector<HTMLButtonElement>("[data-elicitation-submit]")?.disabled,
    ).toBe(false);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(previous);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    view.rerender(ui(state, { isActive: true }));
    expect(view.container.querySelector('button[role="option"]')).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(previous);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        view.container.querySelector("[data-elicitation-dialog-card]"),
      ),
    );
    previous.remove();
  });
  it("locks pending and accepted responses, preserves an answer on failure and retries explicitly", async () => {
    let finish!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(ui(snapshot(`failure-${serial}`)));
    await waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "失败后仍在" } });
    submit();
    submit();
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector<HTMLButtonElement>('[data-elicitation-submit="true"]')?.disabled,
    ).toBe(true);
    await act(async () => {
      finish({ status: "rejected", reasonCode: "test-rejection" });
    });
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("失败后仍在");
    submit();
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('[data-elicitation-submit="true"]')?.disabled,
      ).toBe(true),
    );
    submit();
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });
  it("does not apply a late failed response to a new request/session with the same requestId", async () => {
    let fail!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          fail = resolve;
        }),
    );
    const id = `late-${serial}`;
    const view = render(ui(snapshot(id, "first-session")));
    await waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());
    submit();
    view.rerender(ui(snapshot(id, "second-session")));
    await waitFor(() =>
      expect(document.querySelector("[data-elicitation-dialog-card]")).not.toBeNull(),
    );
    await act(async () => {
      fail({ status: "rejected" });
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>('[data-elicitation-submit="true"]')?.disabled,
    ).toBe(false);
    submit();
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    expect(sendCommand.mock.calls[1]?.[0].sessionId).toBe("second-session");
  });
  it("expands, scrolls and focuses only for a matching explicit attention target", async () => {
    const state = snapshot(`attention-${serial}`);
    const view = render(ui(state, { workspaceIdentity: "remote-scope" }));
    const card = view.container.querySelector<HTMLDivElement>("[data-elicitation-dialog-card]")!;
    const scrollIntoView = vi.fn();
    card.scrollIntoView = scrollIntoView;
    fireEvent.keyDown(view.container.querySelector("textarea")!, { key: "Escape" });
    expect(
      view.container.querySelector("[data-elicitation-dialog-body]")?.classList.contains("hidden"),
    ).toBe(true);
    act(() => {
      requestTaskInteractionOpen({
        workspacePath: "/collaboration-workspace",
        workspaceIdentity: "other-remote",
        sessionId: state.sessionId,
        interactionId: state.pendingInteractions[0]!.interactionId,
      });
    });
    expect(
      view.container.querySelector("[data-elicitation-dialog-body]")?.classList.contains("hidden"),
    ).toBe(true);
    expect(getTaskInteractionOpenRequest()?.workspaceIdentity).toBe("other-remote");
    act(() => {
      requestTaskInteractionOpen({
        workspacePath: "/same-identity-different-path",
        workspaceIdentity: " remote-scope ",
        sessionId: state.sessionId,
        interactionId: state.pendingInteractions[0]!.interactionId,
      });
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
    expect(
      view.container.querySelector("[data-elicitation-dialog-body]")?.classList.contains("hidden"),
    ).toBe(false);
    expect(document.activeElement).toBe(card);
    expect(getTaskInteractionOpenRequest()).toBeNull();
  });
  it("preserves the scoped submit lock across remount until the original response settles", async () => {
    let finish!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const state = snapshot(`remount-flight-${serial}`);
    const first = render(ui(state));
    await waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());
    submit();
    first.unmount();
    render(ui(state));
    await waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('[data-elicitation-submit="true"]')?.disabled,
      ).toBe(true),
    );
    submit();
    expect(sendCommand).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ status: "rejected" });
    });
    await waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('[data-elicitation-submit="true"]')?.disabled,
      ).toBe(false),
    );
    submit();
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
  });
  it("isolates response locks and errors for the same session/requestId in another workspace identity", async () => {
    let fail!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          fail = resolve;
        }),
    );
    const state = snapshot(`workspace-isolation-${serial}`);
    const view = render(ui(state, { workspaceIdentity: "workspace-a" }));
    await waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());
    submit();
    view.rerender(ui(state, { workspaceIdentity: "workspace-b" }));
    await waitFor(() =>
      expect(
        document.querySelector<HTMLButtonElement>('[data-elicitation-submit="true"]')?.disabled,
      ).toBe(false),
    );
    await act(async () => {
      fail({ status: "rejected" });
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    submit();
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
  });
  it("keeps a background plan card visible without stealing focus and preserves Escape decline", async () => {
    const state = snapshot(`background-plan-${serial}`);
    state.pendingInteractions[0]!.payload = {
      kind: "userInput",
      toolName: "ExitPlanMode",
      prompt: "审核计划",
      freeText: true,
      questions: [{ question: "审核计划", options: [{ value: "approve", label: "批准" }] }],
    };
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    const view = render(ui(state, { isActive: false }));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(view.container.querySelector('button[role="option"]')).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    fireEvent.keyDown(view.container.querySelector("[data-elicitation-dialog-card]")!, {
      key: "Escape",
    });
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    expect(sendCommand.mock.calls[0]?.[0].payload.answer.action).toBe("decline");
    outside.remove();
  });
  it("keeps sensitive userInput inline, accessible and IME-safe without changing its answer channel", async () => {
    const state = snapshot(`sensitive-${serial}`);
    state.pendingInteractions[0]!.payload = {
      kind: "userInput",
      prompt: "输入密码",
      freeText: true,
      sensitive: true,
    };
    const view = render(ui(state));
    const input = view.container.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(input.getAttribute("aria-label")).toBe("输入密码");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    fireEvent.change(input, { target: { value: "fixture-answer" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sendCommand).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    expect(sendCommand.mock.calls[0]?.[0].type).toBe("resolveInteraction");
    expect(sendCommand.mock.calls[0]?.[0].payload.answer).toEqual({ freeText: "fixture-answer" });
  });
  it("does not turn plan approval into ordinary skip/defer", async () => {
    const state = snapshot(`plan-${serial}`);
    const pending = state.pendingInteractions[0]!;
    pending.payload = {
      kind: "userInput",
      toolName: "ExitPlanMode",
      prompt: "审核计划",
      freeText: true,
      schema: { interaction: "plan_approval", toolName: "ExitPlanMode" },
      questions: [
        { question: "审核计划", header: "计划", options: [{ value: "approve", label: "批准" }] },
      ],
    };
    const view = render(ui(state));
    expect(view.container.querySelector("[data-elicitation-skip]")).toBeNull();
    expect(document.querySelector("[data-elicitation-modal]")).toBeNull();
    submit();
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(1));
    expect(sendCommand.mock.calls[0]?.[0].payload.answer.content.answer).toBe("approve");
  });
});
