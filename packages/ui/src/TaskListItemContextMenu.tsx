import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu.js";
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu.js";
import { TaskActionMenuContent } from "@/TaskActionMenuContent.js";

export function TaskListItemContextMenu({
  intl,
  variant = "context",
  isPinned,
  fileManagerLabel,
  taskSessionFile,
  activeSessionId,
  taskNativeSessionLogFile,
  providerConfigFile,
  onTogglePinTask,
  onStartRenameTask,
  onArchiveTask,
  onMarkTaskAsUnread,
  historyMode,
  onMoveHistoryMode,
  onOpenInSplitPane,
  openInSplitPaneDisabled,
  onOpenTaskFeedback,
  onOpenTaskPathInFileManager,
  onCopyWorkspacePath,
  onCopyTaskPath,
  onCopyTaskLogPath,
  onCopySessionId,
  onViewModelTrajectory,
  onOpenProviderConfig,
  disableTaskActions = false,
  disabledReason,
}: {
  intl: {
    formatMessage: (
      desc: { id: string },
      values?: Record<string, string>,
    ) => string;
  };
  variant?: "context" | "dropdown";
  isPinned: boolean;
  fileManagerLabel: string;
  taskSessionFile: { loading: boolean; path: string | null; exists: boolean };
  activeSessionId?: string | null;
  taskNativeSessionLogFile: {
    loading: boolean;
    path: string | null;
    exists: boolean;
  };
  providerConfigFile: { loading: boolean; path: string | null; exists: boolean };
  onTogglePinTask: () => void;
  onStartRenameTask: () => void;
  onArchiveTask: () => void;
  onMarkTaskAsUnread: () => void;
  historyMode?: "chat" | "work";
  onMoveHistoryMode?: () => void;
  /** 「在分屏打开」（仅桌面 shell 传入）。 */
  onOpenInSplitPane?: () => void;
  /** 叶子数达上限且该 session 未在任何 pane 时禁用。 */
  openInSplitPaneDisabled?: boolean;
  onOpenTaskFeedback: () => void;
  onOpenTaskPathInFileManager: () => void;
  onCopyWorkspacePath: () => void;
  onCopyTaskPath: () => void;
  onCopyTaskLogPath: () => void;
  onCopySessionId?: () => void;
  onViewModelTrajectory?: () => void;
  onOpenProviderConfig: () => void;
  disableTaskActions?: boolean;
  disabledReason?: string;
}) {
  const Content = variant === "dropdown" ? DropdownMenuContent : ContextMenuContent;
  return (
    <Content className="w-52" onClick={(event) => {
      // 菜单 portal 仍会沿 React 树冒泡到任务行；操作菜单不能同时触发打开/复活该会话。
      if (variant === "dropdown") event.stopPropagation();
    }}>
      <TaskActionMenuContent
        intl={intl}
        isPinned={isPinned}
        fileManagerLabel={fileManagerLabel}
        taskSessionFile={taskSessionFile}
        activeSessionId={activeSessionId}
        taskNativeSessionLogFile={taskNativeSessionLogFile}
        providerConfigFile={providerConfigFile}
        Item={variant === "dropdown" ? DropdownMenuItem : ContextMenuItem}
        Separator={variant === "dropdown" ? DropdownMenuSeparator : ContextMenuSeparator}
        onTogglePinTask={onTogglePinTask}
        onStartRenameTask={onStartRenameTask}
        onArchiveTask={onArchiveTask}
        onMarkTaskAsUnread={onMarkTaskAsUnread}
        historyMode={historyMode}
        onMoveHistoryMode={onMoveHistoryMode}
        onOpenInSplitPane={onOpenInSplitPane}
        openInSplitPaneDisabled={openInSplitPaneDisabled}
        onOpenTaskFeedback={onOpenTaskFeedback}
        onOpenTaskPathInFileManager={onOpenTaskPathInFileManager}
        onCopyWorkspacePath={onCopyWorkspacePath}
        onCopyTaskPath={onCopyTaskPath}
        onCopyTaskLogPath={onCopyTaskLogPath}
        onCopySessionId={onCopySessionId}
        onViewModelTrajectory={onViewModelTrajectory}
        onOpenProviderConfig={onOpenProviderConfig}
        disableTaskActions={disableTaskActions}
        disabledReason={disabledReason}
      />
    </Content>
  );
}
