// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  IServiceAccessor,
  ZCodeGroupedTaskViewOrderInput,
  ZCodeGroupedTaskViewStructure,
} from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { clearCachedGroupedViewsForTest, useGroupedTaskView } from "@/hooks/useGroupedTaskView.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
const state = vi.hoisted(() => ({
  tasks: [] as ZCodeTaskMeta[],
  matches: (task: ZCodeTaskMeta) => task.taskId.startsWith("work"),
}));
vi.mock("@/hooks/useSessionHistoryMode.js", () => ({
  useSessionHistoryModePredicate: () => state.matches,
}));
vi.mock("@/hooks/useGlobalTaskList.js", () => ({
  useGlobalTaskList: () => ({ items: state.tasks, loading: false }),
}));
beforeEach(() => {
  clearCachedGroupedViewsForTest();
  useZCodeSessionStore.setState({ workspaces: {} });
});
afterEach(() => {
  cleanup();
  clearCachedGroupedViewsForTest();
});
function allIds(input: ZCodeGroupedTaskViewOrderInput) {
  return [
    ...input.topLevelNodes.flatMap((node) => (node.type === "task" ? [node.task.taskId] : [])),
    ...input.groups.flatMap((group) => group.taskRefs.map((task) => task.taskId)),
  ];
}
async function setup() {
  state.tasks = [
    "chat-root",
    "work-root",
    "work-target",
    "chat-target",
    "chat-other",
    "work-other",
  ].map((taskId) => ({
    taskId,
    traceId: taskId,
    workspacePath: "/shared",
    title: taskId,
    mode: "default",
    createdAt: 1,
    updatedAt: 1,
  }));
  let structure: ZCodeGroupedTaskViewStructure = {
    groups: ["target", "other"].map((id) => ({
      id,
      title: id,
      color: "gray",
      createdAt: 1,
      updatedAt: 1,
    })),
    members: [
      ["target", "work-target"],
      ["target", "chat-target"],
      ["other", "chat-other"],
      ["other", "work-other"],
    ].map(([groupId, taskId], index) => ({
      groupId: groupId!,
      taskId: taskId!,
      workspaceKey: "/shared",
      workspacePath: "/shared",
      addedAt: 1,
      sortOrder: index,
    })),
    topLevelOrders: [],
  };
  const applyGroupedTaskViewOrder = vi.fn(async (input: ZCodeGroupedTaskViewOrderInput) => {
    const ids = allIds(input);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate task membership");
    structure = {
      ...structure,
      members: input.groups.flatMap((group) =>
        group.taskRefs.map((task, index) => ({
          groupId: group.groupId,
          workspaceKey: task.workspaceIdentity || task.workspacePath,
          workspacePath: task.workspacePath,
          taskId: task.taskId,
          sortOrder: index,
          addedAt: 1,
        })),
      ),
      topLevelOrders: input.topLevelNodes.map((node, index) =>
        node.type === "group"
          ? { type: "group" as const, groupId: node.groupId, sortOrder: index }
          : {
              type: "task" as const,
              workspaceKey: node.task.workspaceIdentity || node.task.workspacePath,
              taskId: node.task.taskId,
              sortOrder: index,
            },
      ),
    };
  });
  const deleteTaskGroup = vi.fn(async ({ groupId }: { groupId: string }) => {
    structure = { ...structure, groups: structure.groups.filter((group) => group.id !== groupId) };
  });
  const services = {
    zcodeTaskService: {
      listGroupedTaskViewStructure: vi.fn(async () => structure),
      listTasks: vi.fn(async () => state.tasks),
      listPinnedTaskIds: vi.fn(async () => []),
      listPinnedTasks: vi.fn(async () => []),
      listArchivedTasks: vi.fn(async () => []),
      listDeletedTaskIds: vi.fn(async () => []),
      onDynamicWorkspaceEvent: () => () => ({ dispose() {} }),
      applyGroupedTaskViewOrder,
      deleteTaskGroup,
    },
  } as unknown as IServiceAccessor;
  const workspaceTabs: WorkspaceTabState[] = [
    { id: "shared", kind: "workspace", workspacePath: "/shared", label: "Shared" },
  ];
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ServiceProvider, { services }, children);
  const hook = renderHook(() => useGroupedTaskView({ workspaceTabs }), { wrapper });
  await waitFor(() => expect(hook.result.current.view.nodes).toHaveLength(3));
  return { ...hook, applyGroupedTaskViewOrder, deleteTaskGroup };
}
describe("history grouped mutations preserve complete owner membership", () => {
  it("ungroups a mixed group once without duplicating hidden roots or another group's members", async () => {
    const harness = await setup();
    await act(async () => {
      await harness.result.current.ungroupGroup("target");
    });
    expect(harness.applyGroupedTaskViewOrder).toHaveBeenCalledTimes(1);
    const input = harness.applyGroupedTaskViewOrder.mock.calls[0]![0];
    expect(allIds(input).sort()).toEqual(state.tasks.map((task) => task.taskId).sort());
    expect(
      input.groups.map((group) => [group.groupId, ...group.taskRefs.map((task) => task.taskId)]),
    ).toEqual([["other", "chat-other", "work-other"]]);
    expect(
      input.topLevelNodes.flatMap((node) => (node.type === "task" ? [node.task.taskId] : [])),
    ).toEqual(expect.arrayContaining(["chat-root", "chat-target", "work-target"]));
    expect(harness.deleteTaskGroup).toHaveBeenCalledTimes(1);
    expect(
      harness.result.current.view.nodes.some(
        (node) => node.type === "group" && node.group.id === "target",
      ),
    ).toBe(false);
  });
  it("projected drag preview and save preserve every hidden member exactly once", async () => {
    const harness = await setup();
    const next = { nodes: [...harness.result.current.view.nodes].reverse() };
    act(() => harness.result.current.setView(next));
    await act(async () => {
      await harness.result.current.applyOrder(next);
    });
    const input = harness.applyGroupedTaskViewOrder.mock.calls[0]![0];
    expect(allIds(input).sort()).toEqual(state.tasks.map((task) => task.taskId).sort());
    expect(
      input.topLevelNodes
        .filter((node) => node.type === "group" || state.matches(node.task as ZCodeTaskMeta))
        .map((node) => (node.type === "group" ? node.groupId : node.task.taskId)),
    ).toEqual(next.nodes.map((node) => (node.type === "group" ? node.group.id : node.task.taskId)));
    expect(harness.deleteTaskGroup).not.toHaveBeenCalled();
  });
});
