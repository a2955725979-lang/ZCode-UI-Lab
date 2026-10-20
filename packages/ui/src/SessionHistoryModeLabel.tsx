import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SessionHistoryMode } from "@/store/sessionHistoryModeStore.js";

export function SessionHistoryModeLabel({ mode }: { mode: SessionHistoryMode }) {
  const { intl } = useZCodeIntl();
  return (
    <span
      className="shrink-0 rounded-md bg-surface px-1.5 text-ui-xs text-foreground-subtle"
      data-session-history-mode-label
    >
      {intl.formatMessage({ id: `chatWorkspace.${mode}` })}
    </span>
  );
}
