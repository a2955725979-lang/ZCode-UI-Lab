import type { WorkspacePurpose } from "@zcode/shared";
import { logger } from "@/logger.js";

export type SessionHistoryMode = "chat" | "work";
export type SessionHistoryFilter = "all" | SessionHistoryMode;
export interface SessionHistoryScope {
  workspacePath: string;
  workspaceIdentity?: string;
}
export interface SessionHistoryWorkspace extends SessionHistoryScope {
  workspacePurpose?: WorkspacePurpose;
}
export interface SessionHistoryTask extends SessionHistoryWorkspace {
  taskId: string;
}
export interface SessionHistoryModeClaimResult {
  mode: SessionHistoryMode;
  persisted: boolean;
}

type ModeStorage = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "key" | "length">>;
export const SESSION_HISTORY_MODE_STORAGE_PREFIX = "zcode-session-history-mode:v1:";
const SESSION_HISTORY_FILTER_STORAGE_PREFIX = "zcode-session-history-filter:v1:";

function workspaceKey(scope: SessionHistoryScope): string {
  return scope.workspaceIdentity?.trim() || scope.workspacePath;
}

function storageKey(scope: SessionHistoryScope, sessionId: string): string {
  return (
    SESSION_HISTORY_MODE_STORAGE_PREFIX +
    encodeURIComponent(JSON.stringify([workspaceKey(scope), sessionId]))
  );
}

function browserStorage(): ModeStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** 会话内容仍由 Host/Agent 持有；这里只持久化当前安装的展示归属。 */
export function createSessionHistoryModeStore(storageOverride?: ModeStorage) {
  const listeners = new Set<() => void>();
  // UI 分类写入失败仍保留本窗口归属；不把它冒充已持久化的事实。
  const volatileModes = new Map<string, SessionHistoryMode>();
  const volatileFilters = new Map<SessionHistoryMode, SessionHistoryFilter>();
  let revision = 0;
  let stopStorageListener: (() => void) | undefined;
  const emit = () => {
    revision += 1;
    for (const listener of listeners) listener();
  };
  const getStorage = () => storageOverride ?? browserStorage();
  const getSessionHistoryFilter = (mode: SessionHistoryMode): SessionHistoryFilter => {
    const local = volatileFilters.get(mode);
    if (local) return local;
    try {
      const saved = getStorage()?.getItem(SESSION_HISTORY_FILTER_STORAGE_PREFIX + mode);
      return saved === "all" || saved === "chat" || saved === "work" ? saved : mode;
    } catch {
      return mode;
    }
  };
  const setSessionHistoryFilter = (mode: SessionHistoryMode, filter: SessionHistoryFilter) => {
    try {
      const storage = getStorage();
      if (!storage) throw new Error("Session history preference storage is unavailable");
      storage.setItem(SESSION_HISTORY_FILTER_STORAGE_PREFIX + mode, filter);
      volatileFilters.delete(mode);
    } catch {
      // 筛选只是展示偏好，存储不可用时在当前窗口保留选择，不阻断浏览历史。
      volatileFilters.set(mode, filter);
    }
    emit();
  };
  const getExplicitSessionHistoryMode = (
    scope: SessionHistoryScope,
    sessionId: string | null | undefined,
  ): SessionHistoryMode | undefined => {
    if (!sessionId?.trim()) return undefined;
    const volatile = volatileModes.get(storageKey(scope, sessionId));
    if (volatile) return volatile;
    try {
      const value = getStorage()?.getItem(storageKey(scope, sessionId));
      return value === "chat" || value === "work" ? value : undefined;
    } catch {
      // 读取不可用不应让历史页崩溃；显式写入仍报告失败，不伪造持久化成功。
      return undefined;
    }
  };
  const getSessionHistoryMode = (
    scope: SessionHistoryScope,
    sessionId: string | null | undefined,
    workspacePurpose?: WorkspacePurpose,
  ): SessionHistoryMode =>
    getExplicitSessionHistoryMode(scope, sessionId) ??
    (workspacePurpose === "conversation" ? "chat" : "work");
  const captureSessionHistoryModeResolver = () => {
    const snapshot = new Map<string, SessionHistoryMode>();
    try {
      const storage = getStorage();
      for (let index = 0; index < (storage?.length ?? 0); index += 1) {
        const key = storage?.key?.(index);
        if (!key?.startsWith(SESSION_HISTORY_MODE_STORAGE_PREFIX)) continue;
        const value = storage?.getItem(key);
        if (value === "chat" || value === "work") snapshot.set(key, value);
      }
    } catch {
      // 与单条读取相同：不可读取时使用旧记录默认分类，不修改存储。
    }
    for (const [key, mode] of volatileModes) snapshot.set(key, mode);
    return (
      scope: SessionHistoryScope,
      sessionId: string | null | undefined,
      purpose?: WorkspacePurpose,
    ): SessionHistoryMode =>
      (sessionId ? snapshot.get(storageKey(scope, sessionId)) : undefined) ??
      (purpose === "conversation" ? "chat" : "work");
  };
  const setSessionHistoryMode = (
    scope: SessionHistoryScope,
    sessionId: string,
    mode: SessionHistoryMode,
  ): void => {
    if (!workspaceKey(scope).trim() || !sessionId.trim()) {
      throw new Error("Session history classification requires a workspace and session ID");
    }
    const storage = getStorage();
    if (!storage) throw new Error("Session history classification storage is unavailable");
    // 一条会话一个 key；两个窗口分别移动不同会话时不会用旧整表覆盖彼此。
    storage.setItem(storageKey(scope, sessionId), mode);
    volatileModes.delete(storageKey(scope, sessionId));
    emit();
  };
  const claimSessionHistoryMode = (
    scope: SessionHistoryScope,
    sessionId: string,
    mode: SessionHistoryMode,
  ): SessionHistoryModeClaimResult => {
    const existing = getExplicitSessionHistoryMode(scope, sessionId);
    if (existing)
      return { mode: existing, persisted: !volatileModes.has(storageKey(scope, sessionId)) };
    try {
      setSessionHistoryMode(scope, sessionId, mode);
      return { mode, persisted: true };
    } catch (error) {
      // 首发/恢复不可因 UI 分类存储失败阻断已授权的上行；调用者仍能观察未持久化结果。
      logger.warn("[session-history-mode] 自动归属未能持久化", { error });
      volatileModes.set(storageKey(scope, sessionId), mode);
      emit();
      return { mode, persisted: false };
    }
  };
  const subscribeSessionHistoryModes = (listener: () => void) => {
    listeners.add(listener);
    if (!stopStorageListener && typeof window !== "undefined") {
      const onStorage = (event: StorageEvent) => {
        if (
          event.key === null ||
          event.key.startsWith(SESSION_HISTORY_MODE_STORAGE_PREFIX) ||
          event.key.startsWith(SESSION_HISTORY_FILTER_STORAGE_PREFIX)
        ) {
          if (event.key === null) {
            volatileModes.clear();
            volatileFilters.clear();
          } else if (event.key.startsWith(SESSION_HISTORY_FILTER_STORAGE_PREFIX)) {
            volatileFilters.delete(
              event.key.slice(SESSION_HISTORY_FILTER_STORAGE_PREFIX.length) as SessionHistoryMode,
            );
          } else volatileModes.delete(event.key);
          emit();
        }
      };
      window.addEventListener("storage", onStorage);
      stopStorageListener = () => window.removeEventListener("storage", onStorage);
      // 无订阅期间也可能有其它窗口写入；React 提交订阅后重新读取快照。
      revision += 1;
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopStorageListener?.();
        stopStorageListener = undefined;
      }
    };
  };
  return {
    getSessionHistoryFilter,
    setSessionHistoryFilter,
    getSessionHistoryMode,
    hasUnpersistedSessionHistoryMode: (
      scope: SessionHistoryScope,
      sessionId: string | null | undefined,
    ) => Boolean(sessionId && volatileModes.has(storageKey(scope, sessionId))),
    captureSessionHistoryModeResolver,
    getExplicitSessionHistoryMode,
    setSessionHistoryMode,
    claimSessionHistoryMode,
    subscribeSessionHistoryModes,
    getSessionHistoryModesRevision: () => revision,
  };
}

export const {
  getSessionHistoryFilter,
  setSessionHistoryFilter,
  getSessionHistoryMode,
  hasUnpersistedSessionHistoryMode,
  captureSessionHistoryModeResolver,
  getExplicitSessionHistoryMode,
  setSessionHistoryMode,
  claimSessionHistoryMode,
  subscribeSessionHistoryModes,
  getSessionHistoryModesRevision,
} = createSessionHistoryModeStore();

export function createSessionHistoryModePredicate(
  mode: SessionHistoryFilter,
  workspaces: readonly SessionHistoryWorkspace[],
): (task: SessionHistoryTask) => boolean {
  const resolve = captureSessionHistoryModeResolver();
  const purposes = new Map(
    workspaces.map((scope) => [workspaceKey(scope), scope.workspacePurpose]),
  );
  return (task) =>
    mode === "all" ||
    resolve(task, task.taskId, purposes.get(workspaceKey(task)) ?? task.workspacePurpose) === mode;
}
