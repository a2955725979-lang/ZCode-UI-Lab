import { useId, useState } from "react";
import { ActivityIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isV4PlanApproval } from "@/v4/pendingInteractionAdapter.js";
import { PlanStatusItemRows } from "@/v4/PlanStatusItemRows.js";

export interface TaskProgressSummaryProps {
  snapshot: ConversationSnapshot | null;
  defaultExpanded?: boolean;
  className?: string;
}

type ProgressState =
  | "preparing"
  | "running"
  | "backgroundRunning"
  | "awaitingAnswer"
  | "awaitingConfirmation"
  | "stopping"
  | "stopped"
  | "failed"
  | "ended";

/** 状态与步骤计数独立：步骤全完成不能把运行、等待或失败改写为验证通过。 */
export function taskProgressState(snapshot: ConversationSnapshot): ProgressState {
  const { control, pendingInteractions } = snapshot;
  if (control.phase === "error") return "failed";
  if (control.stopState === "stopping") return "stopping";
  if (control.phase === "completedInterrupted") return "stopped";
  if (
    pendingInteractions.some(
      (interaction) =>
        interaction.kind === "userInput" &&
        interaction.payload.kind === "userInput" &&
        !isV4PlanApproval(interaction.payload),
    )
  )
    return "awaitingAnswer";
  if (pendingInteractions.length > 0) return "awaitingConfirmation";
  if (control.phase === "prewarming") return "preparing";
  if (control.phase === "running") return "running";
  if (snapshot.backgroundWorks.some((work) => work.status === "running"))
    return "backgroundRunning";
  return "ended";
}

function TaskProgressSummaryContent({
  snapshot,
  defaultExpanded = false,
  className,
}: TaskProgressSummaryProps & { snapshot: ConversationSnapshot }) {
  const { intl } = useZCodeIntl();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const detailsId = useId();
  const items = snapshot.plan?.items ?? [];
  const completed = items.filter((item) => item.status === "completed").length;
  const active = items.filter((item) => item.status === "inProgress");
  const next = items.find((item) => item.status === "pending");
  const currentText =
    active.length > 0
      ? intl.formatMessage(
          { id: "chat.taskProgress.current" },
          { item: active.map((item) => item.content).join(" · ") },
        )
      : next
        ? intl.formatMessage({ id: "chat.taskProgress.next" }, { item: next.content })
        : null;
  const state = taskProgressState(snapshot);
  const statusText = intl.formatMessage({ id: `chat.taskProgress.state.${state}` });
  const countText =
    items.length > 0
      ? intl.formatMessage(
          { id: "chat.taskProgress.completed" },
          { completed: String(completed), total: String(items.length) },
        )
      : null;
  const title = intl.formatMessage({ id: "chat.taskProgress.title" });

  return (
    <section
      aria-label={title}
      className={cn("min-w-0 rounded-xl border border-border bg-surface text-ui-base", className)}
      data-testid="v4-task-progress-summary"
      data-progress-state={state}
    >
      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
        <ActivityIcon aria-hidden className="size-3.5 shrink-0 text-foreground-subtle" />
        <div
          role="status"
          aria-live="polite"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5"
        >
          <span
            className={cn(
              "shrink-0",
              state === "failed" ? "text-destructive" : "text-foreground-subtle",
            )}
          >
            {statusText}
          </span>
          {countText ? (
            <span className="shrink-0 tabular-nums text-foreground">{countText}</span>
          ) : null}
          {currentText ? (
            <span title={currentText} className="min-w-0 flex-1 truncate text-foreground-subtle">
              {currentText}
            </span>
          ) : null}
        </div>
        {items.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={intl.formatMessage({
              id: expanded ? "chat.taskProgress.collapse" : "chat.taskProgress.expand",
            })}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
          </Button>
        ) : null}
      </div>
      {items.length > 0 ? (
        <ul
          id={detailsId}
          hidden={!expanded}
          className="max-h-80 min-h-0 overflow-y-auto px-1 pb-1"
        >
          <PlanStatusItemRows items={items} />
        </ul>
      ) : null}
    </section>
  );
}

export function TaskProgressSummary(props: TaskProgressSummaryProps) {
  if (
    !props.snapshot ||
    (props.snapshot.control.phase === "draft" && !props.snapshot.plan?.items.length)
  )
    return null;
  // 会话/模式改变时只重置本地展开态，不缓存或改写 snapshot 的业务事实。
  return (
    <TaskProgressSummaryContent
      key={JSON.stringify([props.snapshot.sessionId, props.defaultExpanded])}
      {...props}
      snapshot={props.snapshot}
    />
  );
}
