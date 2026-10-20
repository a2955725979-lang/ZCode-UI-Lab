// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { shouldIgnoreEscapeForStopGeneration } from "@/v4/composer/escapeStop.js";

afterEach(() => document.body.replaceChildren());

function observe(target: HTMLElement, boundary: EventTarget | null = null) {
  let ignored: boolean | undefined;
  const listener = (event: KeyboardEvent) => {
    ignored = shouldIgnoreEscapeForStopGeneration(event, boundary);
  };
  window.addEventListener("keydown", listener);
  try {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    return ignored;
  } finally {
    window.removeEventListener("keydown", listener);
  }
}

describe("pane-scoped Escape stop boundary", () => {
  it("ignores an unhandled option inside the owning interaction boundary", () => {
    const boundary = document.createElement("div");
    const option = document.createElement("button");
    option.setAttribute("role", "option");
    boundary.append(option);
    document.body.append(boundary);
    expect(observe(option, boundary)).toBe(true);
  });

  it("does not ignore a composer outside that boundary or an unrelated option", () => {
    const boundary = document.createElement("div");
    const composer = document.createElement("textarea");
    const option = document.createElement("button");
    option.setAttribute("role", "option");
    document.body.append(boundary, composer, option);
    expect(observe(composer, boundary)).toBe(false);
    expect(observe(option, boundary)).toBe(false);
    expect(observe(option)).toBe(false);
  });

  it("does not exempt another pane's boundary", () => {
    const current = document.createElement("div");
    const other = document.createElement("div");
    const input = document.createElement("input");
    other.append(input);
    document.body.append(current, other);
    expect(observe(input, current)).toBe(false);
  });

  it("retains the defaultPrevented guard", () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.addEventListener("keydown", (event) => event.preventDefault());
    expect(observe(input)).toBe(true);
  });

  it.each(["role", "slot"])("retains the %s dialog guard outside a card", (kind) => {
    const dialog = document.createElement("div");
    if (kind === "role") dialog.setAttribute("role", "dialog");
    else dialog.dataset.slot = "dialog-content";
    const input = document.createElement("input");
    dialog.append(input);
    document.body.append(dialog);
    expect(observe(input)).toBe(true);
  });
});
