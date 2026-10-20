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
import { useTaskQueryCacheStore } from "@/store/taskQueryCacheStore.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";
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
  useTaskQueryCacheStore.getState().clearAll();
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
  useTaskQueryCacheStore.getState().clearAll();
  for (const task of initial) {
    useTaskQueryCacheStore
      .getState()
      .upsertTaskMeta(task.activity ? attachTaskListRowActivity(task, task.activity) : task);
  }
  const listTaskList = vi.fn(async () => ({
    items: initial,
    total: initial.length,
    hasMore: false,
  }));
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
    frames,
  };
}

describe("TaskAttentionDialog", () => {
  it.each(["Escape", "Trigger"])(
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
        fireEvent.click(trigger);
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

  it("aggregates cached metadata across opened Chat/Work scopes without issuing a list query", async () => {
    const view = setup();
    await waitFor(() =>
      expect(view.getByTestId("task-attention-trigger").textContent).toContain("3"),
    );
    expect(view.listTaskList).not.toHaveBeenCalled();
    fireEvent.click(view.getByTestId("task-attention-trigger"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Chat question/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Work permission/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Execution error/ })).toBeTruthy();
    expect(screen.queryByText("Stale question")).toBeNull();
    expect(screen.queryByText("Stale error")).toBeNull();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).not.toBe("true");
    expect(view.listTaskList).not.toHaveBeenCalled();
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

  it("uses Controller snapshots and deltas over stale cached metadata without a query", async () => {
    const view = setup();
    const snapshot = (tasks: WindowHostControllerTaskListItem[]) => ({
      protocolVersion: 1 as const,
      logEpoch: "epoch",
      tasks: tasks.map(
        ({ activity, remoteSessionId, sourceAvailability, liveStatus, ...meta }) => ({
          address: {
            workspacePath: meta.workspacePath,
            workspaceIdentity: meta.workspaceIdentity,
            taskId: meta.taskId,
            remoteSessionId,
          },
          meta,
          membership: { pinned: false, archived: false, active: true },
          sourceAvailability,
          liveStatus,
          activity,
        }),
      ),
    });
    await act(async () => {
      view.frames.fire({
        topic: "controller/tasks-index",
        subscriptionId: "controller/tasks-index",
        logEpoch: "epoch",
        fromSeq: 0,
        toSeq: 0,
        sentAt: 1,
        payload: { kind: "snapshot", snapshot: snapshot([]) },
      });
    });
    expect(view.queryByTestId("task-attention-trigger")).toBeNull();
    await act(async () => {
      view.frames.fire({
        topic: "controller/tasks-index",
        subscriptionId: "controller/tasks-index",
        logEpoch: "epoch",
        fromSeq: 0,
        toSeq: 1,
        sentAt: 2,
        payload: {
          kind: "deltas",
          deltas: [{ op: "task.upserted", task: snapshot([items()[0]!]).tasks[0]! }],
        },
      });
    });
    expect(view.getByTestId("task-attention-trigger").textContent).toContain("1");
    fireEvent.click(view.getByTestId("task-attention-trigger"));
    expect(screen.getByRole("button", { name: /Chat question/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Work permission/ })).toBeNull();
    expect(view.listTaskList).not.toHaveBeenCalled();
  });

  it("excludes cached attention from closed workspaces and same paths under another identity", () => {
    const view = setup([
      ...items(),
      item("Closed task", { workspacePath: "/closed", status: "error" }),
      item("Other remote", {
        workspacePath: "/work",
        workspaceIdentity: "remote:other:/work",
        status: "error",
      }),
    ]);
    expect(view.getByTestId("task-attention-trigger").textContent).toContain("3");
    fireEvent.click(view.getByTestId("task-attention-trigger"));
    expect(screen.queryByText("Closed task")).toBeNull();
    expect(screen.queryByText("Other remote")).toBeNull();
    expect(view.listTaskList).not.toHaveBeenCalled();
  });

  it("hides the zero state and reacts to the existing metadata cache without querying", async () => {
    const view = setup([]);
    expect(view.queryByTestId("task-attention-trigger")).toBeNull();
    act(() => {
      const task = items()[2]!;
      useTaskQueryCacheStore
        .getState()
        .upsertTaskMeta(attachTaskListRowActivity(task, task.activity!));
    });
    const trigger = view.getByTestId("task-attention-trigger");
    expect(trigger.textContent).toContain("1");
    const badge = trigger.querySelector("[data-attention-count]")!;
    expect(badge.className).toContain("bg-interaction-confirmation-surface");
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: /Execution error/ })).toBeTruthy();
    act(() => useTaskQueryCacheStore.getState().clearAll());
    expect(view.queryByTestId("task-attention-trigger")).toBeNull();
    expect(view.listTaskList).not.toHaveBeenCalled();
  });
});
