import { useCallback, useEffect, useRef, useState } from "react";
import {
  TID_V4_USER_INPUT_DIALOG,
  TID_V4_USER_INPUT_OPTION,
  TID_V4_USER_INPUT_TEXT,
  testId,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { isImeComposingKeyEvent } from "@/lib/imeComposition.js";
import type { V4UserInputViewModel } from "@/v4/pendingInteractionAdapter.js";
import { runUserAction } from "@/lib/userActionTelemetry.js";

export interface V4UserInputDialogProps {
  model: V4UserInputViewModel;
  autoFocus?: boolean;
  onSubmit: (answer: { optionId?: string; freeText?: string }) => void;
}

/** 未结构化的 userInput 复用 dock 内联卡片，敏感输入不改变协议与密码类型。 */
export function V4UserInputDialog({ model, autoFocus = true, onSubmit }: V4UserInputDialogProps) {
  const { intl } = useZCodeIntl();
  const [freeText, setFreeText] = useState("");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const compositionActiveRef = useRef(false);
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      cardRef.current?.querySelector<HTMLElement>("button, input")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const handleOption = useCallback(
    (optionId: string) => {
      runUserAction({
        input: {
          featureId: "conversation.blocking.user_input",
          action: "select_option",
          trigger: "button",
        },
        operation: () => onSubmit({ optionId }),
        completed: { resultSource: "optimistic_projection" },
        failureStage: "user_input_submit",
      });
    },
    [onSubmit],
  );

  const handleFreeTextSubmit = useCallback(() => {
    const trimmed = freeText.trim();
    if (!trimmed && model.freeText) return;
    onSubmit(model.freeText ? { freeText: trimmed } : { optionId: model.options[0]?.optionId });
  }, [freeText, model.freeText, model.options, onSubmit]);

  return (
    <div
      ref={cardRef}
      className="flex w-full flex-col gap-3 rounded-2xl border border-border bg-popover p-3 shadow-xs"
      data-testid={TID_V4_USER_INPUT_DIALOG}
    >
      <p className="text-ui-base font-medium text-foreground">{model.prompt}</p>
      {model.options.length > 0 ? (
        <div className="space-y-1" role="group" aria-label={model.prompt}>
          {model.options.map((option, index) => (
            <Button
              key={option.optionId}
              type="button"
              variant="ghost"
              data-testid={testId(TID_V4_USER_INPUT_OPTION, option.optionId)}
              onClick={() => handleOption(option.optionId)}
              className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-2 text-left whitespace-normal"
            >
              <span className="w-5 shrink-0 text-foreground-subtlest">{index + 1}.</span>
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}
      {model.freeText ? (
        <div className="flex flex-col gap-3">
          <Input
            type={model.sensitive ? "password" : "text"}
            aria-label={model.prompt}
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            onCompositionStart={() => {
              compositionActiveRef.current = true;
            }}
            onCompositionEnd={() => {
              compositionActiveRef.current = false;
            }}
            onKeyDown={(event) => {
              if (
                isImeComposingKeyEvent({
                  ...event,
                  compositionActive: compositionActiveRef.current,
                })
              )
                return;
              if (event.key === "Enter") {
                event.preventDefault();
                handleFreeTextSubmit();
              }
            }}
            data-testid={TID_V4_USER_INPUT_TEXT}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleFreeTextSubmit}
              className="bg-brand text-foreground-inverse hover:bg-brand/80"
            >
              {intl.formatMessage({ id: "chat.elicitation.submit" })}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
