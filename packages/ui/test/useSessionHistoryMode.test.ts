// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IBroadcastService } from "@zcode/services";
import { createZCodeStore } from "@/store/index.js";
import { StoreContext } from "@/store/StoreProvider.js";
import { setSessionHistoryMode, setSessionHistoryFilter } from "@/store/sessionHistoryModeStore.js";
import {
  useSessionHistoryMode,
  useSessionHistoryModePredicate,
} from "@/hooks/useSessionHistoryMode.js";

const scope = { workspacePath: "/same", workspacePurpose: "conversation" as const };
const task = { ...scope, taskId: "session" };
const broadcastService: IBroadcastService = {
  send: async () => {},
  acquireClaim: async () => ({ status: "unavailable" }),
  commitClaim: async () => {},
  releaseClaim: async () => {},
  tryClaim: async () => false,
  onMessage: () => ({ dispose: () => {} }),
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("session history mode hooks", () => {
  it("applies independent filters while preserving mode-default behavior", () => {
    const store = createZCodeStore(broadcastService);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StoreContext.Provider, { value: store }, children);
    const { result } = renderHook(() => useSessionHistoryModePredicate([scope]), { wrapper });
    expect(result.current(task)).toBe(false);
    act(() => setSessionHistoryFilter("work", "all"));
    expect(result.current(task)).toBe(true);
    act(() => store.getState().setInterfaceMode("office"));
    expect(result.current(task)).toBe(true);
    act(() => setSessionHistoryFilter("chat", "work"));
    expect(result.current(task)).toBe(false);
    act(() => store.getState().setInterfaceMode("coding"));
    expect(result.current(task)).toBe(true);
  });

  it("uses coding without a provider and reacts to manual moves", () => {
    const { result } = renderHook(() => useSessionHistoryModePredicate([scope]));
    expect(result.current(task)).toBe(false);
    const before = result.current;
    act(() => setSessionHistoryMode(scope, task.taskId, "work"));
    expect(result.current).not.toBe(before);
    expect(result.current(task)).toBe(true);
  });

  it("updates for interface mode and scope purpose without moving the session", () => {
    const store = createZCodeStore(broadcastService);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(StoreContext.Provider, { value: store }, children);
    const { result, rerender } = renderHook(
      ({ purpose }: { purpose: "conversation" | "project" }) =>
        useSessionHistoryModePredicate([{ ...scope, workspacePurpose: purpose }]),
      {
        initialProps: { purpose: "conversation" },
        wrapper,
      },
    );
    const before = result.current;
    rerender({ purpose: "conversation" });
    expect(result.current).toBe(before);
    act(() => store.getState().setInterfaceMode("office"));
    expect(result.current(task)).toBe(true);
    rerender({ purpose: "project" });
    expect(result.current(task)).toBe(false);
    expect(localStorage.length).toBe(1); // only the interface preference, no session claim
  });

  it("updates from another window and does not claim an empty session", () => {
    const { result } = renderHook(() => useSessionHistoryMode(scope, task.taskId, "conversation"));
    act(() => setSessionHistoryMode(scope, task.taskId, "work"));
    expect(result.current).toBe("work");
    const key = localStorage.key(0)!;
    act(() => {
      localStorage.setItem(key, "chat");
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: "chat" }));
    });
    expect(result.current).toBe("chat");
    renderHook(() => useSessionHistoryMode(scope, undefined, "conversation"));
    expect(localStorage.length).toBe(1);
  });
});
