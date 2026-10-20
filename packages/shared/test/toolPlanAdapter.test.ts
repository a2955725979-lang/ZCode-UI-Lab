import { describe, expect, it } from "vitest";
import {
  extractPlanStepsFromToolInput,
  extractPlanStepsFromToolOutput,
  isMainAgentToolProjectionSource,
} from "../src/tool-plan-adapter.js";

describe("tool plan adapter", () => {
  it("extracts TodoWrite plan steps for main agent tools", () => {
    expect(
      extractPlanStepsFromToolInput({
        kind: "TodoWrite",
        input: {
          todos: [
            { content: "Inspect logs", status: "completed" },
            { content: "Patch projection", status: "in_progress" },
          ],
        },
      }),
    ).toEqual([
      { id: "Inspect logs", title: "Inspect logs", status: "completed" },
      { id: "Patch projection", title: "Patch projection", status: "in_progress" },
    ]);
  });

  it("distinguishes a valid empty replacement from malformed data", () => {
    expect(extractPlanStepsFromToolInput({ kind: "TodoWrite", input: { todos: [] } })).toEqual([]);
    expect(extractPlanStepsFromToolOutput({ kind: "TodoWrite", output: { todos: [] } })).toEqual(
      [],
    );
    expect(
      extractPlanStepsFromToolOutput({
        kind: "TodoWrite",
        output: { result: JSON.stringify({ todos: [] }) },
      }),
    ).toEqual([]);
    for (const input of [
      null,
      {},
      { todos: "invalid" },
      { todos: [{ content: "bad", status: "unknown" }] },
    ]) {
      expect(extractPlanStepsFromToolInput({ kind: "TodoWrite", input })).toBeNull();
    }
  });

  it("preserves duplicate labels and multiple in-progress items", () => {
    expect(
      extractPlanStepsFromToolInput({
        kind: "TodoWrite",
        input: {
          todos: [
            { content: "Review", status: "in_progress" },
            { content: "Review", status: "in_progress" },
          ],
        },
      }),
    ).toEqual([
      { id: "Review", title: "Review", status: "in_progress" },
      { id: "Review", title: "Review", status: "in_progress" },
    ]);
  });

  it("detects nested tool payloads that must not drive the main task plan", () => {
    expect(isMainAgentToolProjectionSource({ toolCallId: "call_main" })).toBe(true);
    expect(isMainAgentToolProjectionSource({ source: "subagent" })).toBe(false);
    expect(isMainAgentToolProjectionSource({ parentToolCallId: "call_agent" })).toBe(false);
    expect(isMainAgentToolProjectionSource({ parentToolUseId: "call_agent" })).toBe(false);
    expect(
      isMainAgentToolProjectionSource({
        _meta: { claudeCode: { parentToolUseId: "call_agent" } },
      }),
    ).toBe(false);
  });
});
