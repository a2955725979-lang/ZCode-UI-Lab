import type { ZCodeGroupedTaskView, ZCodeGroupedTaskViewNode } from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";

type Predicate = (task: ZCodeTaskMeta) => boolean;

/** 仅派生展示；原始分组、排序和隐藏成员继续由既有 owner 保存。 */
export function filterSessionHistoryGroupedView(
  view: ZCodeGroupedTaskView,
  predicate: Predicate,
): ZCodeGroupedTaskView {
  return {
    nodes: view.nodes.flatMap((node): ZCodeGroupedTaskViewNode[] => {
      if (node.type === "task") return predicate(node.task) ? [node] : [];
      const tasks = node.tasks.filter(predicate);
      return [tasks.length === node.tasks.length ? node : { ...node, tasks }];
    }),
  };
}

function retainHidden<T>(previous: T[], next: T[], isVisible: (item: T) => boolean): T[] {
  let index = 0;
  const result: T[] = [];
  for (const item of previous) {
    if (!isVisible(item)) result.push(item);
    else if (index < next.length) result.push(next[index++]!);
  }
  return [...result, ...next.slice(index)];
}

/** 修复：拖拽只看到当前模式，保存全量排序前必须补回另一模式的原始成员。 */
export function restoreHiddenSessionHistoryGroupedTasks(
  previous: ZCodeGroupedTaskView,
  next: ZCodeGroupedTaskView,
  predicate: Predicate,
): ZCodeGroupedTaskView {
  const groups = new Map(
    previous.nodes.flatMap((node) =>
      node.type === "group" ? [[node.group.id, node] as const] : [],
    ),
  );
  const nextNodes = next.nodes.map((node) => {
    if (node.type === "task") return node;
    const prior = groups.get(node.group.id);
    return prior ? { ...node, tasks: retainHidden(prior.tasks, node.tasks, predicate) } : node;
  });
  return {
    nodes: retainHidden(
      previous.nodes,
      nextNodes,
      (node) => node.type === "group" || predicate(node.task),
    ),
  };
}
