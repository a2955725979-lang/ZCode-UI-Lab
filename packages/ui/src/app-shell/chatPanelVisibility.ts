import type { WorkspaceSidePaneState } from "@/lib/workspaceSidePane.js";

/** Content previews remain usable in Chat; only engineering surfaces are concealed. */
export function shouldHideEngineeringSidePane(
  isChatMode: boolean,
  state: WorkspaceSidePaneState | null | undefined,
): boolean {
  if (!isChatMode) return false;
  const active = state?.tabs.find((tab) => tab.id === state.activeTabId) ?? state?.tabs.at(-1);
  if (!active) return true;
  return (
    active.type === "git" ||
    active.type === "terminal" ||
    active.type === "treemapping" ||
    active.type === "model-trajectory" ||
    active.type === "developer-tools"
  );
}
