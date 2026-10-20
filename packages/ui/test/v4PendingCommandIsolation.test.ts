// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CommandEnvelope,
  CommandsQueryParams,
  CommandsQueryResult,
} from "@zcode/shared/zcode-protocol-v4";
import {
  PendingCommandRegistry,
  PENDING_COMMAND_TTL_MS,
} from "../src/v4/pendingCommandRegistry.js";
import {
  PENDING_COMMAND_LEGACY_STORAGE_KEY,
  PENDING_COMMAND_RECORD_PREFIX,
  PENDING_COMMAND_SETTLED_PREFIX,
} from "../src/v4/pendingCommandStorage.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const a = { workspacePath: "/repo", workspaceIdentity: "remote:a:/repo" };
const b = { workspacePath: "/repo", workspaceIdentity: "remote:b:/repo" };
const registries: PendingCommandRegistry[] = [];
function create(storage = new MemoryStorage(), now: () => number = () => 1000) {
  const registry = new PendingCommandRegistry({ storage, now });
  registries.push(registry);
  return registry;
}
function command(
  commandId: string,
  sessionId: string | null = null,
  type = "createSession",
): CommandEnvelope {
  return {
    commandId,
    clientId: "client",
    sessionId,
    type,
    issuedAt: 1000,
    payload:
      type === "createSession"
        ? { workspaceId: "/repo", firstInput: { text: "synthetic" } }
        : type === "forkAssistant"
          ? { target: { rowId: 1 } }
          : { text: "synthetic" },
  } as CommandEnvelope;
}
function unknown(params: CommandsQueryParams): Promise<CommandsQueryResult> {
  return Promise.resolve({
    results: params.commands.map((key) => ({ key, result: "unknown" as const })),
  });
}
afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
  vi.restoreAllMocks();
});

describe("pending command workspace and renderer isolation", () => {
  it("queries A before applying results, preserves offline B then lets B reconnect independently", async () => {
    const registry = create();
    registry.record(command("a"), { workspace: a });
    registry.record(command("b"), { workspace: b });
    const queryA = vi.fn(unknown),
      queryB = vi.fn(unknown);
    await registry.reconcileSession(null, queryA, a);
    expect(queryA.mock.calls[0]?.[0].commands).toEqual([{ sessionId: null, commandId: "a" }]);
    expect(registry.list(null).map((e) => e.commandId)).toEqual(["b"]);
    await registry.reconcileSession(null, queryB, b);
    expect(queryB.mock.calls[0]?.[0].commands).toEqual([{ sessionId: null, commandId: "b" }]);
    expect(registry.list(null)).toEqual([]);
  });

  it("scopes session bucket and single-flight by identity, including identical session/command IDs", async () => {
    const registry = create();
    registry.record(command("same", "same-session", "sendText"), { workspace: a });
    registry.record(command("same", "same-session", "sendText"), { workspace: b });
    let release!: (value: CommandsQueryResult) => void;
    const queryA = vi.fn(
      () =>
        new Promise<CommandsQueryResult>((resolve) => {
          release = resolve;
        }),
    );
    const queryB = vi.fn(unknown);
    const first = registry.reconcileSession("same-session", queryA, a);
    const duplicate = registry.reconcileSession("same-session", queryA, a);
    await registry.reconcileSession("same-session", queryB, b);
    expect(queryA).toHaveBeenCalledTimes(1);
    expect(queryB).toHaveBeenCalledTimes(1);
    expect(registry.list("same-session", a)).toHaveLength(1);
    expect(registry.list("same-session", b)).toHaveLength(0);
    release({
      results: [{ key: { sessionId: "same-session", commandId: "same" }, result: "unknown" }],
    });
    await Promise.all([first, duplicate]);
    expect(registry.list("same-session")).toEqual([]);
  });

  it("normalizes whitespace identity and supports local path fallback without adopting unknown legacy sessions", async () => {
    const registry = create();
    registry.record(command("trim"), {
      workspace: { ...a, workspaceIdentity: "  remote:a:/repo  " },
    });
    registry.record(command("local"), {
      workspace: { workspacePath: "/repo", workspaceIdentity: "  " },
    });
    registry.record(command("legacy", "s", "sendText"));
    await registry.reconcileSession(null, unknown, a);
    expect(registry.list(null).map((e) => e.commandId)).toEqual(["local"]);
    const legacyQuery = vi.fn(unknown);
    await registry.reconcileSession("s", legacyQuery, a);
    expect(legacyQuery).not.toHaveBeenCalled();
    expect(registry.list("s")).toHaveLength(1);
    await registry.reconcileSession(null, unknown, { workspacePath: "/repo" });
    expect(registry.list(null)).toEqual([]);
  });

  it("ignores unsolicited results outside the requested batch", async () => {
    const registry = create();
    registry.record(command("a"), { workspace: a });
    registry.record(command("b"), { workspace: b });
    await registry.reconcileSession(
      null,
      async (params) => ({
        results: [
          ...params.commands.map((key) => ({ key, result: "unknown" as const })),
          { key: { sessionId: null, commandId: "b" }, result: "unknown" },
        ],
      }),
      a,
    );
    expect(registry.list(null, b).map((e) => e.commandId)).toEqual(["b"]);
  });

  it("does not apply a stale query after a dismiss, settle, or create-session remap", async () => {
    const registry = create();
    registry.record(command("fork", "parent", "forkAssistant"), { workspace: a });
    registry.markCreationUncertain("parent", "fork", a);
    let release!: (value: CommandsQueryResult) => void;
    const waiting = registry.reconcileSession(
      "parent",
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      a,
    );
    registry.dismissRecovery("parent", "fork", a);
    release({
      results: [
        {
          key: { sessionId: "parent", commandId: "fork" },
          result: {
            commandId: "fork",
            revisionAtDecision: 1,
            status: "accepted",
            result: { type: "forkAssistant", sessionId: "child" },
          },
        },
      ],
    });
    await waiting;
    expect(registry.list("parent", a)[0]).toMatchObject({
      recovery: "creationUnknown",
      recoveryDismissed: true,
    });
    expect(registry.list("parent", a)[0]?.resolvedSessionId).toBeUndefined();
    registry.record(command("create"), { workspace: a });
    let finish!: (value: CommandsQueryResult) => void;
    const pending = registry.reconcileSession(
      null,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      a,
    );
    registry.applyAck(
      command("create"),
      {
        commandId: "create",
        status: "accepted",
        revisionAtDecision: 1,
        result: { type: "createSession", sessionId: "new" },
      },
      a,
    );
    finish({ results: [{ key: { sessionId: null, commandId: "create" }, result: "unknown" }] });
    await pending;
    expect(registry.list("new", a)).toHaveLength(1);
    expect(registry.list(null, a)).toHaveLength(0);
  });

  it("checks workspace before consuming replay and refuses ambiguous unscoped operations", () => {
    const registry = create();
    const request = command("same", "s", "sendText");
    registry.record(request, { workspace: a });
    registry.record(request, { workspace: b });
    expect(registry.consumeReplay({ sessionId: "s", commandId: "same" })).toBeNull();
    registry.settle("s", "same");
    expect(registry.list("s")).toHaveLength(2);
    expect(
      registry.consumeReplay({ sessionId: "s", commandId: "same" }, { workspacePath: "/other" }),
    ).toBeNull();
    expect(registry.list("s")).toHaveLength(2);
    expect(
      registry.consumeReplay({ sessionId: "s", commandId: "same" }, a)?.clientContext?.workspace,
    ).toEqual(a);
    expect(registry.list("s", b)).toHaveLength(1);
  });

  it("two independently initialized renderers preserve interleaved adds, settlement and reopen", () => {
    const storage = new MemoryStorage();
    const left = create(storage),
      right = create(storage);
    left.record(command("fork", "parent", "forkAssistant"), { workspace: a });
    left.markCreationUncertain("parent", "fork", a);
    right.record(command("b", "session-b", "sendText"), { workspace: b });
    expect(
      create(storage)
        .list("parent")
        .map((e) => e.commandId),
    ).toEqual(["fork"]);
    right.settle("parent", "fork", a);
    left.record(command("a2", "session-a", "sendText"), { workspace: a });
    const reopened = create(storage);
    expect(reopened.list("parent")).toEqual([]);
    expect(reopened.list("session-a").map((e) => e.commandId)).toEqual(["a2"]);
    expect(reopened.list("session-b").map((e) => e.commandId)).toEqual(["b"]);
    left.markCreationUncertain("parent", "fork", a);
    expect(create(storage).list("parent")).toEqual([]);
  });

  it("terminal tombstone beats a stale write that raced between its check and setItem", () => {
    const storage = new MemoryStorage();
    const left = create(storage),
      right = create(storage);
    left.record(command("fork", "parent", "forkAssistant"), { workspace: a });
    const original = storage.setItem.bind(storage);
    let injected = false;
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (!injected && key.startsWith(PENDING_COMMAND_RECORD_PREFIX)) {
        injected = true;
        left.settle("parent", "fork", a);
      }
      original(key, value);
    });
    right.markCreationUncertain("parent", "fork", a);
    expect(injected).toBe(true);
    expect(
      [...storage.values.keys()].some((key) => key.startsWith(PENDING_COMMAND_SETTLED_PREFIX)),
    ).toBe(true);
    expect(create(storage).list("parent")).toEqual([]);
  });

  it("create-session binding cannot regress when a stale null write races with remap", () => {
    const storage = new MemoryStorage();
    const left = create(storage),
      right = create(storage);
    const request = command("create");
    left.record(request, { workspace: a });
    const original = storage.setItem.bind(storage);
    let injected = false;
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (!injected && key.startsWith(PENDING_COMMAND_RECORD_PREFIX)) {
        injected = true;
        left.applyAck(
          request,
          {
            commandId: "create",
            status: "accepted",
            revisionAtDecision: 1,
            result: { type: "createSession", sessionId: "created" },
          },
          a,
        );
      }
      original(key, value);
    });
    right.applyQuery(
      {
        results: [
          {
            key: { sessionId: null, commandId: "create" },
            result: {
              commandId: "create",
              status: "failed",
              revisionAtDecision: 1,
              reasonCode: "fault.command.inputDiscardedOnRestart",
              result: { type: "inputDisposition", delivery: "startNow" },
            },
          },
        ],
      },
      a,
    );
    expect(injected).toBe(true);
    expect(create(storage).list(null, a)).toEqual([]);
    expect(create(storage).list("created", a)).toHaveLength(1);
  });

  it("rejects malformed replay unions and workspace contexts one record at a time", () => {
    const storage = new MemoryStorage();
    const valid = create().record(command("valid"), { workspace: a })!;
    storage.setItem(
      PENDING_COMMAND_LEGACY_STORAGE_KEY,
      JSON.stringify([
        { ...valid, commandId: "missing-payload", replay: { kind: "input", type: "sendText" } },
        {
          ...valid,
          commandId: "bad-kind",
          replay: { kind: "invented", type: "sendText", payload: {} },
        },
        {
          ...valid,
          commandId: "bad-context",
          clientContext: { workspace: { workspacePath: "/repo", workspaceIdentity: 7 } },
        },
        {
          ...valid,
          commandId: "bad-digest",
          replay: { kind: "sensitiveDigest", type: "resolveInteraction", digest: {} },
        },
        valid,
      ]),
    );
    const registry = create(storage);
    expect(registry.list(null).map((entry) => entry.commandId)).toEqual(["valid"]);
    expect(() =>
      registry.consumeReplay({ sessionId: null, commandId: "missing-payload" }, a),
    ).not.toThrow();
    expect(registry.consumeReplay({ sessionId: null, commandId: "valid" }, a)?.payload).toEqual({
      workspaceId: "/repo",
      firstInput: { text: "synthetic" },
    });
  });

  it("legacy v1 reads cannot resurrect a settled item or undo a remapped session", () => {
    const storage = new MemoryStorage();
    const original = create();
    const entry = original.record(command("legacy"), { workspace: a })!;
    storage.setItem(PENDING_COMMAND_LEGACY_STORAGE_KEY, JSON.stringify([entry]));
    const left = create(storage),
      right = create(storage);
    expect(left.list(null)).toHaveLength(1);
    left.applyAck(
      command("legacy"),
      {
        commandId: "legacy",
        status: "accepted",
        revisionAtDecision: 1,
        result: { type: "createSession", sessionId: "created" },
      },
      a,
    );
    expect(right.list(null)).toEqual([]);
    expect(right.list("created")).toHaveLength(1);
    expect(right.record(command("legacy"), { workspace: a })?.sessionId).toBe("created");
    right.settle("created", "legacy", a);
    expect(create(storage).list(null)).toEqual([]);
    expect(create(storage).list("created")).toEqual([]);
    expect(storage.getItem(PENDING_COMMAND_LEGACY_STORAGE_KEY)).toBe(JSON.stringify([entry]));
  });

  it("does not extend TTL on reload, updates, legacy reads or terminal tombstones", () => {
    const storage = new MemoryStorage();
    let now = 1000;
    const left = create(storage, () => now);
    const entry = left.record(command("fork", "parent", "forkAssistant"), { workspace: a })!;
    now += 500;
    const right = create(storage, () => now);
    right.markCreationUncertain("parent", "fork", a);
    expect(right.list("parent")[0]?.expiresAt).toBe(1000 + PENDING_COMMAND_TTL_MS);
    right.settle("parent", "fork", a);
    expect(
      JSON.parse(
        [...storage.values.entries()].find(([key]) =>
          key.startsWith(PENDING_COMMAND_SETTLED_PREFIX),
        )![1],
      ),
    ).toEqual({ expiresAt: entry.expiresAt });
    storage.setItem(PENDING_COMMAND_LEGACY_STORAGE_KEY, JSON.stringify([entry]));
    now = entry.expiresAt + 1;
    expect(create(storage, () => now).list("parent")).toEqual([]);
  });

  it("falls back to current-renderer memory when storage reads/writes fail", () => {
    const storage = new MemoryStorage();
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const registry = create(storage);
    registry.record(command("local"), { workspace: a });
    expect(registry.list(null, a)).toHaveLength(1);
    registry.settle(null, "local", a);
    expect(registry.list(null)).toEqual([]);
    expect(storage.values.size).toBe(0);
  });

  it("isolates corrupted records and leaves unrelated storage untouched", () => {
    const storage = new MemoryStorage();
    const registry = create(storage);
    storage.setItem("unrelated", "keep");
    storage.setItem(PENDING_COMMAND_RECORD_PREFIX + "broken", "{bad");
    registry.record(command("good"), { workspace: a });
    expect(
      create(storage)
        .list(null)
        .map((e) => e.commandId),
    ).toEqual(["good"]);
    registry.settle(null, "good", a);
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("notifies same-window peers and cross-window storage events, then releases listeners", () => {
    const storage = new MemoryStorage();
    const left = create(storage),
      right = create(storage);
    const first = vi.fn(),
      second = vi.fn();
    const add = vi.spyOn(window, "addEventListener"),
      remove = vi.spyOn(window, "removeEventListener");
    const stopLeft = left.subscribe(first),
      stopRight = right.subscribe(second);
    first.mockClear();
    second.mockClear();
    left.record(command("a"), { workspace: a });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    window.dispatchEvent(
      new StorageEvent("storage", { key: PENDING_COMMAND_RECORD_PREFIX + "synthetic" }),
    );
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.filter(([type]) => type === "storage")).toHaveLength(2);
    stopLeft();
    stopRight();
    expect(remove.mock.calls.filter(([type]) => type === "storage")).toHaveLength(2);
    first.mockClear();
    second.mockClear();
    left.record(command("other"), { workspace: a });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });
});
