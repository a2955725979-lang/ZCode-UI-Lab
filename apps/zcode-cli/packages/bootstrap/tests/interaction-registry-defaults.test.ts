import { afterEach, describe, expect, it, vi } from "vitest";
import { V4InteractionRegistry } from "../src/zcode-protocol-v4/interaction-registry.js";
afterEach(() => vi.useRealTimers());
describe("ordinary question default continuation policy", () => {
  it("keeps a new question pending by default without installing a countdown", async () => {
    vi.useFakeTimers();
    const registry = new V4InteractionRegistry();
    const resolve = vi.fn(); const updated = vi.fn();
    const unregister = registry.register("default-off", resolve, { kind: "askUserQuestion", sessionId: "session", onAutoResolutionUpdated: updated });
    await vi.advanceTimersByTimeAsync(600_000);
    expect(updated).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(registry.has("default-off")).toBe(true);
    unregister();
  });
  it("preserves an explicit opt-in before registration", async () => {
    vi.useFakeTimers();
    const registry = new V4InteractionRegistry();
    await registry.initializeAskUserQuestionAutoResolutionEnabled(true);
    const resolve = vi.fn();
    registry.register("explicit-on", resolve, { kind: "askUserQuestion", sessionId: "session" });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(resolve).toHaveBeenCalledWith({ action: "accept", content: { answers: {} } });
  });
});
