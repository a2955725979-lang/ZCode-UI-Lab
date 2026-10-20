import { FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useGlobalInstructions } from "@/hooks/useGlobalInstructions.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";

export function GlobalInstructionsSection({ available }: { available: boolean }) {
  const { intl } = useZCodeIntl();
  const file = useGlobalInstructions(available);
  const message = (id: string) => intl.formatMessage({ id: `settings.globalInstructions.${id}` });

  return (
    <div className="space-y-4">
      <p className="text-ui-base leading-6 text-foreground-subtle">{message("description")}</p>
      {!available ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-ui-base text-foreground-subtle">
          {message("localOnly")}
        </div>
      ) : (
        <SettingsGroupCard>
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-ui-base font-medium">
                <FileText className="size-4 text-foreground-subtle" aria-hidden="true" />
                AGENTS.md
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={file.busy}
                onClick={() => void file.refresh()}
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {message("refresh")}
              </Button>
            </div>
            {file.error ? (
              <Alert variant="destructive">
                <AlertDescription>{file.error}</AlertDescription>
              </Alert>
            ) : null}
            {file.status ? (
              <>
                <div className="space-y-1">
                  <p className="text-ui-caption text-foreground-subtle">{message("path")}</p>
                  <p
                    className="break-all rounded-lg bg-surface px-3 py-2 text-ui-base select-text"
                    data-testid="settings-global-instructions-path"
                  >
                    {file.status.path}
                  </p>
                </div>
                <p role="status" className="text-ui-base text-foreground-subtle">
                  {message(file.status.exists ? "exists" : "missing")}
                </p>
                {!file.status.exists ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={file.busy}
                    onClick={() => void file.create()}
                  >
                    {message("create")}
                  </Button>
                ) : file.editorsLoading ? (
                  <p className="text-ui-base text-foreground-subtle">{message("loadingEditors")}</p>
                ) : file.selectedEditor ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={file.selectedEditor.id}
                      onValueChange={file.selectEditor}
                      disabled={file.busy}
                    >
                      <SelectTrigger className="w-full sm:w-56" aria-label={message("editor")}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {file.editors.map((editor) => (
                          <SelectItem key={editor.id} value={editor.id}>
                            {editor.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={file.busy}
                      onClick={() => void file.open()}
                    >
                      {message("open")}
                    </Button>
                  </div>
                ) : (
                  <p className="text-ui-base text-foreground-subtle">{message("noEditor")}</p>
                )}
                {file.editorError ? (
                  <Alert variant="destructive">
                    <AlertDescription>{file.editorError}</AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : file.busy ? (
              <p role="status" className="text-ui-base text-foreground-subtle">
                {message("loading")}
              </p>
            ) : null}
            <p className="text-ui-caption leading-6 text-foreground-subtle">
              {message("saveHint")}
            </p>
          </div>
        </SettingsGroupCard>
      )}
    </div>
  );
}
