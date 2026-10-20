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

type UserInputAnswer = { optionId?: string; freeText?: string };

/** Hooks stay in the existing V4InteractionDialogs owner; no response queue is added. */
export function useUserInputResponse(
  scopeKey: string,
  resolveResponse: (answer: UserInputAnswer) => Promise<boolean>,
) {
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const flights = useRef(new Set<string>());
  const [response, setResponse] = useState<{ scopeKey: string; failed: boolean } | null>(null);
  const onSubmit = (answer: UserInputAnswer) => {
    if (flights.current.has(scopeKey)) return;
    flights.current.add(scopeKey);
    setResponse({ scopeKey, failed: false });
    const settle = (accepted: boolean) => {
      flights.current.delete(scopeKey);
      if (currentScope.current === scopeKey) setResponse({ scopeKey, failed: !accepted });
    };
    void resolveResponse(answer).then(settle, () => settle(false));
  };
  return {
    scopeKey,
    responding: flights.current.has(scopeKey),
    failed: response?.scopeKey === scopeKey && response.failed,
    onSubmit,
  };
}

export interface V4UserInputDialogProps {
  model: V4UserInputViewModel;
  autoFocus?: boolean;
  responding?: boolean;
  responseFailed?: boolean;
  onSubmit: (answer: UserInputAnswer) => void;
}

/** 未结构化的 userInput 复用 dock 内联卡片，敏感输入不改变协议与密码类型。 */
export function V4UserInputDialog({
  model,
  autoFocus = true,
  responding = false,
  responseFailed = false,
  onSubmit,
}: V4UserInputDialogProps) {
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
      if (responding) return;
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
    [onSubmit, responding],
  );

  const handleFreeTextSubmit = useCallback(() => {
    if (responding) return;
    const trimmed = freeText.trim();
    if (!trimmed && model.freeText) return;
    onSubmit(model.freeText ? { freeText: trimmed } : { optionId: model.options[0]?.optionId });
  }, [freeText, model.freeText, model.options, onSubmit, responding]);

  // 原因：队列用负 margin 延伸 blur 背景；通用输入卡沿用权限/问答的前景层，避免标题被覆盖。
  return (
    <div
      ref={cardRef}
      className="relative z-1 flex w-full flex-col gap-3 rounded-2xl border border-border bg-popover p-3 shadow-xs"
      data-testid={TID_V4_USER_INPUT_DIALOG}
      aria-busy={responding}
    >
      <p className="text-ui-base font-medium text-foreground">{model.prompt}</p>
      {model.options.length > 0 ? (
        <div className="space-y-1" role="group" aria-label={model.prompt}>
          {model.options.map((option, index) => (
            <Button
              key={option.optionId}
              type="button"
              variant="ghost"
              data-focus-style="row"
              disabled={responding}
              data-testid={testId(TID_V4_USER_INPUT_OPTION, option.optionId)}
              onClick={() => handleOption(option.optionId)}
              className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-2 text-left whitespace-normal focus-visible:bg-hover"
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
            disabled={responding}
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
              disabled={responding}
              className="bg-brand text-foreground-inverse hover:bg-brand/80"
            >
              {intl.formatMessage({
                id: responding ? "chat.elicitation.submitting" : "chat.elicitation.submit",
              })}
            </Button>
          </div>
        </div>
      ) : null}
      {responding && !model.freeText ? (
        <p role="status" className="text-ui-base text-foreground-subtle">
          {intl.formatMessage({ id: "chat.elicitation.submitting" })}
        </p>
      ) : null}
      {responseFailed ? (
        <p role="alert" className="text-ui-base text-destructive">
          {intl.formatMessage({ id: "chat.elicitation.responseFailed" })}
        </p>
      ) : null}
    </div>
  );
}
