import { describe, expect, it } from "vitest";
import type { ZCodeGroupedTaskView, ZCodeGroupedTaskViewNode } from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";
import {
  filterSessionHistoryGroupedView,
  restoreHiddenSessionHistoryGroupedTasks,
} from "@/lib/sessionHistoryGroupedView.js";
function task(taskId: string): ZCodeTaskMeta {
  return {
    taskId,
    workspacePath: "/shared",
    createdAt: 1,
    updatedAt: 1,
    traceId: taskId,
    mode: "default",
  };
}
function root(id: string): ZCodeGroupedTaskViewNode {
  return { type: "task", task: task(id) } as ZCodeGroupedTaskViewNode;
}
function group(ids: string[]): ZCodeGroupedTaskViewNode {
  return {
    type: "group",
    group: { id: "group" },
    tasks: ids.map(task),
  } as ZCodeGroupedTaskViewNode;
}
const matches = (entry: ZCodeTaskMeta) => entry.taskId.startsWith("work");
describe("history grouped projection", () => {
  it("filters roots and group members while retaining the full source", () => {
    const source: ZCodeGroupedTaskView = {
      nodes: [root("chat-root"), root("work-root"), group(["chat-member", "work-a", "work-b"])],
    };
    const visible = filterSessionHistoryGroupedView(source, matches);
    expect(visible.nodes).toHaveLength(2);
    const node = visible.nodes[1];
    expect(node.type === "group" && node.tasks.map((item) => item.taskId)).toEqual([
      "work-a",
      "work-b",
    ]);
    expect(source.nodes).toHaveLength(3);
    expect(source.nodes[2].type === "group" && source.nodes[2].tasks).toHaveLength(3);
  });
  it("reorders and moves visible tasks without dropping hidden root or group members", () => {
    const source: ZCodeGroupedTaskView = {
      nodes: [root("chat-root"), root("work-root"), group(["work-a", "chat-member", "work-b"])],
    };
    const next: ZCodeGroupedTaskView = { nodes: [group(["work-b", "work-root"]), root("work-a")] };
    const restored = restoreHiddenSessionHistoryGroupedTasks(source, next, matches);
    expect(restored.nodes[0]).toEqual(root("chat-root"));
    const node = restored.nodes[1];
    expect(node.type === "group" && node.tasks.map((item) => item.taskId)).toEqual([
      "work-b",
      "chat-member",
      "work-root",
    ]);
    expect(restored.nodes[2]).toEqual(root("work-a"));
    expect(filterSessionHistoryGroupedView(restored, matches)).toEqual(next);
  });
});
