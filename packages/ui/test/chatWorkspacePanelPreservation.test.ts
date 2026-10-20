// @vitest-environment jsdom
import { createElement, useLayoutEffect, type ReactNode } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResizablePanelGroup } from "@/components/ui/resizable.js";
import { useAnimatedResizablePanel } from "@/app-shell/useAnimatedResizablePanel.js";
const capture = vi.hoisted(() => ({
  callback: undefined as undefined | ((layout: Record<string, number>) => void),
  persist: vi.fn(),
}));
vi.mock("react-resizable-panels", () => ({
  useDefaultLayout: () => ({
    defaultLayout: { conversation: 63, browser: 37 },
    onLayoutChange: capture.persist,
  }),
  Group: ({
    onLayoutChange,
    children,
  }: {
    onLayoutChange?: typeof capture.callback;
    children?: ReactNode;
  }) => {
    capture.callback = onLayoutChange;
    return createElement("div", null, children);
  },
  Panel: () => null,
  Separator: () => null,
}));
beforeEach(() => {
  vi.useFakeTimers();
  capture.persist.mockClear();
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) =>
    window.setTimeout(() => fn(0), 1),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function settle() {
  act(() => vi.runAllTimers());
}
describe("Chat temporary panel geometry", () => {
  it("does not persist Chat geometry and restores persistence in Work", () => {
    const view = render(
      createElement(ResizablePanelGroup, { layoutId: "work", persistLayout: true }),
    );
    capture.callback?.({ conversation: 63, browser: 37 });
    view.rerender(createElement(ResizablePanelGroup, { layoutId: "work", persistLayout: false }));
    capture.callback?.({ conversation: 100, browser: 0 });
    expect(capture.persist).toHaveBeenCalledTimes(1);
    view.rerender(createElement(ResizablePanelGroup, { layoutId: "work", persistLayout: true }));
    capture.callback?.({ conversation: 63, browser: 37 });
    expect(capture.persist).toHaveBeenLastCalledWith({ conversation: 63, browser: 37 });
  });
  it("keeps the panel owner and restores its previous non-default size after hiding", () => {
    const panel = {
      collapse: vi.fn(),
      expand: vi.fn(),
      resize: vi.fn(),
      getSize: () => ({ asPercentage: 37, inPixels: 370 }),
      isCollapsed: () => false,
    };
    const view = renderHook(
      ({ visible }) => {
        const state = useAnimatedResizablePanel({
          open: visible,
          expandedSize: "30%",
          rememberExpandedSize: true,
          resizeOnInitialVisibleMount: false,
        });
        useLayoutEffect(() => {
          state.panelRef.current = panel;
        }, [state.panelRef]);
        return state;
      },
      { initialProps: { visible: true } },
    );
    settle();
    const owner = view.result.current.panelRef;
    view.rerender({ visible: false });
    settle();
    expect(panel.collapse).toHaveBeenCalledTimes(1);
    expect(view.result.current.panelRef).toBe(owner);
    view.rerender({ visible: true });
    settle();
    settle();
    expect(panel.resize).toHaveBeenLastCalledWith("37%");
    expect(view.result.current.panelRef).toBe(owner);
  });
});
