// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRootWorkspaceActions } from "@/root/useRootWorkspaceActions.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
const state = vi.hoisted(() => ({ chat: true, createConversation: vi.fn(async () => {}) }));
vi.mock("@/hooks/useInterfaceMode.js", () => ({ useIsOfficeMode: () => state.chat }));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock("@/root/useConversationWorkspaceActions.js", () => ({
  useConversationWorkspaceActions: () => ({
    handleSelectConversationWorkspace: vi.fn(),
    handleResolveConversationWorkspace: vi.fn(),
    handleEnsureConversationWorkspace: vi.fn(),
    handleCreateConversationTask: state.createConversation,
  }),
}));
function setup(clientMode: "desktop-continuous" | "web-remote-replayable" = "desktop-continuous") {
  const draft = vi
    .spyOn(useZCodeSessionStore.getState(), "startDraft")
    .mockImplementation(() => {});
  const props = {
    intl: { formatMessage: ({ id }: { id: string }) => id },
    platform: {},
    services: {},
    tabStoreApi: {
      getState: () => ({
        activeWorkspacePath: "/project",
        activeWorkspaceIdentity: null,
        activateTabByPath: () => true,
        tabs: [],
      }),
    },
    addTab: vi.fn(),
    activeWorkspacePath: "/project",
    activeWorkspaceIdentity: null,
    supportsSettings: true,
    allowOpenWorkspace: true,
    preferDirectoryBrowser: false,
    refreshProviderState: vi.fn(),
    updateAppSettings: vi.fn(),
    setOAuthError: vi.fn(),
    setUser: vi.fn(),
    workbenchGroupClientMode: clientMode,
  } as unknown as Parameters<typeof useRootWorkspaceActions>[0];
  return { ...renderHook(() => useRootWorkspaceActions(props)), draft };
}
beforeEach(() => {
  state.chat = true;
  state.createConversation.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("generic new-task routing", () => {
  it("routes Chat keyboard and generic toolbar commands through the existing conversation owner", () => {
    const { result, draft } = setup();
    act(() => result.current.startNewTaskFromActiveWorkspace("onNewTask"));
    act(() => result.current.handleCreateTask());
    expect(state.createConversation).toHaveBeenCalledTimes(2);
    expect(draft).not.toHaveBeenCalled();
  });
  it("preserves explicit project/workflow targeting in Chat", () => {
    const { result, draft } = setup();
    act(() =>
      result.current.handleCreateTask({ targetWorkspace: { workspacePath: "/workflow-owner" } }),
    );
    expect(state.createConversation).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledWith("/workflow-owner", undefined, undefined, expect.any(Object));
  });
  it("keeps mobile remote generic creation in the visible host workspace", () => {
    const { result, draft } = setup("web-remote-replayable");
    act(() => result.current.startNewTaskFromActiveWorkspace("web CmdOrCtrl+N"));
    expect(state.createConversation).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledWith("/project", undefined, undefined, expect.any(Object));
  });
  it("retains Work generic new-task routing", () => {
    state.chat = false;
    const { result, draft } = setup();
    act(() => result.current.startNewTaskFromActiveWorkspace("onNewTask"));
    expect(state.createConversation).not.toHaveBeenCalled();
    expect(draft).toHaveBeenCalledWith("/project", undefined, undefined, expect.any(Object));
  });
});
