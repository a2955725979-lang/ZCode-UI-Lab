import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const textarea = await readFile(
  new URL("../src/components/ui/textarea.tsx", import.meta.url),
  "utf8",
);
const inputGroup = await readFile(
  new URL("../src/components/ui/input-group.tsx", import.meta.url),
  "utf8",
);

const stylesheet = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

// DOM focus tests cannot detect a shared CSS reset that hides every keyboard indicator.
// Keep this source guard in addition to the real-component screenshot acceptance fixture.
describe("shared keyboard focus stylesheet", () => {
  it("does not erase focused element outlines or elevation globally", () => {
    const globalFocusResets = [
      ...stylesheet.matchAll(/\*:(?:focus|focus-visible)\b[^{}]*\{([^}]+)\}/g),
    ];
    for (const rule of globalFocusResets) {
      expect(rule[1]).not.toMatch(/(?:outline|box-shadow)\s*:\s*none/);
    }
  });

  it("provides a focused-input token button outline and a forced-colors system outline", () => {
    expect(stylesheet).toMatch(
      /\):focus-visible\s*\{\s*outline:\s*2px solid var\(--color-input-border-focused\);\s*outline-offset:\s*1px;/,
    );
    expect(stylesheet).toMatch(
      /@media \(forced-colors: active\)[\s\S]+?outline-color:\s*Highlight;/,
    );
  });

  it("uses only focused field borders/backgrounds and keeps row focus backgrounds", () => {
    expect(stylesheet).toMatch(
      /\[data-slot="input"\][\s\S]+?outline:\s*none;\s*border-color:\s*var\(--color-input-border-focused\);\s*background-color:\s*var\(--color-input-focused\);/,
    );
    expect(stylesheet).toContain(
      '[data-slot="select-trigger"][data-variant="input"]:focus-visible',
    );
    expect(stylesheet).toContain(
      '[data-slot="input-group"]:has([data-slot="input-group-control"]:focus-visible)',
    );
    expect(stylesheet).toContain("border-color: var(--color-destructive)");
    expect(stylesheet).toMatch(
      /:not\(\s*\[role="option"\],\s*\[role="menuitem"\],\s*\[role="checkbox"\]/,
    );
    expect(stylesheet).not.toContain("outline-offset: -1px");
    expect(stylesheet).toMatch(
      /@media \(forced-colors: active\)[\s\S]+?outline:\s*2px solid Highlight;\s*outline-offset:\s*2px;/,
    );
    expect(textarea).toContain("border-input-border bg-input");
    expect(textarea).toContain("focus-visible:bg-input-focused");
    expect(textarea).not.toMatch(/focus-visible:(?:ring-2|border-ring|ring-ring)/);
    expect(inputGroup).not.toMatch(/focus-visible\]:(?:ring-2|border-ring|ring-ring)/);
    expect(textarea).toContain("aria-invalid:ring-destructive/20");
    expect(inputGroup).toContain("aria-invalid=true]]:ring-destructive/20");
  });

  it("keeps the composer free of extra frames and focus underlines", () => {
    expect(stylesheet).toMatch(
      /\[data-chat-prompt-editor-shell\][^{]+?\[contenteditable="true"\]:focus-visible\s*\{\s*outline:\s*none;/,
    );
    expect(stylesheet).not.toMatch(/\[data-chat-prompt-editor-shell\][^{]*::(?:before|after)\s*\{/);
  });
});
