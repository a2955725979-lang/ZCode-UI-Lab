// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createSessionHistoryModeStore } from "../src/store/sessionHistoryModeStore.js";
import * as modes from "../src/store/sessionHistoryModeStore.js";
import { PendingCommandRegistry } from "../src/v4/pendingCommandRegistry.js";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
}
const scope = { workspacePath: "/work", workspaceIdentity: "remote:a:/work" };
const fork = {
  commandId: "fork-lost",
  clientId: "ui-a",
  sessionId: "parent",
  type: "forkAssistant",
  payload: { target: { rowId: 2 } },
  issuedAt: 1000,
} as unknown as CommandEnvelope;
describe("task collaboration history recovery", () => {
  it("keeps failed first claim findable without claiming durability, including captured list filters", () => {
    const store = createSessionHistoryModeStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(store.claimSessionHistoryMode(scope, "new-work", "work")).toEqual({
      mode: "work",
      persisted: false,
    });
    expect(store.getSessionHistoryMode(scope, "new-work", "conversation")).toBe("work");
    expect(store.captureSessionHistoryModeResolver()(scope, "new-work", "conversation")).toBe(
      "work",
    );
    expect(store.claimSessionHistoryMode(scope, "new-work", "chat")).toEqual({
      mode: "work",
      persisted: false,
    });
  });
  it("journals a fork only for query and keeps unknown visible, never replayable", () => {
    const storage = new MemoryStorage();
    const r = new PendingCommandRegistry({ storage, now: () => 1000 });
    expect(r.record(fork, { workspace: scope, sessionHistoryMode: "work" })?.replay.kind).toBe(
      "queryOnly",
    );
    const reopened = new PendingCommandRegistry({ storage, now: () => 1001 });
    reopened.applyQuery({
      results: [{ key: { sessionId: "parent", commandId: "fork-lost" }, result: "unknown" }],
    });
    expect(reopened.listRecoverable("parent")[0]?.recovery).toBe("creationUnknown");
    expect(reopened.consumeReplay({ sessionId: "parent", commandId: "fork-lost" })).toBeNull();
    expect(reopened.list("parent")).toHaveLength(1);
  });
  it("resolves accepted fork query to one child and inherits frozen category", () => {
    const claim = vi
      .spyOn(modes, "claimSessionHistoryMode")
      .mockReturnValue({ mode: "work", persisted: true });
    try {
      const storage = new MemoryStorage();
      const r = new PendingCommandRegistry({ storage, now: () => 1000 });
      r.record(fork, { workspace: scope, sessionHistoryMode: "work" });
      const reopened = new PendingCommandRegistry({ storage, now: () => 1001 });
      reopened.applyQuery({
        results: [
          {
            key: { sessionId: "parent", commandId: "fork-lost" },
            result: {
              commandId: "fork-lost",
              status: "accepted",
              revisionAtDecision: 2,
              result: { type: "forkAssistant", sessionId: "child" },
            },
          },
        ],
      });
      expect(claim).toHaveBeenCalledExactlyOnceWith(scope, "child", "work");
      expect(reopened.listRecoverable("parent")[0]).toMatchObject({
        recovery: "creationRecovered",
        resolvedSessionId: "child",
      });
      expect(reopened.consumeReplay({ sessionId: "parent", commandId: "fork-lost" })).toBeNull();
      const next = new PendingCommandRegistry({ storage, now: () => 1002 });
      expect(next.listRecoverable("parent")[0]).toMatchObject({ resolvedSessionId: "child" });
    } finally {
      claim.mockRestore();
    }
  });
});
