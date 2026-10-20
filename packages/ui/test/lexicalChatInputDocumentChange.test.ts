// @vitest-environment jsdom
import { createElement, createRef } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LexicalChatInput, type LexicalChatInputHandle } from "@/LexicalChatInput.js";

// Keep the real Lexical editor, nodes and document-change listener; isolate catalogs and settings.
vi.mock("@/SlashCommandPlugin.js", () => ({ SlashCommandPlugin: () => null }));
vi.mock("@/mentions/MentionPlugin.js", () => ({ MentionPlugin: () => null }));
vi.mock("@/v4/activeTaskProvider.js", () => ({ useChatViewActiveTaskProvider: () => "codex" }));
vi.mock("@/shortcuts/useShortcutBindings.js", () => ({ useEffectiveShortcutBindings: () => ({}) }));
vi.mock("@/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/uiPerfArmsTelemetry.js", () => ({ recordInputLag: vi.fn() }));

afterEach(cleanup);

describe("Lexical document change payload", () => {
  it("flushes pending user changes with complete JSON before the owner checks restore eligibility", async () => {
    const api = createRef<LexicalChatInputHandle>();
    const onChange = vi.fn();
    render(createElement(LexicalChatInput, {
      workspacePath: "/synthetic-editor", taskId: null, onSubmit: () => false,
      editorApiRef: api, onChange, enableMentionPanel: false,
    }));
    await waitFor(() => expect(api.current).toBeTruthy());
    act(() => {
      api.current!.setText("new pending user edit");
      expect(onChange).not.toHaveBeenCalled();
      api.current!.flushPendingChanges!();
      expect(onChange).toHaveBeenCalledTimes(1);
      const [text, json] = onChange.mock.calls[0]!;
      expect(text).toBe("new pending user edit");
      expect(JSON.parse(json)).toEqual(api.current!.getEditorState().toJSON());
      expect(api.current!.getMarkdown()).toBe("new pending user edit");
    });
  });

  it("returns the current complete JSON for same-text rich-node changes, including programmatic edits", async () => {
    const api = createRef<LexicalChatInputHandle>();
    const onChange = vi.fn();
    render(
      createElement(LexicalChatInput, {
        workspacePath: "/synthetic-editor",
        taskId: null,
        onSubmit: () => false,
        editorApiRef: api,
        onChange,
        inputTestId: "editor",
        enableMentionPanel: false,
      }),
    );
    await waitFor(() => expect(api.current).toBeTruthy());
    await act(async () =>
      api.current!.setMention({
        id: "file",
        category: "files",
        label: "example.ts",
        value: "/example.ts",
        markdown: "[example.ts](/example.ts)",
        data: { path: "/example.ts", scope: "workspace" },
      }),
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const previousText = api.current!.getMarkdown();
    const nextState = api.current!.getEditorState().toJSON();
    const paragraph = nextState.root.children[0] as {
      children: Array<{ type: string; data?: unknown }>;
    };
    const mention = paragraph.children.find((node) => node.type === "prompt-mention")!;
    mention.data = { path: "/example.ts", scope: "user" };
    onChange.mockClear();
    await act(async () => api.current!.setEditorStateJson(JSON.stringify(nextState)));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const [text, json] = onChange.mock.calls[0]!;
    expect(text).toBe(previousText);
    expect(JSON.parse(json)).toEqual(api.current!.getEditorState().toJSON());
    expect(JSON.parse(json).root.children[0].children[0].data.scope).toBe("user");
  });

  it("does not turn selection-only focus into a document edit", async () => {
    const api = createRef<LexicalChatInputHandle>();
    const onChange = vi.fn();
    render(
      createElement(LexicalChatInput, {
        workspacePath: "/synthetic-editor",
        taskId: null,
        onSubmit: () => false,
        editorApiRef: api,
        onChange,
        enableMentionPanel: false,
      }),
    );
    await act(async () => api.current!.setText("draft"));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    onChange.mockClear();
    await act(async () => api.current!.focus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("commits pending user edits before a restore and never suppresses a later identical user edit", async () => {
    const api = createRef<LexicalChatInputHandle>();
    const onChange = vi.fn();
    render(
      createElement(LexicalChatInput, {
        workspacePath: "/synthetic-editor",
        taskId: null,
        onSubmit: () => false,
        editorApiRef: api,
        onChange,
        enableMentionPanel: false,
      }),
    );
    await act(async () => {
      api.current!.setText("pending user edit");
      api.current!.setText("restored draft", { restoreDraft: true });
      api.current!.setText("other restored draft", { restoreDraft: true });
    });
    expect(onChange.mock.calls.map(([text]) => text)).toEqual(["pending user edit"]);
    expect(api.current!.getMarkdown()).toBe("other restored draft");
    await act(async () => api.current!.setText("restored draft"));
    expect(onChange.mock.calls.map(([text]) => text)).toEqual([
      "pending user edit",
      "restored draft",
    ]);
  });

  it("keeps JSON and legacy mention restores silent while ordinary prefills still report edits", async () => {
    const api = createRef<LexicalChatInputHandle>();
    const onChange = vi.fn();
    render(
      createElement(LexicalChatInput, {
        workspacePath: "/synthetic-editor",
        taskId: null,
        onSubmit: () => false,
        editorApiRef: api,
        onChange,
        enableMentionPanel: false,
      }),
    );
    await act(async () => api.current!.setText("initial"));
    const json = JSON.stringify(api.current!.getEditorState().toJSON());
    onChange.mockClear();
    await act(async () => {
      api.current!.setEditorStateJson(json, { restoreDraft: true });
      api.current!.setMention(
        {
          id: "file",
          category: "files",
          label: "example.ts",
          value: "/example.ts",
          markdown: "@example.ts",
        },
        " ",
        { restoreDraft: true },
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => api.current!.setText("ordinary prefill"));
    expect(onChange).toHaveBeenCalledWith("ordinary prefill", expect.any(String));
  });
});
