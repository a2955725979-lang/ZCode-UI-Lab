import { ArrowRightIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import type { PlanState } from "@zcode/shared/zcode-protocol-v4";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

type PlanStatus = PlanState["items"][number]["status"];

function PlanStatusIcon({ status }: { status: PlanStatus }) {
  if (status === "completed") {
    return <CheckCircle2Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />;
  }
  if (status === "inProgress") {
    return <ArrowRightIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground" />;
  }
  return <CircleIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground-subtlest" />;
}

/** 面板与紧凑摘要共用只读列表；不产生完成命令或第二份计划状态。 */
export function PlanStatusItemRows({ items }: { items: PlanState["items"] }) {
  const { intl } = useZCodeIntl();
  // Todo 标签和显式 id 都可能重复；声明位置为重复项提供渲染身份，不改变协议。
  return items.map((item, index) => (
    <li
      key={JSON.stringify([item.id, index])}
      data-plan-status={item.status}
      aria-label={intl.formatMessage(
        { id: `chat.taskProgress.item.${item.status}` },
        { item: item.content },
      )}
      className="flex min-h-8 items-start gap-2 rounded-lg px-2 py-1.5 text-ui-base hover:bg-hover"
    >
      <PlanStatusIcon status={item.status} />
      <span
        title={item.content}
        className={cn(
          "line-clamp-2 min-w-0 flex-1 break-words leading-5",
          item.status === "completed" ? "text-foreground-subtlest line-through" : "text-foreground",
        )}
      >
        {item.content}
      </span>
    </li>
  ));
}
