import { BriefcaseBusiness, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useZCodeStoreWithDefault } from "@/store/StoreProvider.js";

/** A presentation preference; model and permission state keep their existing owners. */
export function WorkspaceModeSwitcher({ className }: { className?: string }) {
  const { intl } = useZCodeIntl();
  const mode = useZCodeStoreWithDefault((state) => state.interfaceMode, "coding");
  const setMode = useZCodeStoreWithDefault((state) => state.setInterfaceMode, undefined);
  if (!setMode) return null;
  return (
    <div
      role="group"
      aria-label={intl.formatMessage({ id: "settings.interfaceMode" })}
      data-workspace-mode-switcher="true"
      className={cn(
        "flex items-center gap-1 rounded-xl bg-surface p-1 [app-region:no-drag]",
        className,
      )}
    >
      {(["office", "coding"] as const).map((value) => {
        const Icon = value === "office" ? MessageCircle : BriefcaseBusiness;
        return (
          <Button
            key={value}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={mode === value}
            data-workspace-mode={value}
            className={cn(
              "min-w-0 flex-1 gap-1.5 text-ui-base",
              mode === value ? "bg-selected text-foreground" : "text-foreground-subtle",
            )}
            onClick={() => setMode(value)}
          >
            <Icon className="size-3.5 shrink-0" />
            {intl.formatMessage({
              id: value === "office" ? "chatWorkspace.chat" : "chatWorkspace.work",
            })}
          </Button>
        );
      })}
    </div>
  );
}
