import { useState } from "react";
import { ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { FollowupSuggestion } from "@/v4/followupSuggestions.js";

export function FollowupPreview({
  suggestions,
  canAccept,
  onPrepareAccept,
  onAccept,
}: {
  suggestions: readonly FollowupSuggestion[];
  canAccept: boolean;
  onPrepareAccept: () => void;
  onAccept: (suggestion: FollowupSuggestion, keyboard?: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const [expanded, setExpanded] = useState(false);
  const items = suggestions.slice(0, expanded ? 3 : 1);
  const message = (id: string) => intl.formatMessage({ id: `chat.followupSuggestions.${id}` });
  if (items.length === 0) return null;
  return (
    <div data-testid="followup-suggestions" className="mb-2 space-y-1 px-1 text-ui-base">
      <div className="flex items-center gap-2 text-ui-caption text-foreground-subtlest">
        <span>{message("title")}</span>
        {canAccept ? <span>{message("tabHint")}</span> : <span>{message("draftHint")}</span>}
        {suggestions.length > 1 ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? message("less") : message("more")}
            <ChevronDown className="size-3" />
          </Button>
        ) : null}
      </div>
      {items.map((suggestion, index) => (
        <div
          key={`${index}:${suggestion.prompt}`}
          className="flex min-w-0 items-start gap-1 rounded-lg bg-surface px-2 py-1"
        >
          <div className="min-w-0 flex-1">
            {canAccept ? (
              <button
                type="button"
                className="text-left text-ui-base font-medium text-foreground hover:underline"
                data-testid={`followup-accept-${index}`}
                onPointerDown={onPrepareAccept}
                onClick={(event) => onAccept(suggestion, event.detail === 0)}
              >
                {suggestion.label}
              </button>
            ) : (
              <span className="text-ui-base font-medium text-foreground">{suggestion.label}</span>
            )}
            <p
              className="line-clamp-2 whitespace-pre-wrap break-words text-ui-caption text-foreground-subtle"
              title={suggestion.prompt}
            >
              {suggestion.prompt}
            </p>
          </div>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={message("copy")}
            title={message("copy")}
            onClick={() => {
              void Promise.resolve()
                .then(() => navigator.clipboard.writeText(suggestion.prompt))
                .catch((error) =>
                  logger.warn("[followup-suggestions] clipboard write failed", {
                    error: String(error),
                  }),
                );
            }}
          >
            <Copy className="size-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}
