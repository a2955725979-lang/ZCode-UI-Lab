import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Textarea } from "@/components/ui/textarea.js";
import type { WorkTaskStartFields } from "./composerDraftStore.js";

export const EMPTY_WORK_TASK_START: WorkTaskStartFields = {
  outcome: "",
  deliverable: "",
  constraints: "",
};

export function formatWorkTaskStartPrompt(goal: string, fields?: WorkTaskStartFields): string {
  const notes = fields
    ? [
        fields.outcome.trim() && `Expected outcome: ${fields.outcome.trim()}`,
        fields.deliverable.trim() && `Deliverable: ${fields.deliverable.trim()}`,
        fields.constraints.trim() && `Constraints: ${fields.constraints.trim()}`,
      ].filter(Boolean)
    : [];
  return notes.length ? `${goal}\n\n${notes.join("\n")}` : goal;
}

export function WorkTaskStartDialog({
  open,
  goal,
  attachmentNames,
  imagePreviews = [],
  fields,
  onFieldsChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  goal: string;
  attachmentNames: readonly string[];
  imagePreviews?: readonly { id: string; src: string; filename: string }[];
  fields: WorkTaskStartFields;
  onFieldsChange: (fields: WorkTaskStartFields) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { intl } = useZCodeIntl();
  const message = (id: string) => intl.formatMessage({ id: `chat.workTaskStart.${id}` });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent data-testid="work-task-start-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{message("title")}</DialogTitle>
          <DialogDescription>{message("description")}</DialogDescription>
        </DialogHeader>
        {/* 修复原因：滚动容器会裁掉满宽输入框的外侧键盘轮廓；留白不改变字段的内容宽度。 */}
        <div className="-m-1 max-h-96 min-w-0 space-y-3 overflow-y-auto p-1">
          <div className="space-y-1">
            <p className="text-ui-base font-medium">{message("goal")}</p>
            <p className="whitespace-pre-wrap break-words text-ui-base text-foreground-subtle">
              {goal || message("attachmentsOnly")}
            </p>
          </div>
          {attachmentNames.length > 0 ? (
            <div className="space-y-1">
              <p className="text-ui-base font-medium">{message("attachments")}</p>
              {imagePreviews.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {imagePreviews.map((image) => (
                    <img
                      key={image.id}
                      src={image.src}
                      alt={image.filename}
                      className="size-12 rounded-md object-cover"
                    />
                  ))}
                </div>
              ) : null}
              <ul className="list-disc pl-4 text-ui-caption text-foreground-subtle">
                {attachmentNames.map((name, index) => (
                  <li key={`${index}:${name}`} className="break-words">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {(["outcome", "deliverable", "constraints"] as const).map((key) => (
            <label key={key} className="block space-y-1 text-ui-base">
              <span>{message(key)}</span>
              <Textarea
                data-testid={`work-task-start-${key}`}
                value={fields[key]}
                onChange={(event) => onFieldsChange({ ...fields, [key]: event.target.value })}
                placeholder={message("optional")}
                className="min-h-16"
              />
            </label>
          ))}
          <p className="text-ui-caption text-foreground-subtlest">{message("localDraftHint")}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {message("cancel")}
          </Button>
          <Button type="button" data-testid="work-task-start-confirm" onClick={onConfirm}>
            {message("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
