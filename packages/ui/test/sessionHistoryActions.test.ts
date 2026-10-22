// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionHistoryActions } from "@/hooks/useSessionHistoryActions.js";
import {
  createSessionHistoryModeStore,
  getExplicitSessionHistoryMode,
} from "@/store/sessionHistoryModeStore.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { TaskActionMenuContent } from "@/TaskActionMenuContent.js";
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/toast.js", () => ({ toast }));
const scope = { workspacePath: "/history-actions-test" };
function Actions() {
  const { historyMode, moveHistoryMode } = useSessionHistoryActions(scope, "legacy");
  return createElement("button", { onClick: moveHistoryMode }, historyMode);
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); toast.mockReset(); });
describe("history move action", () => {
  it("moves legacy history both ways through the persisted owner", () => {
    render(createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(Actions)));
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    expect(getExplicitSessionHistoryMode(scope, "legacy")).toBe("chat");
    expect(
      createSessionHistoryModeStore(localStorage).getExplicitSessionHistoryMode(scope, "legacy"),
    ).toBe("chat");
    expect(toast).toHaveBeenLastCalledWith("Moved to Chat");
    fireEvent.click(screen.getByRole("button", { name: "chat" }));
    expect(getExplicitSessionHistoryMode(scope, "legacy")).toBe("work");
    expect(
      createSessionHistoryModeStore(localStorage).getExplicitSessionHistoryMode(scope, "legacy"),
    ).toBe("work");
    expect(toast).toHaveBeenLastCalledWith("Moved to Work");
  });
  it("reports persistence failure and leaves the old classification visible", () => {
    render(createElement(ZCodeIntlProvider, { initialLocale: "en-US" }, createElement(Actions)));
    // 先保存旧归属，再验证写入失败不会修改界面或已持久化的分类。
    fireEvent.click(screen.getByRole("button", { name: "work" }));
    toast.mockClear();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.click(screen.getByRole("button", { name: "chat" }));
    expect(screen.getByRole("button", { name: "chat" })).toBeTruthy();
    expect(getExplicitSessionHistoryMode(scope, "legacy")).toBe("chat");
    expect(
      createSessionHistoryModeStore(localStorage).getExplicitSessionHistoryMode(scope, "legacy"),
    ).toBe("chat");
    expect(toast).toHaveBeenCalledExactlyOnceWith("Could not move. Try again.");
  });
  it("offers only the opposite category and respects the disabled action boundary", () => {
    const onMove = vi.fn();
    const props = {
      intl: { formatMessage: ({ id }: { id: string }) => id },
      isPinned: false, fileManagerLabel: "Finder",
      taskSessionFile: { loading: false, path: null, exists: false },
      taskNativeSessionLogFile: { loading: false, path: null, exists: false },
      providerConfigFile: { loading: false, path: null, exists: false },
      Item: ({ children, disabled, onSelect }: { children: React.ReactNode; disabled?: boolean; onSelect?: () => void }) =>
        createElement("button", { disabled, onClick: onSelect }, children),
      Separator: () => createElement("hr"),
      onTogglePinTask: vi.fn(), onStartRenameTask: vi.fn(), onArchiveTask: vi.fn(), onMarkTaskAsUnread: vi.fn(),
      onOpenTaskPathInFileManager: vi.fn(), onCopyWorkspacePath: vi.fn(), onCopyTaskPath: vi.fn(), onCopyTaskLogPath: vi.fn(), onOpenProviderConfig: vi.fn(),
      historyMode: "chat" as const, onMoveHistoryMode: onMove,
    };
    const view = render(createElement(TaskActionMenuContent, props));
    expect(screen.queryByRole("button", { name: "chatWorkspace.moveToChat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "chatWorkspace.moveToWork" }));
    expect(onMove).toHaveBeenCalledTimes(1);
    view.rerender(createElement(TaskActionMenuContent, { ...props, disableTaskTargetActions: true }));
    fireEvent.click(screen.getByRole("button", { name: "chatWorkspace.moveToWork" }));
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});
