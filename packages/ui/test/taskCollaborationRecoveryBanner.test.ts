// @vitest-environment jsdom
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { PendingCommandRecoveryBanner } from "../src/v4/PendingCommandRecoveryBanner.js";
import { ZCodeIntlProvider } from "../src/i18n/IntlProvider.js";
import type { PendingCommandEntry } from "../src/v4/pendingCommandRegistry.js";
it("query-only recovery offers refresh and open, never mutation replay", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const refresh = vi.fn(),
    open = vi.fn(),
    resend = vi.fn();
  const entry: PendingCommandEntry = {
    commandId: "c",
    clientId: "ui",
    sessionId: "p",
    issuedAt: 1,
    expiresAt: 1000,
    replay: { kind: "queryOnly", type: "forkAssistant" },
    recovery: "creationUnknown",
  };
  const render = (e: PendingCommandEntry) =>
    act(() =>
      root.render(
        createElement(
          ZCodeIntlProvider,
          { initialLocale: "zh-CN" },
          createElement(PendingCommandRecoveryBanner, {
            entry: e,
            onResend: resend,
            onRefresh: refresh,
            onOpenCreated: open,
            onDismiss: vi.fn(),
          }),
        ),
      ),
    );
  try {
    render(entry);
    expect(container.textContent).toContain("待确认");
    expect(container.textContent).not.toContain("重新发送");
    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("查询"))!
        .click(),
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(resend).not.toHaveBeenCalled();
    render({ ...entry, recovery: "creationRecovered", resolvedSessionId: "child" });
    act(() =>
      Array.from(container.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("打开会话"))!
        .click(),
    );
    expect(open).toHaveBeenCalledOnce();
    expect(resend).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
