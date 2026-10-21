import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemorySessionEventStore, createSqliteSessionStore } from "@zcode/adapters/storage";
import type { Logger, MessageId, MessagePart, ProjectId, SessionId } from "@zcode/contracts";
import { conversationTopic } from "@zcode/shared/zcode-protocol-v4";
import { listSessionSubagents, listSessions } from "../src/zcode-protocol/server-operations.js";
import { createConversationV4Gateway } from "../src/zcode-protocol/v4-bridge.js";
import type {
  ZCodeProtocolAgentServerContext,
  ZCodeProtocolSessionRecord,
} from "../src/zcode-protocol/server-types.js";

const SESSION_ID = "sess_deferred_hydration" as SessionId;
const CHILD_ID = "sess_subagent_hydration_child" as SessionId;
const WORKSPACE_PATH = "/workspace/deferred-hydration";
const REVISION = 17;
const CLIENT_MODES = ["desktop-continuous", "web-remote-replayable"] as const;
type Store = ReturnType<typeof createSqliteSessionStore>;
type Gateway = ReturnType<typeof createConversationV4Gateway>;
type RecordedLog = { level: string; context?: Record<string, unknown> };

// 真实 SQLite / event store / bridge；只替代不会执行模型的 app/runtime 展示依赖。
function makeRecord(): ZCodeProtocolSessionRecord {
  return {
    app: {
      sessionId: SESSION_ID,
      getMode: () => "build",
      listModels: () => [],
      readToolResultArtifact: async () => ({ content: "" }),
      runtime: {
        getPlanEnabled: () => false,
        getSessionModelSelection: () => undefined,
        getProjection: async () => ({
          contextUsed: 0,
          contextWindow: 200_000,
          backgroundTasks: [],
          activeToolCalls: [],
        }),
        isSessionPersisted: () => false,
      },
    },
    createdAt: 1,
    updatedAt: 1,
    eventStore: createInMemorySessionEventStore(),
    persistence: "deferred",
    stateRevision: REVISION,
    taskType: "interactive",
    workspace: { workspaceKey: `local:${WORKSPACE_PATH}`, workspacePath: WORKSPACE_PATH },
  } as unknown as ZCodeProtocolSessionRecord;
}

function makeContext(
  record: ZCodeProtocolSessionRecord,
  logs: RecordedLog[],
  store?: Store,
): ZCodeProtocolAgentServerContext {
  const log = (level: string) => (_message: string, context?: Record<string, unknown>) =>
    logs.push({ level, context });
  const logger = {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: () => logger,
  } as unknown as Logger;
  return {
    appRuntimePreferences: {
      askUserQuestionAutoResolutionEnabled: false,
      modelIoFullRetentionEnabled: false,
    },
    deps: { sessionStore: store },
    logger,
    notify: () => undefined,
    sessions: new Map([[SESSION_ID, record]]),
    v4Interactions: { resolve: () => false },
    workspaceModelCatalogs: new Map(),
  } as unknown as ZCodeProtocolAgentServerContext;
}

function expectMissingLog(logs: RecordedLog[], sessionId: string): void {
  expect(logs).toContainEqual(
    expect.objectContaining({
      level: "warn",
      context: expect.objectContaining({
        event: "zcode_protocol.session.persisted_missing",
        operation: "session_subagents",
        sessionId,
      }),
    }),
  );
}

async function subscribeSnapshot(
  gateway: Gateway,
  mode: (typeof CLIENT_MODES)[number],
  connectionId: string,
) {
  const result = await gateway.subscribe({
    topic: conversationTopic(SESSION_ID),
    connectionId,
    clientMode: mode,
  });
  const payload = result.initialFrame?.payload;
  if (payload?.kind !== "snapshot") throw new Error("Expected conversation snapshot");
  return payload.snapshot;
}

async function persistParentAndChild(store: Store): Promise<void> {
  for (const id of [SESSION_ID, CHILD_ID]) {
    await store.createSession({
      id,
      ...(id === CHILD_ID ? { parentID: SESSION_ID } : {}),
      taskType: id === CHILD_ID ? "subagent_child" : "interactive",
      projectID: "project_deferred_hydration" as ProjectId,
      slug: id,
      directory: WORKSPACE_PATH,
      title: id,
      version: "test",
      time: { created: 1, updated: 2 },
    });
  }
  const id = "message_subagent_reference" as MessageId;
  await store.saveMessage({
    id,
    sessionID: SESSION_ID,
    role: "assistant",
    parentID: "user" as MessageId,
    time: { created: 10, completed: 20 },
    providerID: "test" as never,
    modelID: "test" as never,
    mode: "build",
    agent: "zcode",
    path: { cwd: WORKSPACE_PATH, root: WORKSPACE_PATH },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  });
  await store.savePart({
    id: "part_subagent_reference" as MessagePart["id"],
    messageID: id,
    sessionID: SESSION_ID,
    type: "tool",
    tool: "Agent",
    callID: "call_subagent_reference",
    state: {
      status: "running",
      input: { description: "Hydration child", subagent_type: "Explore" },
      metadata: { childSessionId: CHILD_ID },
      time: { start: 10 },
    },
  });
}

describe("deferred session subagent hydration", () => {
  let store: Store;
  let record: ZCodeProtocolSessionRecord;
  let logs: RecordedLog[];
  let context: ZCodeProtocolAgentServerContext;
  const gateways: Gateway[] = [];

  beforeEach(() => {
    store = createSqliteSessionStore({ dbPath: ":memory:" });
    record = makeRecord();
    logs = [];
    context = makeContext(record, logs, store);
  });
  afterEach(() => {
    for (const gateway of gateways.splice(0)) gateway.dispose();
    store.close();
    vi.restoreAllMocks();
  });
  function gatewayForContext() {
    const gateway = createConversationV4Gateway(context);
    gateways.push(gateway);
    return gateway;
  }

  it("合法 live deferred 草稿返回真实 revision 的空种子，查询不制造持久会话", async () => {
    expect(await store.getSession(SESSION_ID)).toBeNull();
    await expect(listSessionSubagents(context, { sessionId: SESSION_ID })).resolves.toEqual({
      revision: REVISION,
      childSessionIds: [],
      running: [],
      ended: { total: 0, items: [] },
    });
    expect(await store.listSessions()).toEqual([]);
    expect(await listSessions(context, {})).toEqual({ sessions: [] });
    expect(logs.filter((log) => log.level === "warn")).toEqual([]);
  });

  it.each(CLIENT_MODES)("%s 首订、重复订阅和重新物化不中断、不产生假会话或告警", async (mode) => {
    const gateway = gatewayForContext();
    for (const connection of ["first", "repeat"]) {
      const snapshot = await subscribeSnapshot(gateway, mode, connection);
      expect(snapshot.rows.window).toEqual([]);
      expect(snapshot.subagents.running).toEqual([]);
    }
    // 新 gateway 强制重新读同一权威 live record，覆盖恢复入口而非只复用旧 publisher。
    const restored = await subscribeSnapshot(gatewayForContext(), mode, "restored");
    expect(restored.subagents.running).toEqual([]);
    expect(context.sessions.size).toBe(1);
    expect(record.persistence).toBe("deferred");
    expect(await store.listSessions()).toEqual([]);
    expect(logs.filter((log) => log.level === "warn" || log.level === "error")).toEqual([]);
  });

  it("未知 id 保留持久缺失错误和诊断", async () => {
    const missingId = "sess_unknown_hydration";
    await expect(listSessionSubagents(context, { sessionId: missingId })).rejects.toThrow(
      `Session not found: ${missingId}`,
    );
    expectMissingLog(logs, missingId);
    expect(await store.listSessions()).toEqual([]);
  });

  it("live immediate 缺少父记录仍是错误", async () => {
    record.persistence = "immediate";
    await expect(listSessionSubagents(context, { sessionId: SESSION_ID })).rejects.toThrow(
      `Session not found: ${SESSION_ID}`,
    );
    expectMissingLog(logs, SESSION_ID);
  });

  it("deferred 镜像滞后但 runtime 已持久化时，不掩盖缺失父记录", async () => {
    vi.spyOn(record.app.runtime, "isSessionPersisted").mockReturnValue(true);
    await expect(listSessionSubagents(context, { sessionId: SESSION_ID })).rejects.toThrow(
      `Session not found: ${SESSION_ID}`,
    );
    expectMissingLog(logs, SESSION_ID);
  });

  it("父查询 await 期间提升为 immediate 后，null 不能再当作合法草稿", async () => {
    let finish!: (value: null) => void;
    vi.spyOn(store, "getSession").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = listSessionSubagents(context, { sessionId: SESSION_ID });
    record.persistence = "immediate";
    finish(null);
    await expect(pending).rejects.toThrow(`Session not found: ${SESSION_ID}`);
    expectMissingLog(logs, SESSION_ID);
  });

  it.each(["removed", "replaced"] as const)(
    "父查询 await 期间 live record %s 后，不复用旧草稿引用",
    async (change) => {
      let finish!: (value: null) => void;
      vi.spyOn(store, "getSession").mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = listSessionSubagents(context, { sessionId: SESSION_ID });
      if (change === "removed") context.sessions.delete(SESSION_ID);
      else context.sessions.set(SESSION_ID, makeRecord());
      finish(null);
      await expect(pending).rejects.toThrow(`Session not found: ${SESSION_ID}`);
      expectMissingLog(logs, SESSION_ID);
      expect(await store.listSessions()).toEqual([]);
    },
  );

  it("真实 SQLite 连接关闭错误继续上抛，不改写成 missing 或空种子", async () => {
    const closedStore = createSqliteSessionStore({ dbPath: ":memory:" });
    closedStore.close();
    const originalError = await closedStore.getSession(SESSION_ID).catch((error: unknown) => error);
    expect(originalError).toBeInstanceOf(Error);
    const brokenContext = makeContext(record, logs, closedStore);
    await expect(listSessionSubagents(brokenContext, { sessionId: SESSION_ID })).rejects.toThrow(
      (originalError as Error).message,
    );
    expect(logs).toEqual([]);
  });

  it.each(CLIENT_MODES)(
    "%s durable 数据优先于 deferred 镜像；fixture 提升后 child 仍可查询和恢复",
    async (mode) => {
      await persistParentAndChild(store);
      const before = await listSessionSubagents(context, { sessionId: SESSION_ID });
      expect(before.childSessionIds).toEqual([CHILD_ID]);
      expect(before.running).toEqual([expect.objectContaining({ childSessionId: CHILD_ID })]);
      // 只模拟已授权持久化后的 record 状态转变；此测试不发送模型消息，不声称首发全流程。
      record.persistence = "immediate";
      record.stateRevision += 1;
      const after = await listSessionSubagents(context, { sessionId: SESSION_ID });
      expect(after.revision).toBe(REVISION + 1);
      expect(after.childSessionIds).toEqual([CHILD_ID]);
      const snapshot = await subscribeSnapshot(gatewayForContext(), mode, "after-promotion");
      expect(snapshot.subagents.running).toEqual([
        expect.objectContaining({ childSessionId: CHILD_ID }),
      ]);
      expect((await store.listSessions()).map((session) => session.id).sort()).toEqual(
        [SESSION_ID, CHILD_ID].sort(),
      );
      expect(
        logs.filter((log) => log.context?.event === "zcode_protocol.v4.gateway_error"),
      ).toEqual([]);
    },
  );

  it.each(CLIENT_MODES)(
    "%s 草稿订阅后，fixture 首次持久化提升可重新恢复真实 child",
    async (mode) => {
      const draft = await subscribeSnapshot(gatewayForContext(), mode, "draft-before-promotion");
      expect(draft.subagents.running).toEqual([]);
      expect(await store.listSessions()).toEqual([]);
      await persistParentAndChild(store);
      record.persistence = "immediate";
      record.stateRevision += 1;
      const restored = await subscribeSnapshot(
        gatewayForContext(),
        mode,
        "restored-after-promotion",
      );
      expect(restored.subagents.running).toEqual([
        expect.objectContaining({ childSessionId: CHILD_ID }),
      ]);
      expect((await listSessionSubagents(context, { sessionId: SESSION_ID })).revision).toBe(
        REVISION + 1,
      );
      expect((await store.listSessions()).map((session) => session.id).sort()).toEqual(
        [SESSION_ID, CHILD_ID].sort(),
      );
      expect(logs.filter((log) => log.level === "warn" || log.level === "error")).toEqual([]);
    },
  );

  it("未配置 store 时保留已有空结果兼容行为", async () => {
    const noStore = makeContext(record, logs);
    const live = await listSessionSubagents(noStore, { sessionId: SESSION_ID });
    expect(live).toEqual({
      revision: REVISION,
      childSessionIds: [],
      running: [],
      ended: { total: 0, items: [] },
    });
    expect(
      (await listSessionSubagents(noStore, { sessionId: "sess_unknown_no_store" })).revision,
    ).toBe(0);
    expect(logs).toEqual([]);
  });
});
