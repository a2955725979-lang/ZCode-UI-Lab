import { useEffect, useSyncExternalStore, type RefObject } from "react";

/** Renderer-local navigation intent only. Runtime interaction facts remain authoritative. */
export interface TaskInteractionOpenRequest {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  interactionId?: string;
}
let pendingRequest: TaskInteractionOpenRequest | null = null;
const listeners = new Set<() => void>();
export function requestTaskInteractionOpen(
  target: TaskInteractionOpenRequest,
): TaskInteractionOpenRequest {
  pendingRequest = { ...target };
  for (const listener of listeners) listener();
  return pendingRequest;
}
export function subscribeTaskInteractionOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getTaskInteractionOpenRequest(): TaskInteractionOpenRequest | null {
  return pendingRequest;
}
export function consumeTaskInteractionOpenRequest(request: TaskInteractionOpenRequest): boolean {
  if (pendingRequest !== request) return false;
  pendingRequest = null;
  for (const listener of listeners) listener();
  return true;
}

export function matchesTaskInteractionOpenRequest(
  request: TaskInteractionOpenRequest,
  target: TaskInteractionOpenRequest,
): boolean {
  return (
    (request.workspaceIdentity?.trim() || request.workspacePath) ===
      (target.workspaceIdentity?.trim() || target.workspacePath) &&
    request.sessionId === target.sessionId &&
    (!request.interactionId || request.interactionId === target.interactionId)
  );
}

/** 每个视图只消费匹配的显式导航意图，不创建新的 pending 或展开态所有者。 */
export function useTaskInteractionReveal(
  target: TaskInteractionOpenRequest,
  enabled: boolean,
  targetRef: RefObject<HTMLElement | { reveal(): void } | null>,
) {
  const request = useSyncExternalStore(
    subscribeTaskInteractionOpen,
    getTaskInteractionOpenRequest,
    () => null,
  );
  useEffect(() => {
    const card = targetRef.current;
    if (!enabled || !card || !request || !matchesTaskInteractionOpenRequest(request, target))
      return;
    if (!consumeTaskInteractionOpenRequest(request)) return;
    if ("reveal" in card) card.reveal();
    else {
      card.scrollIntoView?.({ block: "nearest" });
      (
        card.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
        ) ?? card
      ).focus();
    }
  }, [enabled, request, target, targetRef]);
}
