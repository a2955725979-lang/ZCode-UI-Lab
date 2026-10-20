import { useSessionHistoryMode } from "@/hooks/useSessionHistoryMode.js";
import { useOptionalTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { setSessionHistoryMode, type SessionHistoryScope } from "@/store/sessionHistoryModeStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";

/** 列表与标题菜单共用本地归属命令；不迁移 session/cwd，也不改变权限。 */
export function useSessionHistoryActions(scope: SessionHistoryScope, sessionId: string | null | undefined) {
  const { intl } = useZCodeIntl();
  const purpose = useOptionalTabStore((state) => {
    const tab = state.tabs.find((item) => isWorkspaceTab(item) &&
      (item.workspaceIdentity?.trim() || item.workspacePath) ===
        (scope.workspaceIdentity?.trim() || scope.workspacePath));
    return tab && isWorkspaceTab(tab) ? tab.workspacePurpose : undefined;
  });
  const historyMode = useSessionHistoryMode(scope, sessionId, purpose);
  const moveHistoryMode = () => {
    if (!sessionId) return;
    const target = historyMode === "chat" ? "work" : "chat";
    try {
      setSessionHistoryMode(scope, sessionId, target);
      toast(intl.formatMessage({ id: target === "chat" ? "chatWorkspace.movedToChat" : "chatWorkspace.movedToWork" }));
    } catch {
      toast(intl.formatMessage({ id: "chatWorkspace.moveFailed" }));
    }
  };
  return { historyMode, moveHistoryMode };
}
