import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeTaskInteractionOpenRequest,
  getTaskInteractionOpenRequest,
  matchesTaskInteractionOpenRequest,
  requestTaskInteractionOpen,
  subscribeTaskInteractionOpen,
} from "@/v4/taskAttentionNavigation.js";
afterEach(() => {
  const pending = getTaskInteractionOpenRequest();
  if (pending) consumeTaskInteractionOpenRequest(pending);
});
describe("task attention navigation intent", () => {
  it("matches identity, session and optional request before revealing an inline card", () => {
    const target = {
      workspacePath: "/new-path",
      workspaceIdentity: " remote ",
      sessionId: "session",
      interactionId: "ask",
    };
    expect(
      matchesTaskInteractionOpenRequest(
        {
          workspacePath: "/old-path",
          workspaceIdentity: "remote",
          sessionId: "session",
          interactionId: "ask",
        },
        target,
      ),
    ).toBe(true);
    expect(matchesTaskInteractionOpenRequest({ ...target, interactionId: "other" }, target)).toBe(
      false,
    );
    expect(matchesTaskInteractionOpenRequest({ ...target, sessionId: "other" }, target)).toBe(
      false,
    );
    expect(
      matchesTaskInteractionOpenRequest(
        { workspacePath: "/new-path", sessionId: "session" },
        target,
      ),
    ).toBe(false);
    expect(matchesTaskInteractionOpenRequest({ ...target, interactionId: undefined }, target)).toBe(
      true,
    );
  });
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
