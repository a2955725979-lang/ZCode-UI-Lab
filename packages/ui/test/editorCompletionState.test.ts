import { createEditor, COMMAND_PRIORITY_LOW } from "lexical";
import { describe, expect, it } from "vitest";
import {
  isEditorCompletionMenuOpen,
  QUERY_COMPLETION_MENU_COMMAND,
} from "@/lib/editorCompletionState.js";

describe("editor-owned completion query", () => {
  it("isolates completion menus between editors and releases unmounted providers", () => {
    const current = createEditor();
    const other = createEditor();
    const removeOther = other.registerCommand(
      QUERY_COMPLETION_MENU_COMMAND,
      (query) => {
        query.open = true;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    expect(isEditorCompletionMenuOpen(other)).toBe(true);
    expect(isEditorCompletionMenuOpen(current)).toBe(false);
    const removeCurrent = current.registerCommand(
      QUERY_COMPLETION_MENU_COMMAND,
      (query) => {
        query.open = true;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    expect(isEditorCompletionMenuOpen(current)).toBe(true);
    removeCurrent();
    expect(isEditorCompletionMenuOpen(current)).toBe(false);
    removeOther();
  });

  it("combines slash and mention ownership without a false provider clearing an open menu", () => {
    const editor = createEditor();
    const removeSlash = editor.registerCommand(
      QUERY_COMPLETION_MENU_COMMAND,
      (query) => {
        query.open ||= true;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const removeMention = editor.registerCommand(
      QUERY_COMPLETION_MENU_COMMAND,
      (query) => {
        query.open ||= false;
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    expect(isEditorCompletionMenuOpen(editor)).toBe(true);
    removeSlash();
    expect(isEditorCompletionMenuOpen(editor)).toBe(false);
    removeMention();
  });
});
