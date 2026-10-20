// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ConversationSnapshot, PendingInteraction } from "@zcode/shared/zcode-protocol-v4";
import { TaskProgressSummary, taskProgressState } from "@/v4/TaskProgressSummary.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
        values ? `${id} ${Object.values(values).join("/")}` : id,
    },
  }),
}));

afterEach(cleanup);

function snapshot(): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId: "progress-session",
    logEpoch: "progress-epoch",
    seq: 1,
    revision: 1,
    control: {
      phase: "running",
      sessionEnded: false,
      canStop: true,
      stopState: "stoppable",
      stopTargetKind: "assistant",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: true },
      resumeGoal: { allowed: true },
    },
    inputRouting: { mode: "choice" },
    meta: { title: "Task", titleSource: "generated" },
    config: { provider: "", model: "", thought: "", followupMode: "queue", mode: "build" },
    usage: {
      contextWindow: null,
      cumulative: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: {
      updatedAt: 1,
      items: [
        { id: "a", content: "Inspect materials", status: "completed" },
        { id: "b", content: "Check existing output", status: "completed" },
        { id: "repeat", content: "Review", status: "inProgress" },
        { id: "repeat", content: "Review", status: "inProgress" },
        { id: "e", content: "Prepare delivery", status: "pending" },
      ],
    },
    rows: { window: [], totalCount: 0, firstRowId: null },
  };
}

function ask(): PendingInteraction {
  return {
    interactionId: "ask-1",
    kind: "userInput",
    anchorRowId: null,
    createdAt: 1,
    payload: {
      kind: "userInput",
      prompt: "Which output?",
      freeText: true,
      toolName: "AskUserQuestion",
    },
  };
}

function permission(): PendingInteraction {
  return {
    interactionId: "permission-1",
    kind: "permission",
    anchorRowId: null,
    createdAt: 1,
    payload: {
      kind: "permission",
      toolCallId: "tool-1",
      toolName: "Bash",
      summary: "Run?",
      detail: {},
      options: [],
    },
  };
}

describe("TaskProgressSummary", () => {
  it("shows execution end and completed steps without asserting acceptance", () => {
    const state = snapshot();
    state.control.phase = "completedSuccess";
    state.plan!.items = state.plan!.items.map((item) => ({ ...item, status: "completed" }));
    const view = render(createElement(TaskProgressSummary, { snapshot: state }));
    expect(view.getByRole("status").textContent).toContain("chat.taskProgress.state.ended");
    expect(view.container.innerHTML).not.toMatch(/verification|验收|Acceptance/i);
    expect(view.getByRole("status").textContent).toContain("chat.taskProgress.completed 5/5");
  });

  it.each([{ toolName: "exitplanmode" }, { schema: { interaction: "plan_approval" } }])(
    "keeps supported plan approval payload %j in confirmation",
    (payload) => {
      const state = snapshot();
      const approval = ask();
      if (approval.payload.kind !== "userInput") throw new Error("Expected user input");
      approval.payload = { ...approval.payload, toolName: undefined, ...payload };
      state.pendingInteractions = [approval];
      expect(taskProgressState(state)).toBe("awaitingConfirmation");
    },
  );

  it("defaults compact, expands every ordered step including completed and repeated items", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const state = snapshot();
      const view = render(createElement(TaskProgressSummary, { snapshot: state }));
      const toggle = view.getByRole("button", { name: "chat.taskProgress.expand" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(view.getByRole("status").textContent).toContain("chat.taskProgress.completed 2/5");
      expect(view.getByRole("status").textContent).toContain(
        "chat.taskProgress.current Review · Review",
      );
      expect(view.queryByRole("list")).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(
        [...view.getByRole("list").querySelectorAll("li")].map((row) => row.textContent),
      ).toEqual(state.plan!.items.map((item) => item.content));
      expect(view.queryByRole("checkbox")).toBeNull();
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key|unique.*key/i);
      fireEvent.click(toggle);
      expect(view.queryByRole("list")).toBeNull();
    } finally {
      errors.mockRestore();
    }
  });

  it("uses the pane expansion default and resets only on session/mode changes", () => {
    const state = snapshot();
    const view = render(
      createElement(TaskProgressSummary, { snapshot: state, defaultExpanded: true }),
    );
    expect(view.getByRole("list")).toBeTruthy();
    fireEvent.click(view.getByRole("button"));
    const update = { ...state, seq: 2, revision: 2 };
    view.rerender(createElement(TaskProgressSummary, { snapshot: update, defaultExpanded: true }));
    expect(view.queryByRole("list")).toBeNull();
    view.rerender(
      createElement(TaskProgressSummary, {
        snapshot: { ...update, sessionId: "session-2" },
        defaultExpanded: true,
      }),
    );
    expect(view.getByRole("list")).toBeTruthy();
    view.rerender(createElement(TaskProgressSummary, { snapshot: update, defaultExpanded: false }));
    expect(view.queryByRole("list")).toBeNull();
  });

  it("shows actual run state without inventing a plan or a fraction", () => {
    const state = { ...snapshot(), plan: null };
    const view = render(createElement(TaskProgressSummary, { snapshot: state }));
    expect(view.getByRole("status").textContent).toBe("chat.taskProgress.state.running");
    expect(view.queryByRole("button")).toBeNull();
    expect(view.queryByRole("list")).toBeNull();
    expect(view.container.textContent).not.toMatch(/completed|%|ETA|0\/0/);
    expect(view.container.innerHTML).not.toMatch(/verification|验收|Acceptance/i);
  });

  it("keeps fully completed steps separate from waiting, stopping, failure and turn completion", () => {
    const state = snapshot();
    state.plan!.items = state.plan!.items.map((item) => ({ ...item, status: "completed" }));
    const view = render(createElement(TaskProgressSummary, { snapshot: state }));
    expect(view.getByRole("status").textContent).toContain("chat.taskProgress.state.running");
    expect(view.getByRole("status").textContent).toContain("chat.taskProgress.completed 5/5");
    expect(view.container.textContent).not.toMatch(
      /verificationPassed|state\.verified|验证通过|验收通过/i,
    );
    state.pendingInteractions = [ask()];
    expect(taskProgressState(state)).toBe("awaitingAnswer");
    state.pendingInteractions = [permission()];
    expect(taskProgressState(state)).toBe("awaitingConfirmation");
    const approval = ask();
    if (approval.payload.kind === "userInput") approval.payload.toolName = "ExitPlanMode";
    state.pendingInteractions = [approval];
    expect(taskProgressState(state)).toBe("awaitingConfirmation");
    state.control.stopState = "stopping";
    expect(taskProgressState(state)).toBe("stopping");
    state.control.phase = "completedInterrupted";
    state.control.stopState = "idle";
    expect(taskProgressState(state)).toBe("stopped");
    state.control.phase = "error";
    expect(taskProgressState(state)).toBe("failed");
    state.control.phase = "completedSuccess";
    state.pendingInteractions = [];
    expect(taskProgressState(state)).toBe("ended");
    state.backgroundWorks = [
      {
        workId: "bg",
        kind: "bash",
        title: "Build",
        status: "running",
        startedAt: 1,
        anchorRowId: null,
      },
    ];
    expect(taskProgressState(state)).toBe("backgroundRunning");
  });

  it("labels a pending fallback as next instead of pretending it is running", () => {
    const state = snapshot();
    state.plan!.items = [{ id: "next", content: "Prepare delivery", status: "pending" }];
    const view = render(createElement(TaskProgressSummary, { snapshot: state }));
    expect(view.getByRole("status").textContent).toContain(
      "chat.taskProgress.next Prepare delivery",
    );
    expect(view.getByRole("status").textContent).not.toContain("chat.taskProgress.current");
  });

  it("does not mount an absent or empty draft snapshot", () => {
    const view = render(createElement(TaskProgressSummary, { snapshot: null }));
    expect(view.container.childElementCount).toBe(0);
    const state = { ...snapshot(), plan: null };
    state.control.phase = "draft";
    view.rerender(createElement(TaskProgressSummary, { snapshot: state }));
    expect(view.container.childElementCount).toBe(0);
  });
});
