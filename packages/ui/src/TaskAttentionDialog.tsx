import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleAlertIcon,
  InboxIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import { useCachedTaskAttention } from "@/hooks/useCachedTaskAttention.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { deriveTaskAttention, taskAttentionKey } from "@/lib/taskAttention.js";
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
  const tasks = useCachedTaskAttention(workspaceTabs);
  useEffect(() => {
    if (tasks.length === 0) setOpen(false);
  }, [tasks.length]);
  const workspaceByKey = useMemo(
    () =>
      new Map(
        workspaceTabs.map((tab) => [tab.workspaceIdentity?.trim() || tab.workspacePath, tab]),
      ),
    [workspaceTabs],
  );
  const title = intl.formatMessage({ id: "taskAttention.title" });
  if (tasks.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full justify-start gap-2 text-foreground hover:bg-surface-hover hover:text-foreground"
          data-testid="task-attention-trigger"
        >
          <InboxIcon aria-hidden className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          <span
            data-attention-count
            className="shrink-0 rounded-md bg-interaction-confirmation-surface px-1.5 text-ui-xs tabular-nums text-interaction-confirmation-foreground"
          >
            {tasks.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="min-w-0 w-80 max-w-full"
        data-testid="task-attention-popover"
        onCloseAutoFocus={(event) => {
          // 修复原因：关闭 Popover 的自动焦点恢复不能抢回目标会话已取得的焦点。
          // 关闭完成后再导航；Escape/Trigger 关闭继续使用 Radix 的正常焦点恢复。
          const navigate = pendingNavigationRef.current;
          if (!navigate) return;
          event.preventDefault();
          pendingNavigationRef.current = null;
          navigate();
        }}
      >
        <PopoverHeader>
          <PopoverTitle>{title}</PopoverTitle>
        </PopoverHeader>
        {/* 修复原因：满宽条目的外侧焦点环需要滚动容器留白，避免被 overflow 裁掉。 */}
        <ul className="-m-1 max-h-80 min-h-0 space-y-1 overflow-y-auto p-1" aria-label={title}>
          {tasks.map((task) => {
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
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full min-w-0 items-start justify-start gap-2 rounded-lg px-2 py-2 text-left text-ui-base whitespace-normal"
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
                </Button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
