// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { Emitter } from "@zcode/rpc";
import type { IServiceAccessor, WindowHostControllerFrame } from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceProvider } from "@/hooks/useServices.js";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

const state = { predicate: (_task: { taskId: string }) => true };
afterEach(cleanup);

function setup(kind: "timeline" | "pinned" | "archived" | "active", searchQuery = "") {
  const tasks = Array.from(
    { length: 12 },
    (_, index) =>
      ({
        taskId: `task-${index}`,
        workspacePath: "/shared",
        traceId: `trace-${index}`,
        title: `History ${index}`,
        mode: "default",
        createdAt: index,
        updatedAt: index,
      }) as ZCodeTaskMeta,
  );
  const frames = new Emitter<WindowHostControllerFrame>();
  const listTaskList = vi.fn(async (query: { limit?: number }) => {
    const items = query.limit == null ? tasks : tasks.slice(0, query.limit);
    return { items, total: tasks.length, hasMore: items.length < tasks.length };
  });
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
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ServiceProvider, { services }, children);
  const workspaceTabs: WorkspaceTabState[] = [
    { id: "shared", kind: "workspace", label: "shared", workspacePath: "/shared" },
  ];
  const hook = renderHook(
    ({ expanded }) =>
      useGlobalTaskList({
        kind,
        workspaceTabs,
        sortBy: "updated",
        searchQuery,
        expanded,
        collapsedLimit: 3,
        predicate: state.predicate,
      }),
    { initialProps: { expanded: false }, wrapper },
  );
  return { ...hook, listTaskList };
}

describe("history mode filtering before pagination", () => {
  it.each(["timeline", "pinned", "archived", "active"] as const)(
    "%s fills a page from matching records beyond the source page",
    async (kind) => {
      state.predicate = (task) => Number(task.taskId.split("-")[1]) >= 7;
      const harness = setup(kind, kind === "active" ? "History" : "");
      await waitFor(() => expect(harness.result.current.loading).toBe(false));
      expect(harness.listTaskList).toHaveBeenCalledWith(
        expect.objectContaining({ limit: undefined }),
      );
      expect(harness.result.current.items.map((task) => task.taskId)).toEqual([
        "task-7",
        "task-8",
        "task-9",
      ]);
      expect(harness.result.current.total).toBe(5);
      expect(harness.result.current.hasMore).toBe(true);
      harness.rerender({ expanded: true });
      expect(harness.result.current.items).toHaveLength(5);
      expect(harness.result.current.hasMore).toBe(false);
      expect(harness.listTaskList).toHaveBeenCalledTimes(1);
    },
  );

  it("reclassifies cached metadata immediately when switching mode or moving a record", async () => {
    state.predicate = (task) => task.taskId === "task-11";
    const harness = setup("timeline");
    await waitFor(() =>
      expect(harness.result.current.items.map((task) => task.taskId)).toEqual(["task-11"]),
    );
    state.predicate = (task) => task.taskId !== "task-11";
    harness.rerender({ expanded: false });
    expect(harness.result.current.items.map((task) => task.taskId)).toEqual([
      "task-0",
      "task-1",
      "task-2",
    ]);
    expect(harness.result.current.total).toBe(11);
    state.predicate = () => false;
    harness.rerender({ expanded: false });
    expect(harness.result.current.items).toEqual([]);
    expect(harness.result.current.total).toBe(0);
    expect(harness.result.current.hasMore).toBe(false);
    expect(harness.listTaskList).toHaveBeenCalledTimes(1);
  });
});
