import { useState } from "react";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Switch } from "@/components/ui/switch.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import { toast } from "@/components/ui/toast.js";

type Preference = "workTaskStartConfirmationEnabled" | "followupSuggestionsEnabled";
export function TaskCollaborationSettings() {
  const { intl } = useZCodeIntl();
  const { settings, loading, update } = useSettings();
  const [pending, setPending] = useState(false);
  const change = async (field: Preference, value: boolean) => {
    if (pending) return;
    setPending(true);
    try {
      await update({ [field]: value });
    } catch {
      toast(intl.formatMessage({ id: "taskCollaboration.settings.saveFailed" }));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      {(["workTaskStartConfirmationEnabled", "followupSuggestionsEnabled"] as const).map(
        (field) => (
          <SettingsRow
            key={field}
            label={intl.formatMessage({ id: `taskCollaboration.settings.${field}` })}
            description={intl.formatMessage({
              id: `taskCollaboration.settings.${field}.description`,
            })}
            control={
              <Switch
                data-testid={`settings-${field}`}
                aria-label={intl.formatMessage({ id: `taskCollaboration.settings.${field}` })}
                disabled={loading || pending || !settings}
                checked={settings?.[field] !== false}
                onCheckedChange={(value) => {
                  void change(field, value);
                }}
              />
            }
          />
        ),
      )}
      <p className="px-4 py-3 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "taskCollaboration.settings.localBoundary" })}
      </p>
    </>
  );
}
