// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "@zcode/rpc";
import type {
  IServiceAccessor,
  WindowHostControllerFrame,
  WindowHostControllerTaskListItem,
} from "@zcode/services";
import { TaskAttentionDialog } from "@/TaskAttentionDialog.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import {
  consumeTaskInteractionOpenRequest,
  getTaskInteractionOpenRequest,
  subscribeTaskInteractionOpen,
} from "@/v4/taskAttentionNavigation.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string>) =>
        values ? `${id} ${Object.values(values).join("/")}` : id,
    },
  }),
}));

afterEach(() => {
  cleanup();
  const pending = getTaskInteractionOpenRequest();
  if (pending) consumeTaskInteractionOpenRequest(pending);
});

const TABS: WorkspaceTabState[] = [
  {
    id: "chat",
    kind: "workspace",
    workspacePath: "/chat",
    label: "Chats",
    workspacePurpose: "conversation",
  },
  {
    id: "remote",
    kind: "workspace",
    workspacePath: "/work",
    workspaceIdentity: "remote:server-a:/work",
    remoteSessionId: "remote-connection-1",
    label: "Remote project",
    workspacePurpose: "project",
  },
];
function item(
  taskId: string,
  overrides: Partial<WindowHostControllerTaskListItem> = {},
): WindowHostControllerTaskListItem {
  return {
    taskId,
    traceId: taskId,
    title: taskId,
    workspacePath: "/chat",
    createdAt: 1,
    updatedAt: 1,
    mode: "default",
    sourceAvailability: "online",
    liveStatus: "waiting",
    ...overrides,
  };
}
function items(): WindowHostControllerTaskListItem[] {
  return [
    item("Chat question", {
      pendingInteraction: {
        kind: "userInput",
        interactionId: "ask-1",
        toolName: "AskUserQuestion",
      },
      activity: {
        phase: "running",
        lastActivityAt: 1,
        hasBackgroundWork: false,
        pendingInteractions: { permissionCount: 0, userInputCount: 1 },
      },
    }),
    item("Work permission", {
      workspacePath: "/work",
      workspaceIdentity: "remote:server-a:/work",
      remoteSessionId: "remote-connection-1",
      pendingInteraction: { kind: "permission", interactionId: "permission-1" },
      activity: {
        phase: "running",
        lastActivityAt: 1,
        hasBackgroundWork: false,
        pendingInteractions: { permissionCount: 1, userInputCount: 0 },
      },
    }),
    item("Execution error", {
      activity: { phase: "error", lastActivityAt: 1, hasBackgroundWork: false },
    }),
    item("Stale question", {
      pendingInteraction: { kind: "userInput", interactionId: "stale" },
      activity: {
        phase: "running",
        lastActivityAt: 1,
        hasBackgroundWork: false,
        pendingInteractions: { permissionCount: 0, userInputCount: 0 },
      },
    }),
    item("Stale error", {
      status: "error",
      activity: { phase: "running", lastActivityAt: 1, hasBackgroundWork: false },
    }),
  ];
}
function setup(initial = items()) {
  const frames = new Emitter<WindowHostControllerFrame>();
  let source = initial;
  const listTaskList = vi.fn(async () => ({ items: source, total: source.length, hasMore: false }));
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
  const view = render(
    createElement(
      ServiceProvider,
      { services },
      createElement(TaskAttentionDialog, { workspaceTabs: TABS, onSelectTask }),
    ),
  );
  return {
    ...view,
    listTaskList,
    onSelectTask,
    setSource: (next: WindowHostControllerTaskListItem[]) => {
      source = next;
    },
  };
}

describe("TaskAttentionDialog", () => {
  it.each(["Escape", "Close"])(
    "restores keyboard focus to the real trigger after %s",
    async (closeAction) => {
      const view = setup();
      const trigger = view.getByTestId("task-attention-trigger");
      await waitFor(() => expect(trigger.textContent).toContain("3"));
      act(() => trigger.focus());
      fireEvent.click(trigger);
      await waitFor(() =>
        expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true),
      );
      if (closeAction === "Escape") {
        fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Close" }));
      }
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    },
  );

  it("keeps task-navigation focus instead of restoring the sidebar trigger", async () => {
    const view = setup();
    const trigger = view.getByTestId("task-attention-trigger");
    await waitFor(() => expect(trigger.textContent).toContain("3"));
    const target = document.createElement("button");
    target.textContent = "destination composer";
    document.body.appendChild(target);
    view.onSelectTask.mockImplementation(() => {
      target.focus();
    });
    try {
      act(() => trigger.focus());
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("button", { name: /Chat question/ }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(target));
      // Radix 在卸载 focus scope 时异步分发 closeAutoFocus；跨过该拍再断言没有抢回触发器。
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      expect(document.activeElement).toBe(target);
    } finally {
      target.remove();
    }
  });

  it("aggregates all opened Chat/Work scopes, filters after full Controller query, and ignores stale facts", async () => {
    const view = setup();
    await waitFor(() =>
      expect(view.getByTestId("task-attention-trigger").textContent).toContain("3"),
    );
    expect(view.listTaskList).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "timeline",
        limit: undefined,
        workspaceScopes: [
          { workspacePath: "/chat" },
          { workspacePath: "/work", workspaceIdentity: "remote:server-a:/work" },
        ],
      }),
    );
    fireEvent.click(view.getByTestId("task-attention-trigger"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Chat question/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Work permission/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Execution error/ })).toBeTruthy();
    expect(screen.queryByText("Stale question")).toBeNull();
    expect(screen.queryByText("Stale error")).toBeNull();
    expect(view.listTaskList).toHaveBeenCalledTimes(1);
  });

  it("selects the exact session before storing a question open intent", async () => {
    const view = setup();
    await waitFor(() =>
      expect(view.getByTestId("task-attention-trigger").textContent).toContain("3"),
    );
    const events: string[] = [];
    view.onSelectTask.mockImplementation(() => {
      events.push("selected");
    });
    const unsubscribe = subscribeTaskInteractionOpen(() => {
      events.push("requested");
    });
    try {
      fireEvent.click(view.getByTestId("task-attention-trigger"));
      fireEvent.click(screen.getByRole("button", { name: /Chat question/ }));
      await waitFor(() => expect(view.onSelectTask).toHaveBeenCalled());
      expect(view.onSelectTask).toHaveBeenCalledWith(
        "/chat",
        "Chat question",
        undefined,
        undefined,
      );
      expect(events).toEqual(["selected", "requested"]);
      expect(getTaskInteractionOpenRequest()).toEqual({
        workspacePath: "/chat",
        sessionId: "Chat question",
        interactionId: "ask-1",
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it("routes remote permissions and errors without sending answers or authorization", async () => {
    const view = setup();
    await waitFor(() =>
      expect(view.getByTestId("task-attention-trigger").textContent).toContain("3"),
    );
    fireEvent.click(view.getByTestId("task-attention-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /Work permission/ }));
    await waitFor(() => expect(view.onSelectTask).toHaveBeenCalled());
    expect(view.onSelectTask).toHaveBeenCalledWith(
      "/work",
      "Work permission",
      "remote:server-a:/work",
      "remote-connection-1",
    );
    expect(getTaskInteractionOpenRequest()).toBeNull();
    fireEvent.click(view.getByTestId("task-attention-trigger"));
    fireEvent.click(screen.getByRole("button", { name: /Execution error/ }));
    await waitFor(() => expect(view.onSelectTask).toHaveBeenCalledTimes(2));
    expect(view.onSelectTask).toHaveBeenLastCalledWith(
      "/chat",
      "Execution error",
      undefined,
      undefined,
    );
    expect(getTaskInteractionOpenRequest()).toBeNull();
  });

  it("shows loading/empty and refreshes through the same Controller query", async () => {
    const view = setup([]);
    fireEvent.click(view.getByTestId("task-attention-trigger"));
    expect(screen.getByRole("status").textContent).toContain("taskAttention.loading");
    await waitFor(() => expect(screen.getByText("taskAttention.empty")).toBeTruthy());
    view.setSource([items()[2]!]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "taskAttention.refresh" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Execution error/ })).toBeTruthy(),
    );
    expect(view.listTaskList).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("taskAttention.empty")).toBeNull();
  });
});
