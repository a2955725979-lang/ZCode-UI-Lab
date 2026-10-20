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
