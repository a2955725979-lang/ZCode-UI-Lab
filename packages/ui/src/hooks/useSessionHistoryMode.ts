import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { WorkspacePurpose } from "@zcode/shared";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";
import {
  createSessionHistoryModePredicate,
  captureSessionHistoryModeResolver,
  getSessionHistoryMode,
  getSessionHistoryFilter,
  setSessionHistoryFilter,
  type SessionHistoryFilter,
  getSessionHistoryModesRevision,
  subscribeSessionHistoryModes,
  type SessionHistoryScope,
  type SessionHistoryTask,
  type SessionHistoryWorkspace,
} from "@/store/sessionHistoryModeStore.js";

function useSessionHistoryRevision(): number {
  return useSyncExternalStore(
    subscribeSessionHistoryModes,
    getSessionHistoryModesRevision,
    getSessionHistoryModesRevision,
  );
}

export function useSessionHistoryMode(
  scope: SessionHistoryScope,
  sessionId: string | null | undefined,
  workspacePurpose?: WorkspacePurpose,
) {
  useSessionHistoryRevision();
  return getSessionHistoryMode(scope, sessionId, workspacePurpose);
}

export function useSessionHistoryModeResolver() {
  const revision = useSessionHistoryRevision();
  return useMemo(() => captureSessionHistoryModeResolver(), [revision]);
}

export function useSessionHistoryFilter() {
  useSessionHistoryRevision();
  const interfaceMode = useZCodeStoreWithDefault((state) => state.interfaceMode, "coding");
  const mode = interfaceMode === "office" ? "chat" : "work";
  const filter = getSessionHistoryFilter(mode);
  const setFilter = useCallback(
    (value: SessionHistoryFilter) => setSessionHistoryFilter(mode, value),
    [mode],
  );
  return { filter, setFilter };
}

export function useSessionHistoryModePredicate(
  workspaces: readonly SessionHistoryWorkspace[],
): (task: SessionHistoryTask) => boolean {
  const revision = useSessionHistoryRevision();
  const interfaceMode = useZCodeStoreWithDefault((state) => state.interfaceMode, "coding");
  const filter = getSessionHistoryFilter(interfaceMode === "office" ? "chat" : "work");
  const workspaceSignature = JSON.stringify(
    workspaces
      .map((scope) => [
        scope.workspaceIdentity?.trim() || scope.workspacePath,
        scope.workspacePurpose ?? null,
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
  return useMemo(
    () => createSessionHistoryModePredicate(filter, workspaces),
    // signature 按值跟踪 scope 分类；引用更新只由模式、归属或有效分类变化触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, revision, workspaceSignature],
  );
}
