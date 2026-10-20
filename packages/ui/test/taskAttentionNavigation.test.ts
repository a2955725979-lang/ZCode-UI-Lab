import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeTaskInteractionOpenRequest,
  getTaskInteractionOpenRequest,
  requestTaskInteractionOpen,
  subscribeTaskInteractionOpen,
} from "@/v4/taskAttentionNavigation.js";
afterEach(() => {
  const pending = getTaskInteractionOpenRequest();
  if (pending) consumeTaskInteractionOpenRequest(pending);
});
describe("task attention navigation intent", () => {
  it("retains the latest target and cannot consume a newer request using stale identity", () => {
    const first = requestTaskInteractionOpen({
      workspacePath: "/first",
      sessionId: "session",
      interactionId: "ask",
    });
    const second = requestTaskInteractionOpen({
      workspacePath: "/second",
      workspaceIdentity: "remote-identity",
      sessionId: "session",
      interactionId: "ask",
    });
    expect(consumeTaskInteractionOpenRequest(first)).toBe(false);
    expect(getTaskInteractionOpenRequest()).toBe(second);
    expect(consumeTaskInteractionOpenRequest(second)).toBe(true);
    expect(getTaskInteractionOpenRequest()).toBeNull();
    expect(consumeTaskInteractionOpenRequest(second)).toBe(false);
  });
  it("notifies request and consumption, and stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTaskInteractionOpen(listener);
    const target = { workspacePath: "/workspace", sessionId: "session" };
    const request = requestTaskInteractionOpen(target);
    target.workspacePath = "/mutated";
    expect(request.workspacePath).toBe("/workspace");
    expect(listener).toHaveBeenCalledTimes(1);
    consumeTaskInteractionOpenRequest(request);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    requestTaskInteractionOpen(target);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
