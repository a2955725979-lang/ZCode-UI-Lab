// V4 已提交命令的 renderer 持久账本。
// 它只保存客户端恢复线索，不参与 conversation projection，也绝不能据此自动重放。
import type {
  CommandAck,
  CommandEnvelope,
  CommandsQueryParams,
  CommandsQueryResult,
  ConversationSnapshot,
} from "@zcode/shared/zcode-protocol-v4";
import { claimSessionHistoryMode } from "@/store/sessionHistoryModeStore.js";
import {
  isPendingCommandForWorkspace,
  type PendingCommandClientContext,
} from "@/v4/pendingCommandWorkspace.js";
import {
  PendingCommandStorage,
  type PendingCommandStorageLike,
  pendingCommandEntryKey,
} from "@/v4/pendingCommandStorage.js";
import { pendingCommandReplayFor, type PendingCommandReplay } from "@/v4/pendingCommandReplay.js";
export type { PendingCommandReplay } from "@/v4/pendingCommandReplay.js";

export const PENDING_COMMAND_TTL_MS = 24 * 60 * 60 * 1_000;
export interface PendingCommandWorkspaceScope {
  workspacePath: string;
  workspaceIdentity?: string;
}

export type PendingCommandRecoveryReason = "discarded" | "creationUnknown" | "creationRecovered";

export interface PendingCommandEntry {
  commandId: string;
  clientId: string;
  sessionId: string | null;
  issuedAt: number;
  expiresAt: number;
  replay: PendingCommandReplay;
  clientContext?: PendingCommandClientContext;
  recovery?: PendingCommandRecoveryReason;
  recoveryDismissed?: boolean;
  resolvedSessionId?: string;
}

export interface PendingCommandReplayRequest {
  type: "sendText" | "sendGoalCommand" | "compact" | "createSession";
  payload: Record<string, unknown>;
  sessionId: string | null;
  baseRevision?: number;
  clientContext?: PendingCommandClientContext;
}

export interface PendingCommandRegistryOptions {
  storage?: PendingCommandStorageLike;
  now?: () => number;
}

type QueryCommands = (params: CommandsQueryParams) => Promise<CommandsQueryResult>;

function browserStorage(): PendingCommandStorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function clonePayload(payload: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function isRuntimeLocalDiscard(ack: CommandAck): boolean {
  return (
    ack.reasonCode === "fault.command.inputDiscardedOnRestart" &&
    ack.result?.type === "inputDisposition" &&
    (ack.result.delivery === "queue" || ack.result.delivery === "guide")
  );
}

/**
 * ACK、queue 与 transcript 曾分别维护临时状态；renderer 刷新或 ACK 丢失后，
 * UI 已清空但无法证明 CLI 是否 admission。这里把“待对账线索”先于上行持久化，并用
 * queue/guided/transcript sourceCommandId 或显式终态收口；registry 本身永远不产生权威事实。
 */
export class PendingCommandRegistry {
  private readonly now: () => number;
  private readonly persistence: PendingCommandStorage;
  private readonly reconcileInFlight = new Map<string, Promise<void>>();

  constructor(options: PendingCommandRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.persistence = new PendingCommandStorage(options.storage ?? browserStorage(), this.now);
  }

  subscribe(listener: () => void): () => void {
    return this.persistence.subscribe(listener);
  }

  record(
    envelope: CommandEnvelope,
    clientContext?: PendingCommandClientContext,
  ): PendingCommandEntry | null {
    const replay = pendingCommandReplayFor(envelope);
    if (!replay) return null;
    const entry: PendingCommandEntry = {
      commandId: envelope.commandId,
      clientId: envelope.clientId,
      sessionId: envelope.sessionId,
      issuedAt: envelope.issuedAt,
      // TTL 锚定首次登记时间；reload/reconcile 不得续期。
      expiresAt: this.now() + PENDING_COMMAND_TTL_MS,
      replay,
      ...(clientContext ? { clientContext } : {}),
    };
    const existing = this.persistence
      .read()
      .find((value) => pendingCommandEntryKey(value) === pendingCommandEntryKey(entry));
    if (existing) return existing;
    return this.persistence.write(entry) ? entry : null;
  }

  list(
    sessionId: string | null,
    scope?: PendingCommandWorkspaceScope,
  ): readonly PendingCommandEntry[] {
    return this.persistence
      .read()
      .filter(
        (entry) =>
          entry.sessionId === sessionId &&
          (!scope ||
            isPendingCommandForWorkspace(entry, scope.workspacePath, scope.workspaceIdentity)),
      )
      .sort((left, right) => left.issuedAt - right.issuedAt);
  }

  listRecoverable(
    sessionId: string | null,
    scope?: PendingCommandWorkspaceScope,
  ): readonly PendingCommandEntry[] {
    return this.list(sessionId, scope).filter(
      (entry) =>
        (entry.recovery === "discarded" ||
          entry.recovery === "creationUnknown" ||
          entry.recovery === "creationRecovered") &&
        !entry.recoveryDismissed,
    );
  }

  settle(sessionId: string | null, commandId: string, scope?: PendingCommandWorkspaceScope): void {
    const entry = this.findEntry(sessionId, commandId, scope);
    if (entry) this.persistence.settle(entry);
  }

  dismissRecovery(
    sessionId: string | null,
    commandId: string,
    scope?: PendingCommandWorkspaceScope,
  ): void {
    const entry = this.findEntry(sessionId, commandId, scope);
    if (!entry?.recovery || entry.recoveryDismissed) return;
    this.persistence.write({ ...entry, recoveryDismissed: true });
  }

  markCreationUncertain(
    sessionId: string | null,
    commandId: string,
    scope?: PendingCommandWorkspaceScope,
  ): void {
    const entry = this.findEntry(sessionId, commandId, scope);
    if (entry?.replay.kind === "queryOnly") this.markRecovery(entry, "creationUnknown");
  }

  applyAck(envelope: CommandEnvelope, ack: CommandAck, scope?: PendingCommandWorkspaceScope): void {
    let entry = this.findEntry(envelope.sessionId, envelope.commandId, scope, envelope.clientId);
    if (!entry) return;
    if (entry.replay.kind === "sensitiveDigest") {
      // 交互答案不可重放；拿到确定 ACK 后其对账职责已结束。
      this.settleEntry(entry);
      return;
    }
    this.claimHistoryModeFromAck(entry, ack);
    if (entry.replay.kind === "queryOnly") {
      // 正常 ACK 调用者已打开 child；仅丢失 ACK 后 query 才需要显示恢复入口。
      this.settleEntry(entry);
      return;
    }
    entry = this.remapCreatedSession(entry, ack);
    if (ack.status === "accepted" || ack.status === "duplicate") {
      this.clearRecovery(entry);
      return;
    }
    if (ack.status === "failed" && ack.reasonCode === "fault.command.inputDiscardedOnRestart") {
      if (isRuntimeLocalDiscard(ack)) {
        this.settleEntry(entry);
        return;
      }
      this.markRecovery(entry, "discarded");
      return;
    }
    this.settleEntry(entry);
  }

  applyQuery(result: CommandsQueryResult, scope?: PendingCommandWorkspaceScope): void {
    for (const item of result.results) {
      let entry = this.findEntry(item.key.sessionId, item.key.commandId, scope);
      if (!entry) continue;
      if (item.result === "unknown" && entry.replay.kind === "queryOnly") {
        this.markRecovery(entry, "creationUnknown");
        continue;
      }
      if (item.result === "unknown") {
        // V4 初版把“权威事实未命中”提升成需要用户处理的错误横幅，导致正常的
        // App/CLI 生命周期切换也频繁打扰用户。unknown 没有可操作结论，renderer 静默清账。
        this.settleEntry(entry);
        continue;
      }
      if (
        item.result.status === "failed" &&
        item.result.reasonCode === "fault.command.queryUnavailable"
      ) {
        continue;
      }
      if (
        item.result.status === "failed" &&
        item.result.reasonCode === "fault.command.inputDiscardedOnRestart"
      ) {
        if (isRuntimeLocalDiscard(item.result)) {
          this.settleEntry(entry);
          continue;
        }
        this.markRecovery(entry, "discarded");
        continue;
      }
      this.claimHistoryModeFromAck(entry, item.result);
      if (entry.replay.kind === "queryOnly") {
        const result = item.result.result;
        if (
          (item.result.status === "accepted" || item.result.status === "duplicate") &&
          (result?.type === "forkAssistant" || result?.type === "createSelectionSideSession")
        ) {
          this.persistence.write({
            ...entry,
            resolvedSessionId: result.sessionId,
            recovery: "creationRecovered",
            recoveryDismissed: false,
          });
        } else if (item.result.status === "failed" || item.result.status === "rejected") {
          this.settleEntry(entry);
        } else this.markRecovery(entry, "creationUnknown");
        continue;
      }
      entry = this.remapCreatedSession(entry, item.result);
      if (entry.replay.kind === "sensitiveDigest") {
        this.settleEntry(entry);
        continue;
      }
      if (item.result.status === "accepted" || item.result.status === "duplicate") {
        this.clearRecovery(entry);
      } else {
        this.settleEntry(entry);
      }
    }
  }

  reconcileSnapshot(snapshot: ConversationSnapshot, scope?: PendingCommandWorkspaceScope): void {
    const settled = new Set<string>();
    for (const item of snapshot.queue.items) {
      if (item.sourceCommandId) {
        // 把“进入 queue”当成仍未投递的话，直到 transcript 才清理
        // localStorage；App/CLI 重启后旧 runtime queue 被正常丢弃，却又触发重发提示。
        // queue projection 已是 CLI 权威接收证据，renderer ingress 账本应在此结算。
        settled.add(item.sourceCommandId);
      }
    }
    for (const row of snapshot.rows.window) {
      if (row.kind === "userInput" && row.sourceCommandId) {
        settled.add(row.sourceCommandId);
      }
      if (row.kind === "timelineMarker" && row.marker.type === "compact" && row.sourceCommandId) {
        // compact 不产生 user row；timeline marker 是该维护命令已开始执行的权威证据。
        settled.add(row.sourceCommandId);
      }
    }
    if (settled.size === 0) return;
    for (const commandId of settled) this.settle(snapshot.sessionId, commandId, scope);
  }

  reconcileSession(
    sessionId: string | null,
    query: QueryCommands,
    scope: PendingCommandWorkspaceScope,
  ): Promise<void> {
    const inFlightKey = JSON.stringify([
      scope.workspaceIdentity?.trim() || scope.workspacePath,
      sessionId,
    ]);
    const existing = this.reconcileInFlight.get(inFlightKey);
    if (existing) return existing;
    const pending = this.runReconcile(sessionId, query, scope).finally(() => {
      if (this.reconcileInFlight.get(inFlightKey) === pending)
        this.reconcileInFlight.delete(inFlightKey);
    });
    this.reconcileInFlight.set(inFlightKey, pending);
    return pending;
  }

  consumeReplay(
    key: {
      sessionId: string | null;
      commandId: string;
    },
    scope?: PendingCommandWorkspaceScope,
  ): PendingCommandReplayRequest | null {
    const entry = this.findEntry(key.sessionId, key.commandId, scope);
    if (!entry || entry.replay.kind !== "input") return null;
    const request: PendingCommandReplayRequest = {
      type: entry.replay.type,
      payload: clonePayload(entry.replay.payload),
      sessionId: entry.sessionId,
      ...(entry.replay.baseRevision !== undefined
        ? { baseRevision: entry.replay.baseRevision }
        : {}),
      ...(entry.clientContext ? { clientContext: entry.clientContext } : {}),
    };
    // 用户已确认以新 commandId 重发，旧 discarded 线索在本地完成收口。
    this.settleEntry(entry);
    return request;
  }

  dispose(): void {
    this.persistence.dispose();
  }

  private async runReconcile(
    sessionId: string | null,
    query: QueryCommands,
    scope: PendingCommandWorkspaceScope,
  ): Promise<void> {
    // 必须先按 workspace 筛选，再发 query；展示时过滤不能阻止错 Host 的 unknown 删除 B。
    const entries = this.list(sessionId, scope);
    for (let offset = 0; offset < entries.length; offset += 64) {
      const batch = entries.slice(offset, offset + 64);
      const frozen = new Map(batch.map((entry) => [entry.commandId, JSON.stringify(entry)]));
      const result = await query({
        commands: batch.map((entry) => ({
          sessionId: entry.sessionId,
          commandId: entry.commandId,
        })),
      });
      // 回包只能更新本批且未变化的提示；迟到 query 不覆盖 dismiss、remap 或其它窗口已结算项。
      this.applyQuery(
        {
          results: result.results.filter((item) => {
            if (item.key.sessionId !== sessionId) return false;
            const current = this.findEntry(item.key.sessionId, item.key.commandId, scope);
            return current && frozen.get(item.key.commandId) === JSON.stringify(current);
          }),
        },
        scope,
      );
    }
  }

  private findEntry(
    sessionId: string | null,
    commandId: string,
    scope?: PendingCommandWorkspaceScope,
    clientId?: string,
  ): PendingCommandEntry | undefined {
    const matches = this.list(sessionId, scope).filter(
      (entry) => entry.commandId === commandId && (!clientId || entry.clientId === clientId),
    );
    // 兼容旧调用，但身份有歧义时宁可保留提示，不能结算另一个 workspace 的命令。
    return matches.length === 1 ? matches[0] : undefined;
  }

  private settleEntry(entry: PendingCommandEntry): void {
    this.persistence.settle(entry);
  }

  private markRecovery(entry: PendingCommandEntry, recovery: PendingCommandRecoveryReason): void {
    if (entry.recovery !== recovery)
      this.persistence.write({ ...entry, recovery, recoveryDismissed: false });
  }

  private clearRecovery(entry: PendingCommandEntry): void {
    if (!entry.recovery && !entry.recoveryDismissed) return;
    const { recovery: _recovery, recoveryDismissed: _dismissed, ...settled } = entry;
    this.persistence.write(settled);
  }

  private claimHistoryModeFromAck(entry: PendingCommandEntry, ack: CommandAck): void {
    if (ack.status !== "accepted" && ack.status !== "duplicate") return;
    const { workspace, sessionHistoryMode } = entry.clientContext ?? {};
    if (!workspace || (sessionHistoryMode !== "chat" && sessionHistoryMode !== "work")) return;
    const result = ack.result;
    const sessionId =
      result?.type === "createSession" ||
      result?.type === "forkAssistant" ||
      result?.type === "createSelectionSideSession"
        ? result.sessionId
        : entry.replay.kind === "queryOnly"
          ? null
          : entry.sessionId;
    if (sessionId) claimSessionHistoryMode(workspace, sessionId, sessionHistoryMode);
  }

  private remapCreatedSession(entry: PendingCommandEntry, ack: CommandAck): PendingCommandEntry {
    if (
      entry.replay.kind !== "input" ||
      entry.replay.type !== "createSession" ||
      (ack.status !== "accepted" && ack.status !== "duplicate") ||
      ack.result?.type !== "createSession" ||
      entry.sessionId === ack.result.sessionId
    ) {
      return entry;
    }
    const remapped = { ...entry, sessionId: ack.result.sessionId };
    this.persistence.write(remapped);
    return remapped;
  }
}

export const pendingCommandRegistry = new PendingCommandRegistry();
