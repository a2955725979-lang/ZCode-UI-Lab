import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Textarea } from "@/components/ui/textarea.js";
import type { WorkTaskStartFields } from "./composerDraftStore.js";

export const EMPTY_WORK_TASK_START: WorkTaskStartFields = {
  outcome: "",
  deliverable: "",
  constraints: "",
};

export function formatWorkTaskBriefPrompt(
  goal: string,
  fields: WorkTaskStartFields | undefined,
  labels: Record<keyof WorkTaskStartFields, string>,
): string {
  const notes = fields
    ? (["outcome", "deliverable", "constraints"] as const).flatMap((key) => {
        const value = fields[key].trim();
        return value ? [`${labels[key]}${value}`] : [];
      })
    : [];
  return notes.length ? `${goal}\n\n${notes.join("\n")}` : goal;
}

/** 简报只编辑原 composerDraft.taskStart；发送仍由同一个 composer admission 负责。 */
export function WorkTaskBrief({
  fields,
  disabled,
  onChange,
}: {
  fields: WorkTaskStartFields;
  disabled: boolean;
  onChange: (fields: WorkTaskStartFields) => void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div data-testid="work-task-brief" className="grid min-w-0 gap-2 md:grid-cols-3">
      {(["outcome", "deliverable", "constraints"] as const).map((key) => (
        <label key={key} className="min-w-0 space-y-1 text-ui-sm text-foreground-subtle">
          <span>{intl.formatMessage({ id: `chat.workBrief.${key}` })}</span>
          <Textarea
            data-testid={`work-task-brief-${key}`}
            aria-label={intl.formatMessage({ id: `chat.workBrief.${key}` })}
            placeholder={intl.formatMessage({ id: `chat.workBrief.${key}.placeholder` })}
            value={fields[key]}
            disabled={disabled}
            onChange={(event) => onChange({ ...fields, [key]: event.target.value })}
            className="min-h-16 resize-y"
          />
        </label>
      ))}
    </div>
  );
}
