import { useEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from "react";
import type { ZCodeElicitationRequest } from "@zcode/shared";
import type { ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import { ElicitationDialog, type ElicitationDialogHandle } from "@/ElicitationDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useTaskInteractionReveal } from "@/v4/taskAttentionNavigation.js";

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

export function getCurrentSessionInteractionSnapshot(
  sessionId: string,
  snapshot: ConversationSnapshot | null,
): ConversationSnapshot | null {
  return snapshot?.sessionId === sessionId ? snapshot : null;
}

export function resolveV4ElicitationRequest(
  projected: ZCodeElicitationRequest | null,
  botProgress: ZCodeElicitationRequest | null,
): ZCodeElicitationRequest | null {
  // Bugfix：V4 snapshot 只保留原始阻塞请求，Bot 代答后的逐题进度必须覆盖同一 request 的投影。
  if (projected && botProgress?.requestId === projected.requestId) {
    return botProgress;
  }
  return projected;
}

interface ResponseState {
  pending: boolean;
  failed: boolean;
  accepted: boolean;
}
// renderer 只持有提交覆盖层/展示意图；runtime 的 pendingInteractions 始终是权威。
const responseStates = new Map<string, ResponseState>();
const responseListeners = new Set<() => void>();
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
  "responding" | "responseError" | "onRespond" | "ref"
> {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
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
  const cardRef = useRef<ElicitationDialogHandle | null>(null);
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
  useTaskInteractionReveal(
    { workspacePath, workspaceIdentity, sessionId, interactionId: formProps.request.requestId },
    formProps.autoFocus !== false,
    cardRef,
  );
  return (
    <ElicitationDialog
      {...formProps}
      ref={cardRef}
      key={buildV4ElicitationProgressKey(formProps.request)}
      responding={response?.pending === true || response?.accepted === true}
      responseError={
        response?.failed ? intl.formatMessage({ id: "chat.elicitation.responseFailed" }) : undefined
      }
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
}
