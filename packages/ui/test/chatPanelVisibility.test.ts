import { describe, expect, it } from "vitest";
import { shouldHideEngineeringSidePane } from "@/app-shell/chatPanelVisibility.js";
import type { WorkspaceSidePaneState, WorkspaceSidePaneTab } from "@/lib/workspaceSidePane.js";
function state(type: WorkspaceSidePaneTab["type"]): WorkspaceSidePaneState {
  return { activeTabId: "active", tabs: [{ id: "active", type } as WorkspaceSidePaneTab] };
}
describe("Chat engineering visibility", () => {
  it.each(["git", "terminal", "treemapping", "model-trajectory", "developer-tools"] as const)(
    "conceals %s in Chat and restores it in Work",
    (type) => {
      const owner = state(type);
      expect(shouldHideEngineeringSidePane(true, owner)).toBe(true);
      expect(shouldHideEngineeringSidePane(false, owner)).toBe(false);
      expect(owner.activeTabId).toBe("active");
    },
  );
  it.each(["browser", "code-viewer", "plan-detail", "workflow-run", "plugin-ui"] as const)(
    "keeps %s content reachable from Chat links and actions",
    (type) => {
      expect(shouldHideEngineeringSidePane(true, state(type))).toBe(false);
    },
  );
  it("hides the empty engineering launcher only in Chat", () => {
    expect(shouldHideEngineeringSidePane(true, null)).toBe(true);
    expect(shouldHideEngineeringSidePane(false, null)).toBe(false);
  });
});
