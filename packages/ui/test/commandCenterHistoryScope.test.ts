// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "@zcode/rpc";
import type {
  IServiceAccessor,
  WindowHostControllerFrame,
  ZCodeTaskListQuery,
} from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { CommandCenterDialog } from "@/command-center/CommandCenterDialog.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { setSessionHistoryFilter, setSessionHistoryMode } from "@/store/sessionHistoryModeStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/hooks/useInterfaceMode.js", () => ({ useIsOfficeMode: () => true }));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tabs: WorkspaceTabState[] = [
  {
    id: "shared",
    kind: "workspace",
    label: "Chats",
    workspacePath: "/shared",
    workspacePurpose: "conversation",
  },
  {
    id: "project",
    kind: "workspace",
    label: "Project",
    workspacePath: "/project",
    workspacePurpose: "project",
  },
];
function task(taskId: string, workspacePath = "/shared"): ZCodeTaskMeta {
  return {
    taskId,
    title: taskId,
    traceId: taskId,
    workspacePath,
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
  };
}

describe("Command Center history scope", () => {
  it("searches both classifications in open workspaces despite narrowed history and labels each result", async () => {
    setSessionHistoryFilter("chat", "chat");
    setSessionHistoryFilter("work", "work");
    setSessionHistoryMode(tabs[0]!, "Work fixture", "work");
    const tasks = [task("Chat fixture"), task("Work fixture"), task("Project fixture", "/project")];
    const listTaskList = vi.fn(async (query: ZCodeTaskListQuery) => {
      const keys = new Set(query.workspaceScopes.map((scope) => scope.workspacePath));
      const items = tasks.filter((item) => keys.has(item.workspacePath));
      return { items, total: items.length, hasMore: false };
    });
    const frames = new Emitter<WindowHostControllerFrame>();
    const services = {
      windowControllerService: {
        listTaskList,
        onDynamicControllerFrame: () => frames.event,
        subscribeControllerV4: async ({ topic }: { topic: string }) => ({
          ack: { subscriptionId: topic, mode: "snapshot", logEpoch: "epoch" },
        }),
        unsubscribeControllerV4: async () => undefined,
      },
    } as unknown as IServiceAccessor;
    const onSelectTask = vi.fn();
    const onOpenChange = vi.fn();
    render(
      createElement(
        ServiceProvider,
        { services },
        createElement(CommandCenterDialog, {
          open: true,
          commands: [],
          workspaceAbsPath: "/shared",
          workspaceTabs: tabs,
          onOpenChange,
          onSelectTask,
          onOpenCodeViewer: vi.fn(),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByText("Work fixture")).toBeTruthy());
    expect(
      screen
        .getByText("Work fixture")
        .closest("[role=option]")
        ?.querySelector("[data-session-history-mode-label]")?.textContent,
    ).toBe("chatWorkspace.work");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fixture" } });
    await waitFor(() =>
      expect(
        listTaskList.mock.calls.some(
          ([query]) => query.search === "fixture" && query.workspaceScopes.length === 2,
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual(
        expect.arrayContaining([expect.stringContaining("Project fixture")]),
      ),
    );
    expect(listTaskList).toHaveBeenCalledWith(
      expect.objectContaining({
        search: "fixture",
        workspaceScopes: [{ workspacePath: "/shared" }, { workspacePath: "/project" }],
      }),
    );
    for (const [title, mode] of [
      ["Chat fixture", "chat"],
      ["Work fixture", "work"],
      ["Project fixture", "work"],
    ]) {
      const row = screen
        .getAllByRole("option")
        .find((option) => option.textContent?.includes(title!))!;
      expect(row).toBeTruthy();
      const label = row.querySelector("[data-session-history-mode-label]")!;
      expect(label.textContent).toBe(`chatWorkspace.${mode}`);
      expect(label.className).toContain("text-ui-xs");
    }
    expect(screen.queryByText("chatWorkspace.searchScope")).toBeNull();
    fireEvent.click(
      screen.getAllByRole("option").find((option) => option.textContent?.includes("Work fixture"))!,
    );
    expect(onSelectTask).toHaveBeenCalledWith("/shared", "Work fixture", undefined);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
