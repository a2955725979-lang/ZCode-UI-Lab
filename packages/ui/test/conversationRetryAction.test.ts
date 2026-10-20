// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationRetryAction } from "@/v4/ConversationRetryAction.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/ai-elements/message.js", () => ({
  MessageAction: ({
    label: _label,
    tooltip: _tooltip,
    ...props
  }: ComponentProps<"button"> & { label?: string; tooltip?: string }) =>
    createElement("button", props),
}));
afterEach(cleanup);
const target = { rowId: 42, entityId: "answer-42" };
function action(onRetry?: (value: typeof target) => void) {
  return createElement(
    ZCodeIntlProvider,
    { initialLocale: "en-US" },
    createElement(ConversationRetryAction, { target, onRetry }),
  );
}
describe("authoritative regenerate confirmation", () => {
  it("has no action without capability", () => {
    render(action());
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("explains rewind and only dispatches the existing target after confirmation", () => {
    const retry = vi.fn();
    render(action(retry));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(retry).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog").textContent).toContain("all later conversation content");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Regenerate" }).at(-1)!);
    expect(retry).toHaveBeenCalledExactlyOnceWith(target);
  });
  it("removes an open confirmation when authority is revoked", () => {
    const retry = vi.fn();
    const view = render(action(retry));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    view.rerender(action());
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(retry).not.toHaveBeenCalled();
  });
});
