import { useMemo, useSyncExternalStore } from "react";
import type { ZCodeTaskMeta } from "@zcode/shared";
import type { WindowHostControllerTaskListItem } from "@zcode/services";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { isTaskAttentionItem } from "@/lib/taskAttention.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";
import { useTaskQueryCacheStore } from "@/store/taskQueryCacheStore.js";
import { attachTaskListRowActivity } from "@/v4/taskListRowActivity.js";
import { getWindowControllerTaskListRegistry } from "@/v4/windowControllerTaskListRegistry.js";

type CachedAttentionTask = ZCodeTaskMeta &
  Partial<Pick<WindowHostControllerTaskListItem, "remoteSessionId" | "sourceAvailability">>;

const subscribeToNothing = () => () => {};
const zeroRevision = () => 0;

/** 只投影既有元数据；侧栏常驻入口不得为计数再发一条全量列表查询。 */
export function useCachedTaskAttention(workspaceTabs: WorkspaceTabState[]) {
  const { windowControllerService: controller } = useBaseWorkspaceServices();
  const registry = useMemo(
    () => (controller ? getWindowControllerTaskListRegistry(controller) : null),
    [controller],
  );
  const revision = useSyncExternalStore(
    registry?.subscribe ?? subscribeToNothing,
    registry?.getRevision ?? zeroRevision,
    registry?.getRevision ?? zeroRevision,
  );
  const cachedMetadata = useTaskQueryCacheStore((state) => state.taskMetaByEntityKey);
  return useMemo<CachedAttentionTask[]>(() => {
    const workspaceKeys = new Set(
      workspaceTabs.map((tab) => tab.workspaceIdentity?.trim() || tab.workspacePath),
    );
    // Controller 已有快照时只采信该快照，不能让旧实体缓存复活已删除/已解决的待处理项。
    const tasks = registry?.getCachedTasks() ?? Object.values(cachedMetadata);
    return tasks
      .filter((task) => workspaceKeys.has(task.workspaceIdentity?.trim() || task.workspacePath))
      .map((task) => {
        const activity = (task as WindowHostControllerTaskListItem).activity;
        return activity ? attachTaskListRowActivity(task, activity) : task;
      })
      .filter(isTaskAttentionItem)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }, [cachedMetadata, registry, revision, workspaceTabs]);
}
