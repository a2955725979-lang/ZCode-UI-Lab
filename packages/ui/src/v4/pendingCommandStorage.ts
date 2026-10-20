// Registry 的逐项持久化适配器；不拥有 runtime queue，也不发起命令。
import type { PendingCommandEntry } from "@/v4/pendingCommandRegistry.js";
import { resolvePendingCommandWorkspaceKey } from "@/v4/pendingCommandWorkspace.js";

export const PENDING_COMMAND_LEGACY_STORAGE_KEY = "zcode-v4-pending-commands:v1";
export const PENDING_COMMAND_RECORD_PREFIX = "zcode-v4-pending-command:v2:";
export const PENDING_COMMAND_RESOLVED_PREFIX = "zcode-v4-resolved-command:v2:";
export const PENDING_COMMAND_SETTLED_PREFIX = "zcode-v4-settled-command:v2:";
export type PendingCommandStorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const localNotifications = new Set<{
  storage: PendingCommandStorageLike | undefined;
  owner: PendingCommandStorage;
  notify: () => void;
}>();

export function pendingCommandEntryKey(entry: PendingCommandEntry): string {
  return encodeURIComponent(
    JSON.stringify([resolvePendingCommandWorkspaceKey(entry), entry.clientId, entry.commandId]),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEntry(value: unknown): value is PendingCommandEntry {
  if (!isObject(value)) return false;
  const { replay, clientContext } = value;
  if (!isObject(replay) || typeof replay.type !== "string") return false;
  const validReplay =
    replay.kind === "input"
      ? ["sendText", "sendGoalCommand", "compact", "createSession"].includes(replay.type) &&
        isObject(replay.payload) &&
        (replay.baseRevision === undefined || typeof replay.baseRevision === "number")
      : replay.kind === "queryOnly"
        ? replay.type === "forkAssistant" || replay.type === "createSelectionSideSession"
        : replay.kind === "sensitiveDigest" &&
          [
            "resolveInteraction",
            "respondWorkspaceHookReview",
            "toggleWorkspaceHookReviewItem",
            "revokeWorkspaceHookTrust",
          ].includes(replay.type) &&
          typeof replay.digest === "string";
  if (!validReplay) return false;
  if (clientContext !== undefined) {
    if (!isObject(clientContext)) return false;
    const workspace = clientContext.workspace;
    if (
      workspace !== undefined &&
      (!isObject(workspace) ||
        typeof workspace.workspacePath !== "string" ||
        (workspace.workspaceIdentity !== undefined &&
          typeof workspace.workspaceIdentity !== "string"))
    )
      return false;
  }
  return (
    typeof value.commandId === "string" &&
    typeof value.clientId === "string" &&
    (typeof value.sessionId === "string" || value.sessionId === null) &&
    typeof value.issuedAt === "number" &&
    Number.isFinite(value.issuedAt) &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt) &&
    (value.recoveryDismissed === undefined || typeof value.recoveryDismissed === "boolean") &&
    (value.resolvedSessionId === undefined || typeof value.resolvedSessionId === "string")
  );
}

interface ResolvedSession {
  sessionId: string;
  expiresAt: number;
}
function parseResolved(raw: string | null, now: number): ResolvedSession | undefined {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    return isObject(value) &&
      typeof value.sessionId === "string" &&
      value.sessionId.length > 0 &&
      typeof value.expiresAt === "number" &&
      value.expiresAt > now
      ? (value as unknown as ResolvedSession)
      : undefined;
  } catch {
    return undefined;
  }
}

export class PendingCommandStorage {
  private readonly fallbackEntries = new Map<string, PendingCommandEntry>();
  private readonly fallbackSettled = new Map<string, number>();
  private readonly fallbackResolved = new Map<string, ResolvedSession>();
  private lastRead = new Map<string, PendingCommandEntry>();
  private readonly listeners = new Set<() => void>();
  private stopListening: (() => void) | undefined;

  constructor(
    private readonly storage: PendingCommandStorageLike | undefined,
    private readonly now: () => number,
  ) {}

  read(): readonly PendingCommandEntry[] {
    const now = this.now();
    let entries = new Map(this.lastRead);
    const settled = new Map(this.fallbackSettled);
    const resolved = new Map(this.fallbackResolved);
    if (this.storage) {
      try {
        const disk = new Map<string, PendingCommandEntry>();
        // 先冻结 key 列表；遍历时清理到期项不会跳过相邻记录。
        const keys = Array.from({ length: this.storage.length }, (_, i) =>
          this.storage!.key(i),
        ).filter((key): key is string => key !== null);
        for (const key of keys) {
          if (!key.startsWith(PENDING_COMMAND_SETTLED_PREFIX)) continue;
          try {
            const value = JSON.parse(this.storage.getItem(key) ?? "null") as {
              expiresAt?: unknown;
            } | null;
            if (typeof value?.expiresAt === "number" && value.expiresAt > now)
              settled.set(key.slice(PENDING_COMMAND_SETTLED_PREFIX.length), value.expiresAt);
            else this.storage.removeItem(key);
          } catch {
            /* 单条坏记录不影响其它命令。 */
          }
        }
        for (const key of keys) {
          if (!key.startsWith(PENDING_COMMAND_RESOLVED_PREFIX)) continue;
          const value = parseResolved(this.storage.getItem(key), now);
          if (value) resolved.set(key.slice(PENDING_COMMAND_RESOLVED_PREFIX.length), value);
          else this.storage.removeItem(key);
        }
        for (const key of keys) {
          if (!key.startsWith(PENDING_COMMAND_RECORD_PREFIX)) continue;
          try {
            const value: unknown = JSON.parse(this.storage.getItem(key) ?? "null");
            if (
              !isEntry(value) ||
              pendingCommandEntryKey(value) !== key.slice(PENDING_COMMAND_RECORD_PREFIX.length)
            )
              continue;
            if (value.expiresAt > now) disk.set(pendingCommandEntryKey(value), value);
            else this.storage.removeItem(key);
          } catch {
            /* 单条坏记录不影响其它命令。 */
          }
        }
        // 保留只读 v1，避免两窗口迁移时删掉对方尚未导入的数据。
        // v2/tombstone 优先，legacy 重读也不能复活终态或撤销 session remap。
        let legacy: unknown;
        try {
          legacy = JSON.parse(this.storage.getItem(PENDING_COMMAND_LEGACY_STORAGE_KEY) ?? "null");
        } catch {
          legacy = null;
        }
        if (Array.isArray(legacy))
          for (const entry of legacy) {
            if (!isEntry(entry) || entry.expiresAt <= now) continue;
            const id = pendingCommandEntryKey(entry);
            if (disk.has(id) || settled.has(id)) continue;
            disk.set(id, entry);
          }
        entries = disk;
      } catch {
        // storage 读取失败时保留最近已知的本窗口提示，不冒充可跨窗口持久化。
      }
    }
    for (const [id, entry] of this.fallbackEntries) entries.set(id, entry);
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= now || settled.has(id)) entries.delete(id);
      else if (
        resolved.has(id) &&
        resolved.get(id)!.expiresAt > now &&
        entry.replay.kind === "input" &&
        entry.replay.type === "createSession"
      )
        entries.set(id, { ...entry, sessionId: resolved.get(id)!.sessionId });
    }
    for (const [id, expiry] of this.fallbackSettled)
      if (expiry <= now) this.fallbackSettled.delete(id);
    for (const [id, entry] of this.fallbackEntries)
      if (entry.expiresAt <= now) this.fallbackEntries.delete(id);
    for (const [id, value] of this.fallbackResolved)
      if (value.expiresAt <= now) this.fallbackResolved.delete(id);
    this.lastRead = entries;
    return [...entries.values()];
  }

  write(entry: PendingCommandEntry): boolean {
    const id = pendingCommandEntryKey(entry);
    if (entry.expiresAt <= this.now() || this.isSettled(id)) return false;
    // createSession 绑定是单调事实；独立 key 防止另一个窗口的旧 null 快照倒退绑定。
    if (entry.replay.kind === "input" && entry.replay.type === "createSession") {
      let resolved = this.fallbackResolved.get(id);
      try {
        resolved =
          parseResolved(
            this.storage?.getItem(PENDING_COMMAND_RESOLVED_PREFIX + id) ?? null,
            this.now(),
          ) ?? resolved;
      } catch {
        /* 仅内存退化。 */
      }
      if (!resolved && entry.sessionId !== null) {
        resolved = { sessionId: entry.sessionId, expiresAt: entry.expiresAt };
        this.fallbackResolved.set(id, resolved);
        try {
          this.storage?.setItem(PENDING_COMMAND_RESOLVED_PREFIX + id, JSON.stringify(resolved));
        } catch {
          /* 仅内存退化。 */
        }
      }
      if (resolved && resolved.expiresAt > this.now())
        entry = { ...entry, sessionId: resolved.sessionId };
    }
    try {
      if (!this.storage) throw new Error("storage unavailable");
      this.storage.setItem(PENDING_COMMAND_RECORD_PREFIX + id, JSON.stringify(entry));
      this.fallbackEntries.delete(id);
    } catch {
      this.fallbackEntries.set(id, entry);
    }
    this.lastRead.set(id, entry);
    this.emit();
    return true;
  }

  settle(entry: PendingCommandEntry): void {
    const id = pendingCommandEntryKey(entry);
    // 删除先留下独立终态；旧 renderer 即便在检查后写回旧 record，读取仍由 tombstone 裁决。
    this.fallbackSettled.set(id, entry.expiresAt);
    this.fallbackEntries.delete(id);
    this.lastRead.delete(id);
    try {
      this.storage?.setItem(
        PENDING_COMMAND_SETTLED_PREFIX + id,
        JSON.stringify({ expiresAt: entry.expiresAt }),
      );
      this.storage?.removeItem(PENDING_COMMAND_RECORD_PREFIX + id);
    } catch {
      /* 配额/私密模式仅保留当前 renderer 的终态。 */
    }
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.stopListening) {
      const local = { storage: this.storage, owner: this, notify: () => this.notify() };
      localNotifications.add(local);
      const onStorage = (event: StorageEvent) => {
        if (event.storageArea && event.storageArea !== this.storage) return;
        if (
          event.key === null ||
          event.key === PENDING_COMMAND_LEGACY_STORAGE_KEY ||
          event.key.startsWith(PENDING_COMMAND_RECORD_PREFIX) ||
          event.key.startsWith(PENDING_COMMAND_SETTLED_PREFIX) ||
          event.key.startsWith(PENDING_COMMAND_RESOLVED_PREFIX)
        )
          this.notify();
      };
      if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
      this.stopListening = () => {
        localNotifications.delete(local);
        if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
      };
    }
    // render 到 effect 订阅之间可能已有另一窗口写入，重新读取而非等待下一事件。
    listener();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopListening?.();
        this.stopListening = undefined;
      }
    };
  }

  dispose(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    this.listeners.clear();
  }

  private isSettled(id: string): boolean {
    if ((this.fallbackSettled.get(id) ?? 0) > this.now()) return true;
    try {
      const value = JSON.parse(
        this.storage?.getItem(PENDING_COMMAND_SETTLED_PREFIX + id) ?? "null",
      ) as { expiresAt?: unknown } | null;
      return typeof value?.expiresAt === "number" && value.expiresAt > this.now();
    } catch {
      return false;
    }
  }

  private emit(): void {
    this.notify();
    for (const peer of localNotifications)
      if (peer.storage === this.storage && peer.owner !== this) peer.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
