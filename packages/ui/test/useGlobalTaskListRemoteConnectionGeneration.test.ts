// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { Emitter } from "@zcode/rpc";
import type {
  IServiceAccessor,
  IWindowControllerService,
  WindowHostControllerFrame,
} from "@zcode/services";
import type { ZCodeTaskMeta } from "@zcode/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceProvider } from "@/hooks/useServices.js";
import { useGlobalTaskList } from "@/hooks/useGlobalTaskList.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import type { WorkspaceTabState } from "@/store/tabStore.js";

const REMOTE_IDENTITY = "remote:wsl:default:root:/root";
const REMOTE_SESSION_ID = "wsl-session-1";

function remoteTab(remoteSessionId?: string): WorkspaceTabState {
  return {
    id: "workspace-remote",
    kind: "workspace",
    label: "root",
    workspacePath: "/root",
    workspaceIdentity: REMOTE_IDENTITY,
    ...(remoteSessionId ? { remoteSessionId } : {}),
  } as WorkspaceTabState;
}

function remoteTask(): ZCodeTaskMeta {
  return {
    taskId: "task-before-connect",
    traceId: "trace-task-before-connect",
    title: "历史任务",
    workspacePath: "/root",
    workspaceIdentity: REMOTE_IDENTITY,
    createdAt: 1,
    updatedAt: 2,
    mode: "default",
  };
}

describe("useGlobalTaskList remote connection generation", () => {
  afterEach(() => {
    useZCodeSessionStore.setState({ workspaces: {} });
  });

  it("同一 WSL workspace 从断开占位变为在线 session 后重新查询 Controller", async () => {
    const controllerFrames = new Emitter<WindowHostControllerFrame>();
    let connected = false;
    const listTaskList = vi.fn(async () => ({
      items: connected
        ? [
            {
              ...remoteTask(),
              remoteSessionId: REMOTE_SESSION_ID,
              sourceAvailability: "online" as const,
            },
          ]
        : [],
      total: connected ? 1 : 0,
      hasMore: false,
    }));
    let subscriptionSerial = 0;
    const controller = {
      listTaskList,
      onDynamicControllerFrame: vi.fn(() => controllerFrames.event),
      subscribeControllerV4: vi.fn(async ({ topic }: { topic: string }) => ({
        ack: {
          subscriptionId: `${topic}-${++subscriptionSerial}`,
          mode: "snapshot" as const,
          logEpoch: "epoch-1",
        },
      })),
      unsubscribeControllerV4: vi.fn(async () => undefined),
      resyncControllerV4: vi.fn(),
    } as unknown as IWindowControllerService;
    const services = { windowControllerService: controller } as unknown as IServiceAccessor;
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ServiceProvider, { services }, children);

    const { result, rerender, unmount } = renderHook(
      ({ workspaceTabs }: { workspaceTabs: WorkspaceTabState[] }) =>
        useGlobalTaskList({
          kind: "timeline",
          workspaceTabs,
          sortBy: "updated",
          searchQuery: "",
          expanded: true,
          collapsedLimit: 100,
        }),
      {
        initialProps: { workspaceTabs: [remoteTab()] },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(listTaskList).toHaveBeenCalledTimes(1);
      expect(result.current.items).toEqual([]);
    });

    connected = true;
    rerender({ workspaceTabs: [remoteTab(REMOTE_SESSION_ID)] });

    await waitFor(() => {
      expect(listTaskList).toHaveBeenCalledTimes(2);
      expect(result.current.items.map((task) => task.taskId)).toEqual(["task-before-connect"]);
    });

    rerender({ workspaceTabs: [remoteTab(REMOTE_SESSION_ID)] });
    await waitFor(() => {
      expect(listTaskList).toHaveBeenCalledTimes(2);
    });

    rerender({ workspaceTabs: [remoteTab("wsl-session-2")] });
    await waitFor(() => {
      expect(listTaskList).toHaveBeenCalledTimes(3);
    });

    unmount();
  });

  it("搜索冷索引未就绪时不展示上一查询的陈旧结果，重试后恢复", async () => {
    const controllerFrames = new Emitter<WindowHostControllerFrame>();
    let rebuilding = false;
    const listTaskList = vi.fn(async ({ search }: { search?: string }) => {
      if (rebuilding)
        throw Object.assign(new Error("rebuilding"), { code: "TASK_SEARCH_INDEX_NOT_READY" });
      return { items: search ? [remoteTask()] : [], total: search ? 1 : 0, hasMore: false };
    });
    const controller = {
      listTaskList,
      onDynamicControllerFrame: vi.fn(() => controllerFrames.event),
      subscribeControllerV4: vi.fn(async ({ topic }: { topic: string }) => ({
        ack: { subscriptionId: topic, mode: "snapshot" as const, logEpoch: "epoch-1" },
      })),
      unsubscribeControllerV4: vi.fn(async () => undefined),
      resyncControllerV4: vi.fn(),
    } as unknown as IWindowControllerService;
    const services = { windowControllerService: controller } as unknown as IServiceAccessor;
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ServiceProvider, { services }, children);
    const { result, rerender, unmount } = renderHook(
      ({ searchQuery }: { searchQuery: string }) =>
        useGlobalTaskList({
          kind: "active",
          workspaceTabs: [remoteTab(REMOTE_SESSION_ID)],
          sortBy: "updated",
          searchQuery,
          expanded: true,
          collapsedLimit: 100,
        }),
      { initialProps: { searchQuery: "原查询" }, wrapper },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rebuilding = true;
    rerender({ searchQuery: "新查询" });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.searchIndexRebuilding).toBe(true);
      expect(result.current.items).toEqual([]);
      expect(result.current.total).toBe(0);
    });

    rebuilding = false;
    await result.current.refresh();
    await waitFor(() => {
      expect(result.current.searchIndexRebuilding).toBe(false);
      expect(result.current.items).toHaveLength(1);
    });
    unmount();
  });
});
