import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { useRemoteTimelineTaskStore } from "@/store/remoteTimelineTaskStore.js";
afterEach(() => useRemoteTimelineTaskStore.getState().clearWorkspace("/remote", "remote:test"));
describe("remote timeline history candidates", () => {
  it("retains complete metadata when a background caller requests only ten records", async () => {
    const rows = Array.from(
      { length: 35 },
      (_, i) =>
        ({
          taskId: `task-${i}`,
          traceId: `trace-${i}`,
          workspacePath: "/remote",
          workspaceIdentity: "remote:test",
          title: `Task ${i}`,
          mode: "default",
          createdAt: i,
          updatedAt: i,
        }) as ZCodeTaskMeta,
    );
    const listTaskList = vi.fn(async ({ limit }: { limit?: number }) => ({
      items: limit == null ? rows : rows.slice(0, limit),
      total: rows.length,
      hasMore: limit != null && limit < rows.length,
    }));
    await useRemoteTimelineTaskStore
      .getState()
      .refreshWorkspace({
        workspacePath: "/remote",
        workspaceIdentity: "remote:test",
        sortBy: "updated",
        limit: 10,
        zcodeTaskService: { listTaskList },
      });
    expect(listTaskList).toHaveBeenCalledWith(expect.objectContaining({ limit: undefined }));
    expect(useRemoteTimelineTaskStore.getState().itemsByWorkspaceKey["remote:test"]).toHaveLength(
      35,
    );
    expect(useRemoteTimelineTaskStore.getState().hasMoreByWorkspaceKey["remote:test"]).toBe(false);
  });
});
