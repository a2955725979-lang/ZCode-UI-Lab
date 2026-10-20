import { Button } from "@/components/ui/button.js";
import { Kbd } from "@/components/ui/kbd.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useIsMobileTextInputViewport } from "@/lib/mobileTextInput.js";
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
  const isMobileTextInputViewport = useIsMobileTextInputViewport();
  const items = suggestions.slice(0, 3);
  if (!canAccept || items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={intl.formatMessage({ id: "chat.followupSuggestions.title" })}
      data-testid="followup-suggestions"
      className="mb-2 flex min-w-0 items-center gap-2 overflow-x-auto px-1 py-1"
    >
      {items.map((suggestion, index) => (
        <Tooltip key={`${index}:${suggestion.prompt}`}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-w-0 max-w-full"
              data-testid={`followup-accept-${index}`}
              onPointerDown={onPrepareAccept}
              onClick={(event) => onAccept(suggestion, event.detail === 0)}
            >
              <span className="truncate">{suggestion.label}</span>
              {index === 0 && !isMobileTextInputViewport ? (
                <Kbd className="[@media(hover:none)]:hidden">
                  {intl.formatMessage({ id: "chat.followupSuggestions.tabHint" })}
                </Kbd>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="whitespace-pre-wrap break-words">
            {suggestion.prompt}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
