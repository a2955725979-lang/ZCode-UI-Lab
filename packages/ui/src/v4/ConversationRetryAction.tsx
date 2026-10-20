import { RotateCcw } from "lucide-react";
import type { ConversationRowTarget } from "@zcode/shared/zcode-protocol-v4";
import { MessageAction } from "@/components/ai-elements/message.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** The caller passes only the authoritative row capability; no pane-phase guard. */
export function ConversationRetryAction({
  target,
  onRetry,
}: {
  target: ConversationRowTarget;
  onRetry?: (target: ConversationRowTarget) => void;
}) {
  const { intl } = useZCodeIntl();
  if (!onRetry) return null;
  const label = intl.formatMessage({ id: "chatWorkspace.regenerate" });
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <MessageAction aria-label={label} label={label} tooltip={label} data-chat-regenerate="true">
          <RotateCcw className="size-3.5" />
        </MessageAction>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {intl.formatMessage({ id: "chatWorkspace.regenerateTitle" })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {intl.formatMessage({ id: "chatWorkspace.regenerateDescription" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{intl.formatMessage({ id: "common.cancel" })}</AlertDialogCancel>
          <AlertDialogAction onClick={() => onRetry(target)}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
