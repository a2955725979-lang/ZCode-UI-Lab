// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceArchivedTasksFlatSection } from "@/WorkspaceArchivedTasksFlatSection.js";
import { WebRemoteControlTaskIndex } from "@/WebRemoteControlTaskIndex.js";
import type { ZCodeTaskMeta, WebRemoteControlTaskTarget } from "@zcode/shared";

const state = vi.hoisted(() => ({
  unarchiveTask: vi.fn(),
  toast: vi.fn(),
  mutation: vi.fn(),
  removeTaskState: vi.fn(),
  remote: { sessionsById: {}, sessionIdByWorkspaceIdentity: {}, sessionIdByWorkspacePath: {} },
  global: {
    items: [] as ZCodeTaskMeta[],
    total: 1,
    loading: false,
    syncingRemoteWorkspaces: false,
    refresh: vi.fn(),
  },
  matches: () => true,
  intl: { formatMessage: ({ id }: { id: string }) => id },
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => ({ zcodeTaskService: { unarchiveTask: state.unarchiveTask } }),
}));
vi.mock("@/hooks/useGlobalTaskList.js", () => ({ useGlobalTaskList: () => state.global }));
vi.mock("@/hooks/useSessionHistoryMode.js", () => ({
  useSessionHistoryModePredicate: () => state.matches,
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => vi.fn() }));
vi.mock("@/i18n/IntlProvider.js", () => ({ useZCodeIntl: () => ({ intl: state.intl }) }));
vi.mock("@/store/remoteWorkspaceSessionStore.js", () => ({
  useRemoteWorkspaceSessionStore: (selector: (value: typeof state.remote) => unknown) =>
    selector(state.remote),
}));
vi.mock("@/store/zcodeSessionStore.js", () => ({
  useZCodeSessionStore: (selector: (value: unknown) => unknown) =>
    selector({ removeTaskState: state.removeTaskState }),
}));
vi.mock("@/lib/workspaceServiceResolver.js", () => ({
  buildWorkspaceServiceLookup: (
    tabs: Array<{ workspacePath: string; workspaceIdentity?: string }>,
    services: unknown,
  ) =>
    new Map(
      tabs.map((tab) => [
        tab.workspaceIdentity || tab.workspacePath,
        { services, isRemoteWorkspace: Boolean(tab.workspaceIdentity) },
      ]),
    ),
}));
vi.mock("@/hooks/useWebRemoteControlTaskOpen.js", () => ({
  buildWebRemoteControlTaskRowKey: (task: { taskId: string }) => task.taskId,
  useWebRemoteControlTaskOpen: () => ({
    activeWorkspaceKey: "/workspace",
    error: null,
    openTask: vi.fn(),
    switchingTaskKey: null,
  }),
}));
vi.mock("@/components/ui/toast.js", () => ({ toast: state.toast }));
vi.mock("@/logger.js", () => ({ logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/DeleteAllArchivedTasksButton.js", () => ({ DeleteAllArchivedTasksButton: () => null }));
vi.mock("@/lib/taskListItemPresentation.js", () => ({ formatTaskRelativeTime: () => "now" }));
vi.mock("@/components/workflow-run-line/TaskWorkflowRunLines.js", () => ({
  TaskWorkflowRunLines: () => null,
}));
vi.mock("@/store/taskQueryCacheStore.js", () => ({ applyTaskQueryCacheMutation: state.mutation }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.unarchiveTask.mockReset();
});

function task(identity?: string): ZCodeTaskMeta {
  return {
    taskId: "task-1",
    traceId: "trace-1",
    title: "Archived task",
    workspacePath: "/workspace",
    workspaceIdentity: identity,
    createdAt: 1,
    updatedAt: 2,
    mode: "default",
  };
}

describe("archive mutation failure feedback", () => {
  it.each([undefined, "remote:server:/workspace"])(
    "flat archived list preserves %s task and releases retry after rejection",
    async (identity) => {
      const archived = task(identity);
      state.global.items = [archived];
      let rejectRequest!: (error: Error) => void;
      state.unarchiveTask.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          }),
      );
      render(
        createElement(WorkspaceArchivedTasksFlatSection, {
          workspaceTabs: [
            {
              id: "workspace",
              kind: "workspace",
              label: "Workspace",
              workspacePath: "/workspace",
              workspaceIdentity: identity,
            },
          ],
          activeWorkspacePath: "/workspace",
          activeWorkspaceIdentity: identity,
          activeTaskId: null,
          sortBy: "updated",
          onSelectTask: vi.fn(),
        }),
      );
      const button = screen.getByRole("button", {
        name: "taskList.unarchive",
      }) as HTMLButtonElement;
      act(() => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(state.unarchiveTask).toHaveBeenCalledTimes(1);
      expect(button.disabled).toBe(true);
      expect(state.unarchiveTask).toHaveBeenLastCalledWith({
        taskId: "task-1",
        workspacePath: "/workspace",
        ...(identity ? { workspaceIdentity: identity } : {}),
      });
      await act(async () => rejectRequest(new Error("synthetic offline")));
      expect(state.toast).toHaveBeenCalledExactlyOnceWith("taskList.unarchiveFailed");
      expect(state.mutation).not.toHaveBeenCalled();
      expect(screen.getByText("Archived task")).toBeTruthy();
      expect(button.disabled).toBe(false);
      state.unarchiveTask.mockResolvedValueOnce(archived);
      await act(async () => fireEvent.click(button));
      expect(state.unarchiveTask).toHaveBeenCalledTimes(2);
      expect(state.mutation).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          previousTask: archived,
          nextState: { pinned: false, archived: false },
        }),
      );
    },
  );

  it.each([undefined, "remote:server:/workspace"])(
    "Web remote list preserves %s membership and releases retry after rejection",
    async (identity) => {
      const target: WebRemoteControlTaskTarget = {
        ...task(identity),
        workspaceKind: identity ? "remote" : "local",
        workspaceLabel: "Workspace",
        archived: true,
      };
      const result = {
        workspaces: [
          {
            workspacePath: "/workspace",
            workspaceIdentity: identity,
            kind: identity ? ("remote" as const) : ("local" as const),
            label: "Workspace",
          },
        ],
        tasks: [target],
      };
      const switcher = { listWorkspaces: vi.fn(async () => result) };
      let rejectRequest!: (error: Error) => void;
      state.unarchiveTask.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          }),
      );
      const view = render(
        createElement(WebRemoteControlTaskIndex, {
          switcher: switcher as never,
          initialResult: result,
          taskViewMode: "archived",
          activeWorkspacePath: "/workspace",
          activeWorkspaceIdentity: identity,
          activeTaskId: null,
          onSelectTask: vi.fn(),
        }),
      );
      await waitFor(() => expect(switcher.listWorkspaces).toHaveBeenCalled());
      fireEvent.mouseEnter(view.container.querySelector("li")!);
      const button = screen.getByRole("button", {
        name: "taskList.unarchive",
      }) as HTMLButtonElement;
      act(() => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(state.unarchiveTask).toHaveBeenCalledTimes(1);
      expect(button.disabled).toBe(true);
      await act(async () => rejectRequest(new Error("synthetic offline")));
      expect(state.toast).toHaveBeenCalledExactlyOnceWith("taskList.unarchiveFailed");
      expect(screen.getByText("Archived task")).toBeTruthy();
      expect(button.disabled).toBe(false);
      state.unarchiveTask.mockResolvedValueOnce(task(identity));
      await act(async () => fireEvent.click(button));
      expect(state.unarchiveTask).toHaveBeenCalledTimes(2);
      expect(screen.queryByText("Archived task")).toBeNull();
      expect(state.unarchiveTask).toHaveBeenLastCalledWith({
        taskId: "task-1",
        workspacePath: "/workspace",
        ...(identity ? { workspaceIdentity: identity } : {}),
      });
    },
  );
});
