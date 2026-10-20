import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { ElicitationDialog } from "@/ElicitationDialog.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  consumeTaskInteractionOpenRequest,
  getTaskInteractionOpenRequest,
  subscribeTaskInteractionOpen,
} from "@/v4/taskAttentionNavigation.js";

export { isV4PlanApproval } from "@/v4/pendingInteractionAdapter.js";

export interface InteractionAutoResolutionIntentTracker {
  markInteracted(interactionId: string): void;
  consumeSnooze(interactionId: string, autoResolutionReady: boolean): boolean;
  releaseSnooze(interactionId: string): void;
}

export function createInteractionAutoResolutionIntentTracker(): InteractionAutoResolutionIntentTracker {
  const interactedIds = new Set<string>();
  const sentIds = new Set<string>();
  return {
    markInteracted(interactionId) {
      interactedIds.add(interactionId);
    },
    consumeSnooze(interactionId, autoResolutionReady) {
      if (!autoResolutionReady || !interactedIds.has(interactionId) || sentIds.has(interactionId)) {
        return false;
      }
      sentIds.add(interactionId);
      return true;
    },
    releaseSnooze(interactionId) {
      sentIds.delete(interactionId);
    },
  };
}

export function buildV4ElicitationProgressKey(
  request: ComponentProps<typeof ElicitationDialog>["request"],
): string {
  return `${request.requestId}:${request.currentQuestionIndex ?? 0}:${JSON.stringify(request.answerDrafts ?? {})}`;
}

interface ResponseState {
  pending: boolean;
  failed: boolean;
  accepted: boolean;
}
// renderer 只持有提交覆盖层/展示意图；runtime 的 pendingInteractions 始终是权威。
const responseStates = new Map<string, ResponseState>();
const responseListeners = new Set<() => void>();
const automaticallyOpenedQuestions = new Set<string>();
function subscribeResponse(listener: () => void) {
  responseListeners.add(listener);
  return () => {
    responseListeners.delete(listener);
  };
}
function updateResponse(key: string, state: ResponseState | null) {
  if (state) responseStates.set(key, state);
  else responseStates.delete(key);
  for (const listener of responseListeners) listener();
}
export function buildV4InteractionScopeKey(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string,
  interactionId: string,
): string {
  return JSON.stringify([workspaceIdentity?.trim() || workspacePath, sessionId, interactionId]);
}
export function pruneV4ElicitationState(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string,
  activeRequestIds: ReadonlySet<string>,
) {
  const isExpired = (key: string) => {
    const [identity, taskId, requestId] = JSON.parse(key) as [string, string, string];
    return (
      identity === (workspaceIdentity?.trim() || workspacePath) &&
      taskId === sessionId &&
      !activeRequestIds.has(requestId)
    );
  };
  for (const key of automaticallyOpenedQuestions)
    if (isExpired(key)) automaticallyOpenedQuestions.delete(key);
  for (const key of responseStates.keys()) if (isExpired(key)) updateResponse(key, null);
}
export function useInteractionDocumentVisible() {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
interface V4ElicitationDialogProps extends Omit<
  ComponentProps<typeof ElicitationDialog>,
  "responding" | "responseError" | "onDefer" | "onRespond"
> {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  isPlanApproval: boolean;
  canRestoreFocus: () => boolean;
  resolveResponse: (
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ) => Promise<boolean>;
  onAccepted: () => void;
}

export function V4ElicitationDialog({
  workspacePath,
  workspaceIdentity,
  sessionId,
  isPlanApproval,
  canRestoreFocus,
  resolveResponse,
  onAccepted,
  ...formProps
}: V4ElicitationDialogProps) {
  const { intl } = useZCodeIntl();
  const key = buildV4InteractionScopeKey(
    workspacePath,
    workspaceIdentity,
    sessionId,
    formProps.request.requestId,
  );
  const [open, setOpen] = useState(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const entryRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const response = useSyncExternalStore(
    subscribeResponse,
    () => responseStates.get(key) ?? null,
    () => null,
  );
  const openRequest = useSyncExternalStore(
    subscribeTaskInteractionOpen,
    getTaskInteractionOpenRequest,
    () => null,
  );
  const openQuestion = useCallback(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  useEffect(() => {
    if (!isPlanApproval && !automaticallyOpenedQuestions.has(key)) {
      automaticallyOpenedQuestions.add(key);
      openQuestion();
    }
  }, [isPlanApproval, key, openQuestion]);
  useEffect(() => {
    if (isPlanApproval || !openRequest || !canRestoreFocus()) return;
    if (
      (openRequest.workspaceIdentity?.trim() || openRequest.workspacePath) !==
        (workspaceIdentity?.trim() || workspacePath) ||
      openRequest.sessionId !== sessionId ||
      (openRequest.interactionId && openRequest.interactionId !== formProps.request.requestId)
    )
      return;
    if (consumeTaskInteractionOpenRequest(openRequest)) openQuestion();
  }, [
    canRestoreFocus,
    formProps.request.requestId,
    isPlanApproval,
    openQuestion,
    openRequest,
    sessionId,
    workspaceIdentity,
    workspacePath,
  ]);
  const deferQuestion = () => {
    void formProps.onFirstInteraction?.("navigation");
    setOpen(false);
  };
  const dialog = (
    <ElicitationDialog
      {...formProps}
      key={buildV4ElicitationProgressKey(formProps.request)}
      responding={response?.pending === true || response?.accepted === true}
      responseError={
        response?.failed ? intl.formatMessage({ id: "chat.elicitation.responseFailed" }) : undefined
      }
      onDefer={deferQuestion}
      onRespond={(_requestId, action, content) => {
        const existing = responseStates.get(key);
        if (existing?.pending || existing?.accepted) return;
        // 同步登记，再发既有命令，重挂载或并行点击都不能绕过同一 scoped request 的锁。
        const flight = { pending: true, failed: false, accepted: false };
        updateResponse(key, flight);
        void resolveResponse(action, content).then((accepted) => {
          if (responseStates.get(key) === flight)
            updateResponse(key, { pending: false, failed: !accepted, accepted });
          // 迟到 ACK 仅更新原请求覆盖层；不会调用新会话/新请求的成功回调。
          if (accepted && mountedRef.current) onAccepted();
        });
      }}
    />
  );
  if (isPlanApproval) return dialog;
  return (
    <>
      <Button
        ref={entryRef}
        type="button"
        variant="outline"
        data-elicitation-pending-entry={formProps.request.requestId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openQuestion}
        className="w-full justify-start gap-2"
      >
        <span className="shrink-0">
          {intl.formatMessage({ id: "chat.elicitation.waitingAnswer" })}
        </span>
        <span className="truncate text-foreground-subtle">{formProps.request.message}</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) deferQuestion();
        }}
      >
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          data-elicitation-modal={formProps.request.requestId}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            deferQuestion();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!canRestoreFocus() || document.visibilityState === "hidden") return;
            if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
            else entryRef.current?.focus();
          }}
          className="max-w-2xl gap-0 border-0 bg-transparent p-0 shadow-none max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0"
        >
          <DialogTitle className="sr-only">
            {intl.formatMessage({ id: "chat.elicitation.title" })}
          </DialogTitle>
          {dialog}
        </DialogContent>
      </Dialog>
    </>
  );
}
