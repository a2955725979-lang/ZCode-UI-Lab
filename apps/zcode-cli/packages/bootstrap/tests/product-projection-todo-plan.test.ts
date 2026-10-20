import { describe, expect, it } from "vitest";
import {
  SessionEventType,
  type EventId,
  type SessionEvent,
  type SessionEventType as EventType,
  type SessionId,
  type TraceId,
  type TurnId,
} from "@zcode/contracts";
import {
  DELIVERY_PROFILES,
  applyConversationDeltas,
  filterConversationDeltasForProfile,
  type ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import { ProductProjection } from "../src/zcode-protocol-v4/index.js";

const SESSION = "todo-plan-session";
const TURN = "todo-plan-turn";
const OLD_TODOS = [{ content: "Accepted plan", status: "in_progress" }];
const NEW_TODOS = [
  { content: "Review", status: "in_progress" },
  { content: "Review", status: "in_progress" },
];

class TodoHarness {
  readonly projection = new ProductProjection(SESSION, "todo-epoch");
  readonly events: SessionEvent[] = [];

  constructor() {
    this.apply(SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 });
    this.apply(SessionEventType.TurnStarted, { turnNumber: 1, input: "work" });
  }

  apply(type: EventType, payload: unknown): void {
    const sequenceNumber = this.events.length + 1;
    const event: SessionEvent = {
      id: `todo-event-${sequenceNumber}` as EventId,
      sessionId: SESSION as SessionId,
      turnId: TURN as TurnId,
      traceId: "todo-trace" as TraceId,
      type,
      sequenceNumber,
      timestamp: new Date(1_700_000_000_000 + sequenceNumber),
      payload,
    };
    this.events.push(event);
    this.projection.applyEvent(event);
  }

  schedule(toolCallId: string, todos: unknown, source: Record<string, unknown> = {}): void {
    this.apply(SessionEventType.ToolCallScheduled, {
      ...source,
      toolCallId,
      toolName: "TodoWrite",
      input: { todos },
      schedule: { parallelGroups: [[toolCallId]], executionOrder: [toolCallId] },
    });
  }

  result(toolCallId: string, content: unknown, success = true, source = {}): void {
    this.apply(SessionEventType.ToolCallResult, {
      ...source,
      toolCallId,
      result: { success, content: typeof content === "string" ? content : JSON.stringify(content) },
      duration: 1,
    });
  }

  acceptedPlan(): NonNullable<ConversationSnapshot["plan"]> {
    this.schedule("accepted", OLD_TODOS);
    this.result("accepted", { todos: OLD_TODOS });
    return this.projection.getSnapshot().plan!;
  }
}

describe("ProductProjection Todo successful facts", () => {
  it("keeps scheduled/started candidates out of the authoritative plan", () => {
    const harness = new TodoHarness();
    const previous = harness.acceptedPlan();
    harness.schedule("candidate", NEW_TODOS);
    expect(harness.projection.getSnapshot().plan).toEqual(previous);
    harness.apply(SessionEventType.ToolCallStarted, {
      toolCallId: "candidate",
      toolName: "TodoWrite",
    });
    expect(harness.projection.getSnapshot().plan).toEqual(previous);
    harness.result("candidate", "Todo list updated");
    expect(harness.projection.getSnapshot().plan?.items).toEqual([
      { id: "Review", content: "Review", status: "inProgress" },
      { id: "Review", content: "Review", status: "inProgress" },
    ]);
  });

  it.each(["failedResult", "error", "cancelled"])(
    "preserves the previous successful plan on %s",
    (kind) => {
      const harness = new TodoHarness();
      const previous = harness.acceptedPlan();
      harness.schedule("candidate", NEW_TODOS);
      if (kind === "failedResult") harness.result("candidate", { todos: NEW_TODOS }, false);
      else
        harness.apply(SessionEventType.ToolCallError, {
          toolCallId: "candidate",
          error: {
            type: "tool_error",
            code: kind === "cancelled" ? "TOOL_CANCELLED" : "TOOL_ERROR",
            message: kind,
          },
        });
      expect(harness.projection.getSnapshot().plan).toEqual(previous);
    },
  );

  it("clears a successful empty output instead of falling back to a nonempty input", () => {
    const harness = new TodoHarness();
    harness.acceptedPlan();
    harness.schedule("clear-output", NEW_TODOS);
    harness.result("clear-output", { todos: [] });
    expect(harness.projection.getSnapshot().plan?.items).toEqual([]);
  });

  it("clears a successful empty input fallback and preserves facts for invalid data", () => {
    const harness = new TodoHarness();
    const previous = harness.acceptedPlan();
    harness.schedule("invalid", [{ content: "invalid", status: "unknown" }]);
    harness.result("invalid", { todos: "invalid" });
    expect(harness.projection.getSnapshot().plan).toEqual(previous);
    harness.schedule("clear-input", []);
    harness.result("clear-input", "Todo list updated");
    expect(harness.projection.getSnapshot().plan?.items).toEqual([]);
  });

  it("isolates successful child Todo calls from the main plan", () => {
    const harness = new TodoHarness();
    const previous = harness.acceptedPlan();
    const source = {
      source: "subagent",
      parentToolCallId: "parent-agent",
      childSessionId: "child-1",
    };
    harness.schedule("child-todo", [], source);
    harness.result("child-todo", { todos: [] }, true, source);
    expect(harness.projection.getSnapshot().plan).toEqual(previous);
  });

  it("converges continuous/replayable deltas and cold hydration after success, failure and clear", () => {
    const harness = new TodoHarness();
    harness.acceptedPlan();
    harness.schedule("failed", NEW_TODOS);
    harness.result("failed", { todos: NEW_TODOS }, false);
    harness.schedule("clear", []);
    harness.result("clear", { todos: [] });
    for (const profile of Object.values(DELIVERY_PROFILES)) {
      const live = new ProductProjection(SESSION, "todo-epoch");
      let mirror = live.getSnapshot();
      for (const event of harness.events) {
        const deltas = filterConversationDeltasForProfile(live.applyEvent(event), profile);
        mirror = applyConversationDeltas(mirror, deltas);
        expect(mirror.plan).toEqual(live.getSnapshot().plan);
      }
      expect(mirror.plan?.items).toEqual([]);
    }
    const cold = new ProductProjection(SESSION, "todo-epoch");
    cold.beginHydrationReplay();
    for (const event of harness.events) cold.applyHydrationEvent(event);
    cold.completeHydrationReplay();
    expect(cold.getSnapshot().plan).toEqual(harness.projection.getSnapshot().plan);
    expect(cold.getSnapshot().plan?.items).toEqual([]);
  });
});
