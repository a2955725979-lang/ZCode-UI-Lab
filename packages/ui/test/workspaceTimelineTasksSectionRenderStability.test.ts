import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZCodeTaskMeta } from "@zcode/shared";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useTaskQueryCacheStore } from "@/store/taskQueryCacheStore.js";

const {
  capturedTaskItemProps,
  renameDialogState,
  globalTaskListResult,
  remoteTimelineState,
  remoteWorkspaceSessionState,
  stableBaseServices,
  stableIntl,
  zcodeSessionStoreState,
  toastSpy,
} = vi.hoisted(() => ({
  capturedTaskItemProps: [] as Array<Record<string, unknown>>,
  renameDialogState: { current: null as null | { onChange: (value: string) => void; onConfirm: () => void } },
  globalTaskListResult: {
    refresh: vi.fn(async () => {}),
    hasMore: false,
    items: [] as ZCodeTaskMeta[],
    loading: false,
    total: 0,
  },
  remoteTimelineState: {
    hasMoreByWorkspaceKey: {} as Record<string, boolean>,
    itemsByWorkspaceKey: {} as Record<string, ZCodeTaskMeta[]>,
    loadingByWorkspaceKey: {} as Record<string, boolean>,
    totalByWorkspaceKey: {} as Record<string, number>,
  },
  remoteWorkspaceSessionState: {
    sessionIdByWorkspaceIdentity: {} as Record<string, string>,
    sessionIdByWorkspacePath: {} as Record<string, string>,
    sessionsById: {} as Record<string, unknown>,
  },
  stableBaseServices: {
    zcodeTaskService: {
      archiveTask: vi.fn(async () => null),
      renameTask: vi.fn(async (): Promise<ZCodeTaskMeta | null> => null),
      setTaskPinned: vi.fn(async () => null),
      setTaskUnread: vi.fn(async () => null),
    },
  },
  stableIntl: {
    formatMessage: ({ id }: { id: string }) => id,
  },
  toastSpy: vi.fn(),
  zcodeSessionStoreState: {
    removeOptimisticTaskListItem: vi.fn(),
    removeTaskState: vi.fn(),
    setTaskUnreadIndicator: vi.fn(),
    upsertOptimisticTaskListItem: vi.fn(),
  },
}));

vi.mock("@/components/ui/context-menu.js", () => ({
  ContextMenu: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
  ContextMenuTrigger: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: toastSpy,
}));

vi.mock("@/hooks/useGlobalTaskList.js", () => ({
  useGlobalTaskList: () => globalTaskListResult,
}));

vi.mock("@/hooks/useLocalWorkspaceScopes.js", () => ({
  useLocalWorkspaceScopes: ({ workspaceTabs }: { workspaceTabs: WorkspaceTabState[] }) =>
    workspaceTabs,
}));

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => stableBaseServices,
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: stableIntl,
    locale: "en",
  }),
}));

vi.mock("@/TaskListItem.js", () => ({
  MemoTaskItem: (props: Record<string, unknown>) => {
    capturedTaskItemProps.push(props);
    return createElement("li", null, (props.task as ZCodeTaskMeta).title);
  },
  TaskListItemContextMenuContent: () => null,
}));

vi.mock("@/TaskListLoadingHint.js", () => ({
  TaskListLoadingHint: () => null,
}));

vi.mock("@/TaskListRemoteSyncHint.js", () => ({
  TaskListRemoteSyncHint: () => null,
}));

vi.mock("@/TaskRenameDialog.js", () => ({
  TaskRenameDialog: (props: NonNullable<typeof renameDialogState.current>) => {
    renameDialogState.current = props;
    return null;
  },
}));

vi.mock("@/store/zcodeSessionStore.js", () => ({
  useZCodeSessionStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(zcodeSessionStoreState),
}));

vi.mock("@/store/remotePinnedTaskStore.js", () => ({
  useRemotePinnedTaskStore: {
    getState: () => ({
      removeTask: () => {},
      upsertTask: () => {},
    }),
  },
}));

function useRemoteTimelineTaskStore(
  selector: (state: typeof remoteTimelineState) => unknown,
) {
  return selector(remoteTimelineState);
}

useRemoteTimelineTaskStore.getState = () => ({
  refreshWorkspace: () => {},
  removeTask: () => {},
  upsertTask: () => {},
});

vi.mock("@/store/remoteTimelineTaskStore.js", () => ({
  useRemoteTimelineTaskStore,
}));

vi.mock("@/store/remoteWorkspaceSessionStore.js", () => ({
  useRemoteWorkspaceSessionStore: (
    selector: (state: typeof remoteWorkspaceSessionState) => unknown,
  ) => selector(remoteWorkspaceSessionState),
}));

function createTask(overrides: Partial<ZCodeTaskMeta> = {}): ZCodeTaskMeta {
  return {
    createdAt: 1,
    mode: "default",
    provider: "codex",
    taskId: "task-1",
    title: "Task 1",
    traceId: "trace-1",
    updatedAt: 2,
    workspacePath: "/workspace",
    ...overrides,
  };
}

function createWorkspaceTab(): WorkspaceTabState {
  return {
    id: "workspace-1",
    kind: "workspace",
    label: "workspace",
    workspacePath: "/workspace",
  };
}

function createMinimalElement(ownerDocument: Document, tagName = "div") {
  const element = {
    addEventListener: () => {},
    appendChild: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    childNodes: [] as unknown[],
    getAttribute: () => null,
    insertBefore: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as unknown,
    querySelector: () => null,
    removeAttribute: () => {},
    removeChild: (child: { parentNode?: unknown }) => {
      child.parentNode = null;
      return child;
    },
    removeEventListener: () => {},
    setAttribute: () => {},
    style: {},
    tagName: tagName.toUpperCase(),
  };
  return element as unknown as Element;
}

function installMinimalDom() {
  const documentMock = {
    addEventListener: () => {},
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createElementNS: (_namespace: string, tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document;
  const windowMock = {
    addEventListener: () => {},
    clearTimeout,
    document: documentMock,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    HTMLElement: function HTMLElement() {},
    Node: function Node() {},
    removeEventListener: () => {},
    setTimeout,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return createMinimalElement(documentMock);
}

describe("WorkspaceTimelineTasksSection render stability", () => {
  afterEach(() => {
    capturedTaskItemProps.length = 0;
    renameDialogState.current = null;
    globalTaskListResult.refresh.mockReset();
    useTaskQueryCacheStore.getState().clearAll();
    globalTaskListResult.hasMore = false;
    globalTaskListResult.items = [];
    globalTaskListResult.loading = false;
    globalTaskListResult.total = 0;
    remoteTimelineState.hasMoreByWorkspaceKey = {};
    remoteTimelineState.itemsByWorkspaceKey = {};
    remoteTimelineState.loadingByWorkspaceKey = {};
    remoteTimelineState.totalByWorkspaceKey = {};
    stableBaseServices.zcodeTaskService.archiveTask.mockReset();
    stableBaseServices.zcodeTaskService.renameTask.mockReset();
    stableBaseServices.zcodeTaskService.setTaskPinned.mockReset();
    stableBaseServices.zcodeTaskService.setTaskUnread.mockReset();
    toastSpy.mockReset();
    zcodeSessionStoreState.removeTaskState.mockReset();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("catches a rejected archive, keeps the task and admits only one request until retry", async () => {
    const { WorkspaceTimelineTasksSection } = await import("@/WorkspaceTimelineTasksSection.js");
    const root = createRoot(installMinimalDom());
    const task = createTask();
    globalTaskListResult.items = [task];
    globalTaskListResult.total = 1;
    let rejectArchive!: (error: Error) => void;
    stableBaseServices.zcodeTaskService.archiveTask.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectArchive = reject;
        }),
    );
    act(() =>
      root.render(
        createElement(WorkspaceTimelineTasksSection, {
          activeTaskId: task.taskId,
          activeWorkspacePath: "/workspace",
          onSelectTask: vi.fn(),
          taskSortBy: "updated",
          workspaceTabs: [createWorkspaceTab()],
        }),
      ),
    );
    const archive = capturedTaskItemProps.at(-1)!.onArchiveTask as (taskId: string) => void;
    act(() => {
      archive(task.taskId);
      archive(task.taskId);
    });
    expect(stableBaseServices.zcodeTaskService.archiveTask).toHaveBeenCalledTimes(1);
    await act(async () => rejectArchive(new Error("synthetic archive rejection")));
    expect(toastSpy).toHaveBeenCalledExactlyOnceWith("taskList.archiveFailed");
    expect(zcodeSessionStoreState.removeTaskState).not.toHaveBeenCalled();
    expect((capturedTaskItemProps.at(-1)!.task as ZCodeTaskMeta).taskId).toBe(task.taskId);
    stableBaseServices.zcodeTaskService.archiveTask.mockRejectedValueOnce(
      new Error("retry rejected"),
    );
    await act(async () => archive(task.taskId));
    expect(stableBaseServices.zcodeTaskService.archiveTask).toHaveBeenCalledTimes(2);
    expect(toastSpy).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
  });

  it("publishes indexed history metadata for restored and selected tasks without a runtime read", async () => {
    const { WorkspaceTimelineTasksSection } = await import("@/WorkspaceTimelineTasksSection.js");
    const root = createRoot(installMinimalDom());
    const task = createTask({ title: "Historical conversation" });
    globalTaskListResult.items = [task];
    globalTaskListResult.total = 1;
    const onSelectTask = vi.fn(() => {
      expect(useTaskQueryCacheStore.getState().taskMetaByEntityKey["/workspace::task-1"]?.title)
        .toBe("Historical conversation");
    });
    const props = {
      activeTaskId: task.taskId,
      activeWorkspacePath: "/workspace",
      onSelectTask,
      taskSortBy: "updated" as const,
      workspaceTabs: [createWorkspaceTab()],
    };
    act(() => root.render(createElement(WorkspaceTimelineTasksSection, props)));
    expect(useTaskQueryCacheStore.getState().taskMetaByEntityKey["/workspace::task-1"]?.title)
      .toBe("Historical conversation");
    useTaskQueryCacheStore.getState().clearAll();
    act(() => (capturedTaskItemProps.at(-1)!.onSelectTask as () => void)());
    expect(onSelectTask).toHaveBeenCalledWith("/workspace", task.taskId, undefined, undefined);
    act(() => root.unmount());
  });

  it("refreshes the Controller list after a historical rename succeeds without a live event", async () => {
    const { WorkspaceTimelineTasksSection } = await import("@/WorkspaceTimelineTasksSection.js");
    const root = createRoot(installMinimalDom());
    const task = createTask();
    const renamed = createTask({ title: "Renamed historical conversation", titleOverridden: true, updatedAt: 3 });
    globalTaskListResult.items = [task];
    globalTaskListResult.total = 1;
    stableBaseServices.zcodeTaskService.renameTask.mockResolvedValue(renamed);
    globalTaskListResult.refresh.mockImplementation(async () => {
      globalTaskListResult.items = [renamed];
    });
    const props = {
      activeTaskId: task.taskId,
      activeWorkspacePath: "/workspace",
      onSelectTask: vi.fn(),
      taskSortBy: "updated" as const,
      workspaceTabs: [createWorkspaceTab()],
    };
    act(() => root.render(createElement(WorkspaceTimelineTasksSection, props)));
    act(() => (capturedTaskItemProps.at(-1)!.onStartRenameTask as (id: string, title: string) => void)(task.taskId, task.title));
    act(() => renameDialogState.current?.onChange(renamed.title));
    await act(async () => { renameDialogState.current?.onConfirm(); });
    act(() => root.render(createElement(WorkspaceTimelineTasksSection, props)));
    expect(stableBaseServices.zcodeTaskService.renameTask).toHaveBeenCalledWith({
      taskId: task.taskId, workspacePath: task.workspacePath, title: renamed.title,
    });
    expect(globalTaskListResult.refresh).toHaveBeenCalledTimes(1);
    expect((capturedTaskItemProps.at(-1)!.task as ZCodeTaskMeta).title).toBe(renamed.title);
    expect(useTaskQueryCacheStore.getState().taskMetaByEntityKey["/workspace::task-1"]?.title).toBe(renamed.title);
    act(() => root.unmount());
  });

  it("keeps MemoTaskItem action props stable during unrelated parent rerenders", async () => {
    const { WorkspaceTimelineTasksSection } = await import(
      "@/WorkspaceTimelineTasksSection.js"
    );
    const root: Root = createRoot(installMinimalDom());
    const workspaceTabs = [createWorkspaceTab()];
    const task = createTask();
    globalTaskListResult.items = [task];
    globalTaskListResult.total = 1;
    const onSelectTask = vi.fn();

    function Parent({ tick }: { tick: number }) {
      return createElement(
        "section",
        null,
        createElement("span", null, tick),
        createElement(WorkspaceTimelineTasksSection, {
          activeTaskId: null,
          activeWorkspacePath: "/workspace",
          onSelectTask,
          taskSortBy: "updated",
          workspaceTabs,
        }),
      );
    }

    act(() => {
      root.render(createElement(Parent, { tick: 1 }));
    });
    act(() => {
      root.render(createElement(Parent, { tick: 2 }));
    });

    const initialProps = capturedTaskItemProps[0];
    const rerenderedProps = capturedTaskItemProps[1];
    expect(rerenderedProps?.onSelectTask).toBe(initialProps?.onSelectTask);
    expect(rerenderedProps?.onArchiveTaskInline).toBe(
      initialProps?.onArchiveTaskInline,
    );
    expect(rerenderedProps?.onTogglePinTask).toBe(
      initialProps?.onTogglePinTask,
    );
    expect(rerenderedProps?.onStartRenameTask).toBe(
      initialProps?.onStartRenameTask,
    );
    expect(rerenderedProps?.onArchiveTask).toBe(initialProps?.onArchiveTask);
    expect(rerenderedProps?.onMarkTaskAsUnread).toBe(
      initialProps?.onMarkTaskAsUnread,
    );
    expect(rerenderedProps?.onOpenTaskContextMenu).toBe(
      initialProps?.onOpenTaskContextMenu,
    );
    expect(initialProps?.variant).toBe("timeline");

    act(() => {
      root.unmount();
    });
  });

  it("forwards the single-line row variant for conversation sections", async () => {
    const { WorkspaceTimelineTasksSection } = await import(
      "@/WorkspaceTimelineTasksSection.js"
    );
    const root: Root = createRoot(installMinimalDom());
    globalTaskListResult.items = [createTask()];
    globalTaskListResult.total = 1;

    act(() => {
      root.render(
        createElement(WorkspaceTimelineTasksSection, {
          activeTaskId: null,
          activeWorkspacePath: "/workspace",
          onSelectTask: vi.fn(),
          taskRowVariant: "default",
          taskSortBy: "updated",
          workspaceTabs: [createWorkspaceTab()],
        }),
      );
    });

    expect(capturedTaskItemProps.at(-1)?.variant).toBe("default");

    act(() => {
      root.unmount();
    });
  });
});
