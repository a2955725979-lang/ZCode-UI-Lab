import { useMemo, useRef, useState } from "react";
import {
  CircleAlertIcon,
  InboxIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  RefreshCwIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.js";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { deriveTaskAttention, isTaskAttentionItem, taskAttentionKey } from "@/lib/taskAttention.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { requestTaskInteractionOpen } from "@/v4/taskAttentionNavigation.js";

export interface TaskAttentionDialogProps {
  workspaceTabs: WorkspaceTabState[];
  onSelectTask: (
    workspacePath: string,
    taskId: string,
    workspaceIdentity?: string,
    remoteSessionId?: string,
  ) => void;
}

export function TaskAttentionDialog({ workspaceTabs, onSelectTask }: TaskAttentionDialogProps) {
  const { intl } = useZCodeIntl();
  const [open, setOpen] = useState(false);
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const taskList = useGlobalTaskList({
    kind: "timeline",
    workspaceTabs,
    sortBy: "updated",
    searchQuery: "",
    expanded: true,
    collapsedLimit: 0,
    predicate: isTaskAttentionItem,
  });
  const workspaceByKey = useMemo(
    () =>
      new Map(
        workspaceTabs.map((tab) => [tab.workspaceIdentity?.trim() || tab.workspacePath, tab]),
      ),
    [workspaceTabs],
  );
  const title = intl.formatMessage({ id: "taskAttention.title" });
  const refreshLabel = intl.formatMessage({ id: "taskAttention.refresh" });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground"
          data-testid="task-attention-trigger"
        >
          <InboxIcon aria-hidden className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          <span className="shrink-0 text-ui-sm tabular-nums text-foreground-subtle">
            {taskList.total}
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent
        className="min-w-0 sm:max-w-xl"
        data-testid="task-attention-dialog"
        onCloseAutoFocus={(event) => {
          // 修复原因：同步导航发生时 Radix focus trap 尚未卸载，会挡住目标会话的 focus。
          // 关闭完成后再导航；Esc/关闭仍由真正的 Trigger 恢复焦点。
          const navigate = pendingNavigationRef.current;
          if (!navigate) return;
          event.preventDefault();
          pendingNavigationRef.current = null;
          navigate();
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "taskAttention.description" })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "taskAttention.count" }, { count: String(taskList.total) })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void taskList.refresh();
            }}
            disabled={taskList.loading}
          >
            <RefreshCwIcon aria-hidden className="size-3.5" />
            {refreshLabel}
          </Button>
        </div>
        {taskList.loading ? (
          <p role="status" className="flex items-center gap-2 text-ui-base text-foreground-subtle">
            <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
            {intl.formatMessage({ id: "taskAttention.loading" })}
          </p>
        ) : null}
        {!taskList.loading && taskList.items.length === 0 ? (
          <p className="py-4 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "taskAttention.empty" })}
          </p>
        ) : null}
        {/* 修复原因：满宽条目的外侧焦点环需要滚动容器留白，避免被 overflow 裁掉。 */}
        <ul
          className="-m-1 max-h-[min(60dvh,32rem)] min-h-0 space-y-1 overflow-y-auto p-1"
          aria-label={title}
        >
          {taskList.items.map((task) => {
            const attention = deriveTaskAttention(task);
            if (!attention) return null;
            const workspace = workspaceByKey.get(
              task.workspaceIdentity?.trim() || task.workspacePath,
            );
            const Icon =
              attention.kind === "userInput"
                ? MessageCircleQuestionIcon
                : attention.kind === "permission"
                  ? ShieldQuestionIcon
                  : CircleAlertIcon;
            return (
              <li key={taskAttentionKey(task)}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left text-ui-base hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
                  data-attention-kind={attention.kind}
                  onClick={() => {
                    pendingNavigationRef.current = () => {
                      // 先沿现有路由选择真实会话，再提交可跨 mount 保留的 UI 打开意图。
                      onSelectTask(
                        task.workspacePath,
                        task.taskId,
                        task.workspaceIdentity,
                        task.remoteSessionId ?? workspace?.remoteSessionId,
                      );
                      if (attention.kind === "userInput")
                        requestTaskInteractionOpen({
                          workspacePath: task.workspacePath,
                          workspaceIdentity: task.workspaceIdentity,
                          sessionId: task.taskId,
                          interactionId: attention.interactionId,
                        });
                    };
                    setOpen(false);
                  }}
                >
                  <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {task.title.trim() || intl.formatMessage({ id: "taskAttention.untitled" })}
                    </span>
                    <span className="block truncate text-ui-sm text-foreground-subtle">
                      {workspace?.label || task.workspacePath} ·{" "}
                      {intl.formatMessage({ id: `taskAttention.kind.${attention.kind}` })}
                      {task.sourceAvailability === "offline"
                        ? ` · ${intl.formatMessage({ id: "taskAttention.offline" })}`
                        : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
