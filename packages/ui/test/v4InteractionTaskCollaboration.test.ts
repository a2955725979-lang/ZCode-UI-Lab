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
  it.each(["rejected", "transport"])(
    "locks repeated userInput Enter, preserves a sensitive answer after %s and permits retry",
    async (failure) => {
      let finish!: (value: unknown) => void;
      let fail!: (error: Error) => void;
      sendCommand.mockImplementationOnce(
        () => new Promise((resolve, reject) => { finish = resolve; fail = reject; }),
      );
      const state = snapshot(`sensitive-flight-${serial}`);
      state.pendingInteractions[0]!.payload = {
        kind: "userInput", prompt: "输入验证码", freeText: true, sensitive: true, options: [],
      };
      const view = render(ui(state));
      const input = view.container.querySelector<HTMLInputElement>('input[type="password"]')!;
      fireEvent.change(input, { target: { value: "keep-local-answer" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(input.disabled).toBe(true);
      expect(view.getByRole("button", { name: "提交中…" }).hasAttribute("disabled")).toBe(true);
      await act(async () => {
        if (failure === "transport") fail(new Error("fixture offline"));
        else finish({ status: "rejected" });
      });
      await waitFor(() => expect(view.getByRole("alert").textContent).toContain("答案已保留"));
      expect(input.type).toBe("password");
      expect(input.value).toBe("keep-local-answer");
      expect(input.disabled).toBe(false);
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(view.queryByRole("alert")).toBeNull());
      expect(sendCommand.mock.calls[1]?.[0].payload.answer).toEqual({ freeText: "keep-local-answer" });
    },
  );
  it("locks all unstructured option rows during one pending response and retries rejected choices", async () => {
    let finish!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const state = snapshot(`options-flight-${serial}`);
    state.pendingInteractions[0]!.payload = {
      kind: "userInput", prompt: "请选择通道", freeText: false,
      options: [{ optionId: "one", label: "通道一" }, { optionId: "two", label: "通道二" }],
    };
    const view = render(ui(state));
    const rows = view.container.querySelectorAll<HTMLButtonElement>('[data-focus-style="row"]');
    fireEvent.click(rows[0]!);
    fireEvent.click(rows[1]!);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect([...rows].every((row) => row.disabled)).toBe(true);
    expect(view.getByRole("status").textContent).toBe("提交中…");
    await act(async () => { finish({ status: "rejected" }); });
    await waitFor(() => expect(view.getByRole("alert")).not.toBeNull());
    fireEvent.click(rows[1]!);
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    expect(sendCommand.mock.calls[1]?.[0].payload.answer).toEqual({ optionId: "two" });
  });
  it.each(["accepted", "duplicate", "noop"])("treats a userInput %s ACK as successful", async (status) => {
    sendCommand.mockImplementationOnce(async (envelope) => ({ commandId: envelope.commandId, status }));
    const state = snapshot(`ack-${serial}`);
    state.pendingInteractions[0]!.payload = {
      kind: "userInput", prompt: "请输入", freeText: true, options: [],
    };
    const view = render(ui(state));
    const input = view.container.querySelector<HTMLInputElement>("input")!;
    fireEvent.change(input, { target: { value: "answer" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(view.queryByRole("alert")).toBeNull();
  });
  it("isolates userInput responses and drafts across sessions with the same interactionId", async () => {
    let finish!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = snapshot(`same-id-${serial}`, "first-session");
    first.pendingInteractions[0]!.payload = {
      kind: "userInput", prompt: "请输入", freeText: true, options: [],
    };
    const second = { ...first, sessionId: "second-session" };
    const view = render(ui(first));
    const firstInput = view.container.querySelector<HTMLInputElement>("input")!;
    fireEvent.change(firstInput, { target: { value: "first-only" } });
    fireEvent.keyDown(firstInput, { key: "Enter" });
    view.rerender(ui(second));
    const secondInput = view.container.querySelector<HTMLInputElement>("input")!;
    expect(secondInput.value).toBe("");
    expect(secondInput.disabled).toBe(false);
    await act(async () => { finish({ status: "rejected" }); });
    expect(view.queryByRole("alert")).toBeNull();
    fireEvent.change(secondInput, { target: { value: "second-only" } });
    fireEvent.keyDown(secondInput, { key: "Enter" });
    await waitFor(() => expect(sendCommand).toHaveBeenCalledTimes(2));
    expect(sendCommand.mock.calls[1]?.[0].sessionId).toBe("second-session");
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
