// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IBroadcastService } from "@zcode/services";
import { WorkspaceModeSwitcher } from "@/WorkspaceModeSwitcher.js";
import { StoreContext } from "@/store/StoreProvider.js";
import { createZCodeStore } from "@/store/index.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { INTERFACE_MODE_STORAGE_KEY } from "@/lib/interfaceMode.js";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
describe("visible Chat / Work preference", () => {
  it("uses the existing persisted and broadcast owner in both directions", () => {
    const send = vi.fn(async () => {});
    const broadcast: IBroadcastService = {
      send,
      acquireClaim: async () => ({ status: "unavailable" }),
      commitClaim: async () => {},
      releaseClaim: async () => {},
      tryClaim: async () => false,
      onMessage: () => ({ dispose: () => {} }),
    };
    localStorage.setItem(INTERFACE_MODE_STORAGE_KEY, "coding");
    const store = createZCodeStore(broadcast);
    store.getState().setCodePreviewSettings({ wrapLongLines: false });
    render(
      createElement(
        StoreContext.Provider,
        { value: store },
        createElement(
          ZCodeIntlProvider,
          { initialLocale: "en-US" },
          createElement(WorkspaceModeSwitcher),
        ),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(store.getState().interfaceMode).toBe("office");
    expect(localStorage.getItem(INTERFACE_MODE_STORAGE_KEY)).toBe("office");
    expect(screen.getByRole("button", { name: "Chat" }).getAttribute("aria-pressed")).toBe("true");
    expect(send).toHaveBeenCalledWith({ channel: "state:interfaceMode", payload: "office" });
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(store.getState().interfaceMode).toBe("coding");
    expect(store.getState().codePreviewSettings.wrapLongLines).toBe(false);
  });
});
