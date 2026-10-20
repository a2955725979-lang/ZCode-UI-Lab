// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "@zcode/services";
import type {
  WebRemoteControlTaskTarget,
  WebRemoteControlWorkspaceListResult,
} from "@zcode/shared";
import { WebRemoteControlTaskIndex } from "@/WebRemoteControlTaskIndex.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { StoreContext } from "@/store/StoreProvider.js";
import { createZCodeStore } from "@/store/index.js";
import { setSessionHistoryMode } from "@/store/sessionHistoryModeStore.js";
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/WebRemoteControlTaskIndexRow.js", () => ({
  WebRemoteControlTaskIndexRow: ({ task }: { task: WebRemoteControlTaskTarget }) =>
    createElement("li", { "data-testid": "history-row" }, task.title),
}));
vi.mock("@/DeleteAllArchivedTasksButton.js", () => ({ DeleteAllArchivedTasksButton: () => null }));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
function setup(view: "workspace" | "timeline" | "archived") {
  const store = createZCodeStore({ send: vi.fn(), onMessage: () => ({ dispose() {} }) } as never);
  store.getState().setInterfaceMode("office");
  const workspace = {
    workspacePath: "/shared",
    workspaceIdentity: "remote:a",
    label: "A",
    kind: "remote" as const,
    workspacePurpose: "project" as const,
  };
  const tasks = ["chat", "work"].flatMap((mode) =>
    [false, true].map(
      (pinned): WebRemoteControlTaskTarget => ({
        taskId: `${mode}-${pinned}`,
        title: `${mode}-${pinned}`,
        workspacePath: workspace.workspacePath,
        workspaceIdentity: workspace.workspaceIdentity,
        workspaceLabel: "A",
        workspaceKind: "remote",
        createdAt: 1,
        updatedAt: 2,
        pinned,
        archived: view === "archived",
      }),
    ),
  );
  tasks
    .filter((task) => task.taskId.startsWith("chat"))
    .forEach((task) => setSessionHistoryMode(task, task.taskId, "chat"));
  const initialResult: WebRemoteControlWorkspaceListResult = { workspaces: [workspace], tasks };
  const listWorkspaces = vi.fn(async () => initialResult);
  render(
    createElement(
      StoreContext.Provider,
      { value: store },
      createElement(
        ServiceProvider,
        {
          services: { zcodeTaskService: {} } as IServiceAccessor,
        },
        createElement(WebRemoteControlTaskIndex, {
          activeWorkspacePath: "/shared",
          activeWorkspaceIdentity: "remote:a",
          activeTaskId: null,
          taskViewMode: view,
          initialResult,
          onSelectTask: vi.fn(),
          switcher: { listWorkspaces, switchWorkspace: vi.fn() },
        }),
      ),
    ),
  );
  return { store, listWorkspaces, tasks };
}
describe("remote history uses the same persisted classifier", () => {
  it.each(["workspace", "timeline", "archived"] as const)(
    "%s filters ordinary, pinned and archived rows and immediately reflects a move",
    async (view) => {
      const harness = setup(view);
      await waitFor(() => expect(harness.listWorkspaces).toHaveBeenCalledTimes(1));
      expect(
        screen
          .getAllByTestId("history-row")
          .map((node) => node.textContent)
          .sort(),
      ).toEqual(["chat-false", "chat-true"]);
      act(() => harness.store.getState().setInterfaceMode("coding"));
      expect(
        screen
          .getAllByTestId("history-row")
          .map((node) => node.textContent)
          .sort(),
      ).toEqual(["work-false", "work-true"]);
      act(() => setSessionHistoryMode(harness.tasks[0]!, "chat-false", "work"));
      expect(
        screen
          .getAllByTestId("history-row")
          .map((node) => node.textContent)
          .sort(),
      ).toEqual(["chat-false", "work-false", "work-true"]);
      expect(harness.listWorkspaces).toHaveBeenCalledTimes(1);
    },
  );
});
