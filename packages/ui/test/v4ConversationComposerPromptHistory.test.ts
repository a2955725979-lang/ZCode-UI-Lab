import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPromptHistoryStorageKey,
  persistPromptHistoryEntries,
  readPromptHistoryEntries,
} from "@/lib/promptHistoryStorage.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import {
  ConversationComposer,
  type ConversationComposerSendResult,
  type ConversationComposerProps,
} from "@/v4/ConversationComposer.js";
import {
  persistV4ComposerDraft,
  readV4ComposerDraft,
  V4_DRAFT_SCOPE_ROOT,
  type V4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";
import { getComposerDraftRevision } from "@/v4/composer/composerDraftRevision.js";
import type { ComposerSubmissionConfig } from "@/v4/composer/composerSubmissionConfig.js";

const {
  attachmentState,
  chatPromptEditorProps,
  dialogOpenStates,
  inputClear,
  inputSetText,
  workTaskStartProps,
  followupPreviewProps,
  followupPreviewMountStates,
} = vi.hoisted(() => ({
  attachmentState: {
    adoptSentAttachments: vi.fn(async () => {}),
    hasUnreadyAttachments: false,
    prepareForSend: vi.fn(async () => []),
  },
  chatPromptEditorProps: [] as Array<Record<string, unknown>>,
  dialogOpenStates: [] as boolean[],
  inputClear: vi.fn(),
  inputSetText: vi.fn(),
  workTaskStartProps: [] as Array<Record<string, unknown>>,
  followupPreviewProps: [] as Array<Record<string, unknown>>,
  followupPreviewMountStates: [] as boolean[],
}));

function expectedTelemetrySendOptions() {
  return expect.objectContaining({
    telemetrySeed: {
      sendTime: expect.any(Number),
      extraDetail: {
        ask_mode: "",
        model_name: "",
        model_provider: "glm",
        agent: "glm",
        plan_status: "unknown",
        plan_product_id: "",
        message_source: "chat",
        task_trigger: "",
      },
    },
  });
}

vi.mock("@/v4/composer/WorkTaskStartDialog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/v4/composer/WorkTaskStartDialog.js")>();
  return {
    ...actual,
    WorkTaskStartDialog: (props: Record<string, unknown>) => {
      workTaskStartProps.push(props);
      return null;
    },
  };
});
vi.mock("@/v4/composer/FollowupPreview.js", async () => {
  const React = await import("react");
  return {
    FollowupPreview: (props: Record<string, unknown>) => {
      followupPreviewProps.push(props);
      React.useEffect(() => {
        followupPreviewMountStates.push(true);
        return () => {
          followupPreviewMountStates.push(false);
        };
      }, []);
      return null;
    },
  };
});

vi.mock("@/components/ui/dialog.js", async () => {
  const React = await import("react");
  const Passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    Dialog: ({ children, open }: { children?: ReactNode; open?: boolean }) => {
      dialogOpenStates.push(Boolean(open));
      return open ? React.createElement(React.Fragment, null, children) : null;
    },
    DialogClose: Passthrough,
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
  };
});

vi.mock("@/ControlHintTooltip.js", async () => {
  const React = await import("react");
  return {
    ControlHintTooltip: ({ children }: { children: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("@/prompt-editor/ChatPromptEditor.js", async () => {
  const React = await import("react");
  return {
    ChatPromptEditor: (props: Record<string, unknown>) => {
      chatPromptEditorProps.push(props);
      const inputApiRef = props.inputApiRef as
        | { current: Record<string, unknown> | null }
        | undefined;
      if (inputApiRef) {
        inputApiRef.current = {
          clear: inputClear,
          focus: vi.fn(),
          getEditorState: () => null,
          getMarkdown: () => "",
          setEditorStateJson: vi.fn(),
          setText: inputSetText,
        };
      }
      return React.createElement(
        "form",
        { "data-testid": "mock-chat-prompt-editor" },
        props.topContent as ReactNode,
        props.leadingActions as ReactNode,
        props.submitControl as ReactNode,
      );
    },
  };
});

vi.mock("@/components/ai-elements/attachments.js", async () => {
  const React = await import("react");
  const Passthrough = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
  } & Record<string, unknown>) => React.createElement("div", props, children);
  const Trigger = ({ children }: { children?: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const Span = (props: Record<string, unknown>) => React.createElement("span", props);
  return {
    Attachment: Passthrough,
    AttachmentHoverCard: Passthrough,
    AttachmentHoverCardContent: Passthrough,
    AttachmentHoverCardTrigger: Trigger,
    AttachmentInfo: Span,
    AttachmentPreview: Span,
    AttachmentRemove: (props: Record<string, unknown>) => React.createElement("button", props),
    Attachments: Passthrough,
  };
});

vi.mock("@/v4/composer/useComposerAttachments.js", () => ({
  useComposerAttachments: () => ({
    attachmentError: null,
    adoptSentAttachments: attachmentState.adoptSentAttachments,
    attachmentInputRef: { current: null },
    attachments: [],
    clearAttachments: vi.fn(),
    handleAttachmentInputChange: vi.fn(),
    handleDragLeaveComposer: vi.fn(),
    handleDragOverComposer: vi.fn(),
    handleDropComposer: vi.fn(),
    handlePaste: vi.fn(),
    handleWhiteboardMentionSelected: vi.fn(),
    hasAttachments: false,
    hasUnreadyAttachments: attachmentState.hasUnreadyAttachments,
    isDraggingOverComposer: false,
    openAttachmentPicker: vi.fn(),
    prepareForSend: attachmentState.prepareForSend,
    removeAttachment: vi.fn(),
    retryAttachment: vi.fn(),
    setAttachmentError: vi.fn(),
  }),
}));

vi.mock("@/v4/composer/V4ComposerToolbar.js", async () => {
  const React = await import("react");
  return {
    V4ComposerModeSwitch: () => React.createElement("span", null, "mode"),
    V4ComposerModelControls: () => React.createElement("span", null, "model"),
  };
});

function createMinimalElement(ownerDocument: Document, tagName = "div") {
  const element = {
    addEventListener: () => {},
    appendChild: (child: Node) => {
      Object.assign(child, { parentNode: element });
      element.childNodes.push(child);
      return child;
    },
    attributes: new Map<string, string>(),
    childNodes: [] as Node[],
    getAttribute: (name: string) => element.attributes.get(name) ?? null,
    insertBefore: (child: Node, beforeChild?: Node | null) => {
      Object.assign(child, { parentNode: element });
      const beforeIndex = beforeChild ? element.childNodes.indexOf(beforeChild) : -1;
      if (beforeIndex >= 0) {
        element.childNodes.splice(beforeIndex, 0, child);
      } else {
        element.childNodes.push(child);
      }
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as Node | null,
    removeAttribute: (name: string) => {
      element.attributes.delete(name);
    },
    removeChild: (child: Node) => {
      element.childNodes = element.childNodes.filter((item) => item !== child);
      Object.assign(child, { parentNode: null });
      return child;
    },
    removeEventListener: () => {},
    setAttribute: (name: string, value: string) => {
      element.attributes.set(name, String(value));
    },
    style: {},
    tagName: tagName.toUpperCase(),
  };
  return element as unknown as Element;
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, String(value));
    }),
  } as Storage;
}

function installMinimalDom() {
  const target = new EventTarget();
  const documentMock = {
    addEventListener: () => {},
    createComment: (nodeValue: string) => ({
      nodeType: 8,
      nodeValue,
      parentNode: null,
    }),
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createElementNS: (_namespace: string, tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document & { defaultView?: unknown };
  const windowMock = {
    addEventListener: target.addEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    cancelAnimationFrame: () => {},
    clearTimeout,
    document: documentMock,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    HTMLElement: function HTMLElement() {},
    localStorage: createStorageMock(),
    matchMedia: () => ({
      addEventListener: () => {},
      addListener: () => {},
      matches: false,
      removeEventListener: () => {},
      removeListener: () => {},
    }),
    Node: function Node() {},
    removeEventListener: target.removeEventListener.bind(target),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    },
    setTimeout,
  };
  documentMock.defaultView = windowMock;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return createMinimalElement(documentMock, "div");
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function renderComposerElement(
  onSendText: (text: string, options?: unknown) => Promise<ConversationComposerSendResult | void>,
  sessionId: string | null,
  telemetryDraftConfig?: {
    mode?: string;
    model?: string;
    provider?: string;
  },
  skillCatalogSessionId?: string | null,
  createSubmissionFromComposer?: () => ComposerSubmissionConfig | null,
  composerDraft?: V4ComposerDraft,
  updateComposerContent?: (
    content: Pick<V4ComposerDraft, "text" | "editorStateJson" | "mention">,
  ) => void,
  submissionReady = true,
  extraProps: Partial<ConversationComposerProps> = {},
) {
  const scopeId = sessionId ?? V4_DRAFT_SCOPE_ROOT;
  let ownedDraft = composerDraft ??
    readV4ComposerDraft("/workspace", undefined, scopeId) ?? {
      text: "",
      updatedAt: 0,
    };
  const persistOwnedContent =
    updateComposerContent ??
    ((content: Pick<V4ComposerDraft, "text" | "editorStateJson" | "mention">) => {
      ownedDraft = { ...ownedDraft, ...content };
      persistV4ComposerDraft("/workspace", undefined, scopeId, ownedDraft);
    });
  return createElement(
    ZCodeIntlProvider,
    { initialLocale: "zh-CN" },
    createElement(ConversationComposer, {
      draftMode: sessionId === null,
      onSelectModel: vi.fn(),
      onSelectThought: vi.fn(),
      onSendText,
      createSubmissionFromComposer,
      submissionReady,
      composerDraft: ownedDraft,
      updateComposerContent: persistOwnedContent,
      replaceComposerDraft: (next) => {
        ownedDraft = { ...next, updatedAt: Date.now() };
        persistV4ComposerDraft("/workspace", undefined, scopeId, ownedDraft);
      },
      onStop: vi.fn(),
      onSwitchMode: vi.fn(),
      provider: undefined,
      sessionId,
      skillCatalogSessionId,
      snapshot: null,
      telemetryDraftConfig,
      workspacePath: "/workspace",
      ...extraProps,
    }),
  );
}

function renderComposer(
  onSendText: (text: string, options?: unknown) => Promise<ConversationComposerSendResult | void>,
  telemetryDraftConfig?: {
    mode?: string;
    model?: string;
    provider?: string;
  },
) {
  const container = installMinimalDom();
  const root: Root = createRoot(container);
  act(() => {
    root.render(renderComposerElement(onSendText, null, telemetryDraftConfig));
  });
  return {
    rerenderSession: (sessionId: string) => {
      act(() => root.render(renderComposerElement(onSendText, sessionId)));
    },
    root,
    container,
  };
}

function getComposerEventProps(container: Element): Record<string, (...args: unknown[]) => void> {
  const rootElement = container.childNodes[0] as unknown as Record<string, unknown>;
  const key = Object.keys(rootElement).find((name) => name.startsWith("__reactProps$"));
  if (!key) throw new Error("Composer DOM event props not found");
  return rootElement[key] as Record<string, (...args: unknown[]) => void>;
}

afterEach(() => {
  chatPromptEditorProps.length = 0;
  attachmentState.hasUnreadyAttachments = false;
  attachmentState.adoptSentAttachments.mockClear();
  attachmentState.prepareForSend.mockClear();
  attachmentState.prepareForSend.mockResolvedValue([]);
  inputClear.mockClear();
  inputSetText.mockClear();
  vi.unstubAllGlobals();
  dialogOpenStates.length = 0;
  workTaskStartProps.length = 0;
  followupPreviewProps.length = 0;
  followupPreviewMountStates.length = 0;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
});

describe("ConversationComposer prompt history", () => {
  it("B04 actual Composer blur/pagehide/unmount never submits an unchanged old editor snapshot", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const old = {
      text: "OLD OWNER",
      editorStateJson: "old JSON",
      mode: "build" as const,
      updatedAt: 1,
    };
    persistV4ComposerDraft("/workspace", undefined, "same", old);
    const update = vi.fn((content: Pick<V4ComposerDraft, "text" | "editorStateJson" | "mention">) =>
      persistV4ComposerDraft("/workspace", undefined, "same", { ...old, ...content }),
    );
    await act(async () =>
      root.render(
        renderComposerElement(
          vi.fn(async () => {}),
          "same",
          undefined,
          undefined,
          undefined,
          old,
          update,
        ),
      ),
    );
    const latest = {
      ...old,
      text: "A NEW SAVED",
      mode: "edit" as const,
      planEnabled: true,
      taskStart: { outcome: "NEW", deliverable: "Word", constraints: "KEEP" },
    };
    persistV4ComposerDraft("/workspace", undefined, "same", latest);
    const before = readV4ComposerDraft("/workspace", undefined, "same");
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("pagehide"));
      root.unmount();
    });
    expect(update).not.toHaveBeenCalled();
    expect(readV4ComposerDraft("/workspace", undefined, "same")).toEqual(before);
  });

  it("B04 same-text rich document changes save complete JSON immediately", async () => {
    const { root } = renderComposer(vi.fn(async () => {}));
    const change = chatPromptEditorProps.at(-1)!.onChange as (text: string, json?: string) => void;
    await act(async () => change("mention", "JSON WITH NODE A"));
    expect(readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)).toMatchObject({
      text: "mention",
      editorStateJson: "JSON WITH NODE A",
    });
    await act(async () => change("mention", "JSON WITH NODE B"));
    expect(readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)).toMatchObject({
      text: "mention",
      editorStateJson: "JSON WITH NODE B",
    });
    await act(async () => root.unmount());
  });

  it("B04 external draft restore uses the dedicated tag and never suppresses a later genuine old-text edit", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const update = vi.fn();
    const render = (text: string, revision: number) =>
      root.render(
        renderComposerElement(
          vi.fn(async () => {}),
          "same",
          undefined,
          undefined,
          undefined,
          { text, editorStateJson: text + " JSON", mode: "build", updatedAt: revision },
          update,
          true,
          { composerDraftRestoreRevision: revision },
        ),
      );
    await act(async () => render("OLD", 0));
    await act(async () => render("LATEST", 1));
    const api = (
      chatPromptEditorProps.at(-1)!.inputApiRef as {
        current: { setEditorStateJson: ReturnType<typeof vi.fn> };
      }
    ).current;
    expect(api.setEditorStateJson).toHaveBeenCalledWith("LATEST JSON", { restoreDraft: true });
    expect(update).not.toHaveBeenCalled();
    const change = chatPromptEditorProps.at(-1)!.onChange as (text: string, json?: string) => void;
    await act(async () => change("OLD", "OLD JSON"));
    expect(update).toHaveBeenCalledExactlyOnceWith({ text: "OLD", editorStateJson: "OLD JSON" });
    await act(async () => root.unmount());
  });

  it.each(["scope change", "external content"])(
    "B04 pending user update flushed before %s invalidates the old restore",
    async (kind) => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const container = installMinimalDom();
      const root = createRoot(container);
      const render = (sessionId: string, text: string, revision: number) =>
        root.render(
          renderComposerElement(
            vi.fn(async () => {}),
            sessionId,
            undefined,
            undefined,
            undefined,
            { text, mode: "build", updatedAt: 0 },
            undefined,
            true,
            { composerDraftRestoreRevision: revision },
          ),
        );
      await act(async () => render("a", "INITIAL", 0));
      await act(async () => {
        for (const frame of frames.splice(0)) frame(0);
      });
      inputSetText.mockClear();
      const targetScope = kind === "scope change" ? "b" : "a";
      await act(async () => render(targetScope, "OLD SNAPSHOT", kind === "scope change" ? 0 : 1));
      const editorProps = chatPromptEditorProps.at(-1)!;
      const change = editorProps.onChange as (text: string, json?: string) => void;
      const api = (editorProps.inputApiRef as { current: { flushPendingChanges?: () => void } })
        .current;
      api.flushPendingChanges = vi.fn(() => change("PENDING USER INPUT", "PENDING JSON"));
      await act(async () => {
        for (const frame of frames.splice(0)) frame(0);
      });
      expect(api.flushPendingChanges).toHaveBeenCalledOnce();
      expect(inputSetText).not.toHaveBeenCalled();
      expect(readV4ComposerDraft("/workspace", undefined, targetScope)).toMatchObject({
        text: "PENDING USER INPUT",
        editorStateJson: "PENDING JSON",
      });
      await act(async () => root.unmount());
    },
  );

  it.each(["用户新输入", "粘贴的新正文", "输入法已开始的正文"])(
    "延迟恢复不能覆盖%s",
    async (freshText) => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const { root } = renderComposer(vi.fn(async () => {}));
      const onChange = chatPromptEditorProps.at(-1)!.onChange as (value: string) => void;
      await act(async () => onChange(freshText));
      await act(async () => {
        for (const frame of frames.splice(0)) frame(0);
      });
      expect(inputSetText).not.toHaveBeenCalled();
      expect(chatPromptEditorProps.at(-1)?.onChange).toBeDefined();
      await act(async () => root.unmount());
    },
  );

  it("Work 首发只有显式确认才进入原提交链，双确认只发送一次", async () => {
    const root = createRoot(installMinimalDom());
    const onSendText = vi.fn(async () => {});
    const taskStart = { outcome: "可复核", deliverable: "Word", constraints: "保留原件" };
    act(() =>
      root.render(
        renderComposerElement(
          onSendText,
          null,
          undefined,
          null,
          undefined,
          { text: "原始目标", taskStart, updatedAt: 0 },
          undefined,
          true,
          { workMode: true },
        ),
      ),
    );
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("原始目标");
    });
    expect(workTaskStartProps.at(-1)).toMatchObject({
      open: true,
      goal: "原始目标",
      fields: taskStart,
    });
    expect(onSendText).not.toHaveBeenCalled();
    expect(attachmentState.prepareForSend).not.toHaveBeenCalled();
    const confirm = workTaskStartProps.at(-1)!.onConfirm as () => void;
    await act(async () => {
      confirm();
      confirm();
      await flushAsyncWork();
    });
    expect(onSendText).toHaveBeenCalledTimes(1);
    expect(onSendText.mock.calls[0]![0]).toBe(
      "原始目标\n\nExpected outcome: 可复核\nDeliverable: Word\nConstraints: 保留原件",
    );
    expect(
      readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)?.taskStart,
    ).toBeUndefined();
    await act(async () => root.unmount());
  });

  it("Work 取消保留草稿及补充项，改变分类后旧确认失效", async () => {
    const root = createRoot(installMinimalDom());
    const onSendText = vi.fn(async () => {});
    const draft = {
      text: "目标",
      taskStart: { outcome: "结果", deliverable: "", constraints: "" },
      updatedAt: 0,
    };
    const render = (workMode: boolean) =>
      root.render(
        renderComposerElement(
          onSendText,
          null,
          undefined,
          null,
          undefined,
          draft,
          undefined,
          true,
          { workMode },
        ),
      );
    act(() => render(true));
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("目标");
    });
    await act(async () => {
      (workTaskStartProps.at(-1)!.onCancel as () => void)();
    });
    expect(onSendText).not.toHaveBeenCalled();
    expect(inputClear).not.toHaveBeenCalled();
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("目标");
    });
    const staleConfirm = workTaskStartProps.at(-1)!.onConfirm as () => void;
    act(() => render(false));
    await act(async () => {
      staleConfirm();
      await flushAsyncWork();
    });
    expect(onSendText).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("后续建议沿已有替换路径填空草稿，不自动发送，期间新输入取消接受", async () => {
    const root = createRoot(installMinimalDom());
    const onSendText = vi.fn(async () => {});
    const suggestion = { label: "检查", prompt: "请检查结果" };
    act(() =>
      root.render(
        renderComposerElement(
          onSendText,
          "session",
          undefined,
          null,
          undefined,
          undefined,
          undefined,
          true,
          { followupSuggestions: [suggestion] },
        ),
      ),
    );
    let preview = followupPreviewProps.at(-1)!;
    await act(async () => {
      (preview.onPrepareAccept as () => void)();
      (preview.onAccept as (value: typeof suggestion) => void)(suggestion);
    });
    expect(inputSetText).toHaveBeenCalledWith(suggestion.prompt);
    expect(onSendText).not.toHaveBeenCalled();
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onChange as (text: string) => void)("");
    });
    inputSetText.mockClear();
    preview = followupPreviewProps.at(-1)!;
    (preview.onPrepareAccept as () => void)();
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onChange as (text: string) => void)("新的草稿");
    });
    await act(async () => {
      (preview.onAccept as (value: typeof suggestion) => void)(suggestion);
    });
    expect(inputSetText).not.toHaveBeenCalled();
    expect(followupPreviewProps.at(-1)?.canAccept).toBe(false);
    await act(async () => root.unmount());
  });

  it.each(["onCompositionStartCapture", "onBeforeInputCapture", "onPasteCapture"])(
    "%s 在 Lexical 变更回报前使旧恢复失效",
    async (eventName) => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const { root, container } = renderComposer(vi.fn(async () => {}));
      getComposerEventProps(container)[eventName]!({ target: { isContentEditable: true } });
      await act(async () => {
        for (const frame of frames.splice(0)) frame(0);
      });
      expect(inputSetText).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    },
  );

  it("启动补充字段的输入不会被当作正文编辑使确认失效", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const onSendText = vi.fn(async () => {});
    act(() =>
      root.render(
        renderComposerElement(
          onSendText,
          null,
          undefined,
          null,
          undefined,
          { text: "目标", updatedAt: 0 },
          undefined,
          true,
          { workMode: true },
        ),
      ),
    );
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("目标");
    });
    getComposerEventProps(container).onBeforeInputCapture!({
      target: { isContentEditable: false },
    });
    await act(async () => {
      (workTaskStartProps.at(-1)!.onConfirm as () => void)();
      await flushAsyncWork();
    });
    expect(onSendText).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("外部预填在延迟恢复前应用后，不会被旧草稿回填覆盖", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const root = createRoot(installMinimalDom());
    act(() =>
      root.render(
        renderComposerElement(
          vi.fn(async () => {}),
          null,
          undefined,
          null,
          undefined,
          { text: "旧草稿", updatedAt: 0 },
          undefined,
          true,
          { externalTextInsertRequest: { requestId: 101, text: "新的外部预填" } },
        ),
      ),
    );
    await act(async () => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(inputSetText.mock.calls.map((call) => call[0])).toEqual(["新的外部预填"]);
    await act(async () => root.unmount());
  });

  it.each([
    { sessionId: "existing", workMode: true, enabled: true },
    { sessionId: null, workMode: false, enabled: true },
    { sessionId: null, workMode: true, enabled: false },
  ])("已有会话、Chat 或关闭确认时直接沿原发送入口 %#", async ({ sessionId, workMode, enabled }) => {
    const root = createRoot(installMinimalDom());
    const onSendText = vi.fn(async () => {});
    act(() =>
      root.render(
        renderComposerElement(
          onSendText,
          sessionId,
          undefined,
          null,
          undefined,
          undefined,
          undefined,
          true,
          { workMode, workTaskStartConfirmationEnabled: enabled },
        ),
      ),
    );
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("正文");
      await flushAsyncWork();
    });
    expect(onSendText).toHaveBeenCalledTimes(1);
    expect(workTaskStartProps.some((props) => props.open)).toBe(false);
    await act(async () => root.unmount());
  });

  it("Tab 只在聚焦可编辑空输入接受建议，IME和菜单保留按键", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const suggestion = { label: "检查", prompt: "检查结果" };
    act(() =>
      root.render(
        renderComposerElement(
          vi.fn(async () => {}),
          "session",
          undefined,
          null,
          undefined,
          undefined,
          undefined,
          true,
          { followupSuggestions: [suggestion] },
        ),
      ),
    );
    const target = { isContentEditable: true };
    Object.assign(document, { activeElement: target, querySelector: () => null });
    const event = {
      key: "Tab",
      defaultPrevented: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      nativeEvent: { isComposing: false, keyCode: 9 },
      target,
      preventDefault: vi.fn(),
    };
    const props = getComposerEventProps(container);
    inputSetText.mockClear();
    props.onCompositionStartCapture!({ target });
    props.onKeyDown!(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    props.onCompositionEndCapture!({ target });
    Object.assign(document, { querySelector: () => ({}) });
    props.onKeyDown!(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    Object.assign(document, { querySelector: () => null, activeElement: {} });
    props.onKeyDown!(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    Object.assign(document, { activeElement: target });
    await act(async () => props.onKeyDown!(event));
    expect(inputSetText).toHaveBeenCalledWith(suggestion.prompt);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });

  it("关闭后续提示词时不挂载预览，Tab 不拦截也不填入草稿", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const onSendText = vi.fn(async () => {});
    const suggestion = { label: "检查", prompt: "检查结果" };
    act(() =>
      root.render(
        renderComposerElement(
          onSendText,
          "session",
          undefined,
          null,
          undefined,
          undefined,
          undefined,
          true,
          { followupSuggestions: [suggestion], followupSuggestionsEnabled: false },
        ),
      ),
    );
    expect(followupPreviewProps).toHaveLength(0);
    const target = { isContentEditable: true };
    Object.assign(document, { activeElement: target, querySelector: () => null });
    const event = {
      key: "Tab",
      defaultPrevented: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      nativeEvent: { isComposing: false, keyCode: 9 },
      target,
      preventDefault: vi.fn(),
    };
    inputSetText.mockClear();
    await act(async () => getComposerEventProps(container).onKeyDown!(event));
    expect(inputSetText).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onSendText).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("后续提示词开启、关闭再开启只改变预览和接受入口，不自动发送", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const onSendText = vi.fn(async () => {});
    const updateComposerContent = vi.fn();
    const replaceComposerDraft = vi.fn();
    const suggestion = { label: "检查", prompt: "检查结果" };
    const render = (enabled: boolean) =>
      root.render(
        renderComposerElement(
          onSendText,
          "session",
          undefined,
          null,
          undefined,
          undefined,
          updateComposerContent,
          true,
          {
            followupSuggestions: [suggestion],
            followupSuggestionsEnabled: enabled,
            replaceComposerDraft,
          },
        ),
      );
    act(() => render(true));
    expect(followupPreviewMountStates).toEqual([true]);
    const previewCountBeforeDisable = followupPreviewProps.length;
    const draftRevisionBeforeDisable = getComposerDraftRevision("/workspace");
    act(() => render(false));
    expect(followupPreviewMountStates).toEqual([true, false]);
    expect(followupPreviewProps).toHaveLength(previewCountBeforeDisable);
    expect(getComposerDraftRevision("/workspace")).toBe(draftRevisionBeforeDisable);
    const target = { isContentEditable: true };
    Object.assign(document, { activeElement: target, querySelector: () => null });
    const event = {
      key: "Tab",
      defaultPrevented: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      nativeEvent: { isComposing: false, keyCode: 9 },
      target,
      preventDefault: vi.fn(),
    };
    inputSetText.mockClear();
    updateComposerContent.mockClear();
    await act(async () => getComposerEventProps(container).onKeyDown!(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(inputSetText).not.toHaveBeenCalled();
    expect(updateComposerContent).not.toHaveBeenCalled();
    expect(onSendText).not.toHaveBeenCalled();
    act(() => render(true));
    expect(followupPreviewMountStates).toEqual([true, false, true]);
    expect(getComposerDraftRevision("/workspace")).toBe(draftRevisionBeforeDisable);
    const currentPreview = followupPreviewProps.at(-1)!;
    await act(async () => {
      (currentPreview.onPrepareAccept as () => void)();
      (currentPreview.onAccept as (value: typeof suggestion) => void)(suggestion);
    });
    expect(inputSetText).toHaveBeenCalledExactlyOnceWith(suggestion.prompt);
    expect(updateComposerContent).toHaveBeenCalledExactlyOnceWith({ text: suggestion.prompt });
    expect(onSendText).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(followupPreviewMountStates).toEqual([true, false, true, false]);
  });

  it("首发失败后同一意图显式重试复用启动确认，新正文使确认失效", async () => {
    const root = createRoot(installMinimalDom());
    const onSendText = vi.fn(async () => {
      throw new Error("ACK timeout");
    });
    act(() =>
      root.render(
        renderComposerElement(
          onSendText,
          null,
          undefined,
          null,
          undefined,
          { text: "目标", updatedAt: 0 },
          undefined,
          true,
          { workMode: true },
        ),
      ),
    );
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("目标");
    });
    await act(async () => {
      (workTaskStartProps.at(-1)!.onConfirm as () => void)();
      await flushAsyncWork();
    });
    expect(onSendText).toHaveBeenCalledTimes(1);
    const openCount = workTaskStartProps.filter((props) => props.open).length;
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("目标");
      await flushAsyncWork();
    });
    expect(onSendText).toHaveBeenCalledTimes(2);
    expect(workTaskStartProps.filter((props) => props.open)).toHaveLength(openCount);
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onChange as (text: string) => void)("修改后的目标");
    });
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("修改后的目标");
    });
    expect(onSendText).toHaveBeenCalledTimes(2);
    expect(workTaskStartProps.at(-1)?.open).toBe(true);
    await act(async () => root.unmount());
  });

  it("真实编辑器文本变更会推进草稿 revision，保护迟到的推荐 Prompt", async () => {
    const { root } = renderComposer(vi.fn(async () => {}));
    const revisionBefore = getComposerDraftRevision("/workspace");
    const onChange = chatPromptEditorProps.at(-1)?.onChange;

    await act(async () => {
      (onChange as (value: string) => void)("用户正在输入");
    });

    expect(getComposerDraftRevision("/workspace")).toBe(revisionBefore + 1);
    await act(async () => root.unmount());
  });

  it("草稿预热 Session 只作为 Skill catalog authority 传给输入区", async () => {
    const container = installMinimalDom();
    const root: Root = createRoot(container);
    act(() => {
      root.render(
        renderComposerElement(
          vi.fn(async () => {}),
          null,
          undefined,
          "prewarm-a",
        ),
      );
    });

    expect(chatPromptEditorProps.at(-1)).toMatchObject({
      taskId: null,
      skillCatalogSessionId: "prewarm-a",
    });
    await act(async () => root.unmount());
  });

  it("prewarm snapshot 未到时仍用冻结草稿 config 建立 send telemetry seed", async () => {
    const onSendText = vi.fn(async () => {});
    const { root } = renderComposer(onSendText, {
      mode: "build",
      model: "deepseek-v4-flash",
      provider: "e2e-deepseek",
    });
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (submit as (value: string) => boolean)("立即发送草稿");
      await flushAsyncWork();
    });

    expect(onSendText).toHaveBeenCalledWith(
      "立即发送草稿",
      expect.objectContaining({
        telemetrySeed: expect.objectContaining({
          extraDetail: expect.objectContaining({
            ask_mode: "build",
            model_name: "custom:e2e-deepseek:deepseek-v4-flash",
            model_provider: "e2e-deepseek",
          }),
        }),
      }),
    );

    await act(async () => root.unmount());
  });

  it("存在非 ready 附件时 submit 不发送，也不调用最终附件提交入口", async () => {
    attachmentState.hasUnreadyAttachments = true;
    const onSendText = vi.fn(async () => {});
    const { root } = renderComposer(onSendText);
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (submit as (value: string) => boolean)("不能提前发送");
      await flushAsyncWork();
    });

    expect(attachmentState.prepareForSend).not.toHaveBeenCalled();
    expect(attachmentState.adoptSentAttachments).not.toHaveBeenCalled();
    expect(onSendText).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("等待附件就绪期间切换模型，本次请求仍使用点击发送时的选择", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const onSendText = vi.fn(async () => {});
    let composer: ComposerSubmissionConfig = {
      mode: "build",
      modelSelection: {
        providerId: "provider-a",
        modelId: "shared-model",
        options: { reasoningLevel: "high" },
      },
    };
    const readSubmission = vi.fn(() => structuredClone(composer));
    let finishAttachments!: (value: []) => void;
    attachmentState.prepareForSend.mockImplementationOnce(
      () =>
        new Promise<[]>((resolve) => {
          finishAttachments = resolve;
        }),
    );
    act(() =>
      root.render(renderComposerElement(onSendText, null, undefined, null, readSubmission)),
    );
    const submit = chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean;
    await act(async () => {
      submit("冻结本次选择");
      await flushAsyncWork();
    });
    expect(readSubmission).toHaveBeenCalledTimes(1);
    expect(onSendText).not.toHaveBeenCalled();
    composer = {
      mode: "yolo",
      modelSelection: {
        providerId: "provider-b",
        modelId: "shared-model",
        options: { reasoningLevel: "low" },
      },
    };
    await act(async () => {
      finishAttachments([]);
      await flushAsyncWork();
    });
    expect(readSubmission).toHaveBeenCalledTimes(1);
    expect(onSendText).toHaveBeenCalledWith(
      "冻结本次选择",
      expect.objectContaining({
        submission: {
          mode: "build",
          modelSelection: {
            providerId: "provider-a",
            modelId: "shared-model",
            options: { reasoningLevel: "high" },
          },
        },
      }),
    );
    await act(async () => root.unmount());
  });

  it("模型或 reasoning 选择不完整时禁止提交并保留正文", async () => {
    const onSendText = vi.fn(async () => {});
    const container = installMinimalDom();
    const root = createRoot(container);
    act(() =>
      root.render(
        renderComposerElement(
          onSendText,
          "session-a",
          undefined,
          null,
          () => null,
          undefined,
          undefined,
          false,
        ),
      ),
    );

    expect(chatPromptEditorProps.at(-1)?.submitDisabled).toBe(true);
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("等待补全选择");
      await flushAsyncWork();
    });

    expect(onSendText).not.toHaveBeenCalled();
    expect(inputClear).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("发送成功只清正文，保留当前 scope 的模式和模型选择", async () => {
    const container = installMinimalDom();
    const root = createRoot(container);
    const selection = {
      providerId: "provider-a",
      modelId: "model-a",
      options: { reasoningLevel: "high" },
    };
    let draft: V4ComposerDraft = {
      text: "会被发送",
      mode: "yolo",
      modelSelection: selection,
      updatedAt: 1,
    };
    persistV4ComposerDraft("/workspace", undefined, "session-a", draft);
    const updateContent = vi.fn(
      (content: Pick<V4ComposerDraft, "text" | "editorStateJson" | "mention">) => {
        draft = { ...draft, ...content };
        persistV4ComposerDraft("/workspace", undefined, "session-a", draft);
      },
    );
    act(() =>
      root.render(
        renderComposerElement(
          vi.fn(async () => {}),
          "session-a",
          undefined,
          null,
          () => ({ mode: "yolo", modelSelection: selection }),
          draft,
          updateContent,
        ),
      ),
    );
    await act(async () => {
      (chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean)("会被发送");
      await flushAsyncWork();
    });
    expect(readV4ComposerDraft("/workspace", undefined, "session-a")).toMatchObject({
      text: "",
      mode: "yolo",
      modelSelection: selection,
    });
    await act(async () => root.unmount());
  });

  it("迟到的发送成功不能清除等待期间产生的新正文", async () => {
    let resolveSend!: () => void;
    const onSendText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { root } = renderComposer(onSendText);
    const submit = chatPromptEditorProps.at(-1)!.onSubmit as (text: string) => boolean;
    const onChange = chatPromptEditorProps.at(-1)!.onChange as (text: string) => void;
    inputClear.mockClear();
    inputSetText.mockClear();
    vi.unstubAllGlobals();
    await act(async () => {
      submit("第一条");
      await flushAsyncWork();
    });
    await act(async () => onChange("下一条"));
    await act(async () => {
      resolveSend();
      await flushAsyncWork();
    });
    expect(inputClear).not.toHaveBeenCalled();
    expect(readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)?.text).toBe("下一条");
    await act(async () => root.unmount());
  });

  it("二次门禁返回 null 时保留编辑器且不发送", async () => {
    attachmentState.prepareForSend.mockResolvedValueOnce(null);
    const onSendText = vi.fn(async () => {});
    const { root } = renderComposer(onSendText);
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (submit as (value: string) => boolean)("提交边界再次检查");
      await flushAsyncWork();
    });

    expect(attachmentState.prepareForSend).toHaveBeenCalledTimes(1);
    expect(attachmentState.adoptSentAttachments).not.toHaveBeenCalled();
    expect(onSendText).not.toHaveBeenCalled();
    expect(inputClear).not.toHaveBeenCalled();
    expect(readPromptHistoryEntries("/workspace")).toEqual([]);

    await act(async () => root.unmount());
  });

  it("writes submitted text to localStorage before an accepted send can promote away the draft composer", async () => {
    let resolveSend: (() => void) | undefined;
    const onSendText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { root } = renderComposer(onSendText);
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    expect(typeof submit).toBe("function");

    await act(async () => {
      (submit as (value: string) => boolean)("你回答 1");
      await flushAsyncWork();
    });

    expect(onSendText).toHaveBeenCalledWith("你回答 1", expectedTelemetrySendOptions());
    expect(readPromptHistoryEntries("/workspace")).toEqual(["你回答 1"]);

    await act(async () => {
      root.unmount();
      resolveSend?.();
      await flushAsyncWork();
    });
  });

  it("restores the previous localStorage prompt history when send fails", async () => {
    const onSendText = vi.fn(async () => {
      throw new Error("send failed");
    });
    const { root } = renderComposer(onSendText);
    persistPromptHistoryEntries("/workspace", ["上一条"]);
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    expect(typeof submit).toBe("function");

    await act(async () => {
      (submit as (value: string) => boolean)("失败的消息");
      await flushAsyncWork();
    });

    expect(onSendText).toHaveBeenCalledWith("失败的消息", expectedTelemetrySendOptions());
    expect(readPromptHistoryEntries("/workspace")).toEqual(["上一条"]);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the editor draft and prompt history untouched when a product guard blocks send", async () => {
    const onSendText = vi.fn(async () => "blocked" as const);
    const { root } = renderComposer(onSendText);
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (submit as (value: string) => boolean)("/goal 保留这段输入");
      await flushAsyncWork();
    });

    expect(onSendText).toHaveBeenCalledWith("/goal 保留这段输入", expectedTelemetrySendOptions());
    expect(inputClear).not.toHaveBeenCalled();
    expect(attachmentState.adoptSentAttachments).not.toHaveBeenCalled();
    expect(readPromptHistoryEntries("/workspace")).toEqual([]);
    expect(readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)?.text).toBe(
      "/goal 保留这段输入",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("opens paused-queue confirmation without adopting the draft or prompt history", async () => {
    const onSendText = vi.fn(async () => "confirmationRequired" as const);
    const { root } = renderComposer(onSendText);
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (submit as (value: string) => boolean)("等待确认的消息");
      await flushAsyncWork();
    });

    expect(dialogOpenStates.at(-1)).toBe(true);
    expect(inputClear).not.toHaveBeenCalled();
    expect(attachmentState.adoptSentAttachments).not.toHaveBeenCalled();
    expect(readPromptHistoryEntries("/workspace")).toEqual([]);
    expect(readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)?.text).toBe(
      "等待确认的消息",
    );

    await act(async () => root.unmount());
  });

  it("does not persist a consecutive duplicate after trimming outer whitespace", async () => {
    const onSendText = vi.fn(async () => {});
    const { root } = renderComposer(onSendText);
    const firstSubmit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (firstSubmit as (value: string) => boolean)("重复消息");
      await flushAsyncWork();
    });

    const setItem = vi.mocked(window.localStorage.setItem);
    setItem.mockClear();
    const duplicateSubmit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (duplicateSubmit as (value: string) => boolean)("  重复消息  ");
      await flushAsyncWork();
    });

    expect(onSendText).toHaveBeenNthCalledWith(2, "重复消息", expectedTelemetrySendOptions());
    expect(readPromptHistoryEntries("/workspace")).toEqual(["重复消息"]);
    expect(setItem).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("does not write or roll back history when a consecutive duplicate send fails", async () => {
    const onSendText = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("send failed"));
    const { root } = renderComposer(onSendText);
    const firstSubmit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (firstSubmit as (value: string) => boolean)("重复消息");
      await flushAsyncWork();
    });

    const setItem = vi.mocked(window.localStorage.setItem);
    setItem.mockClear();
    const duplicateSubmit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (duplicateSubmit as (value: string) => boolean)("重复消息");
      await flushAsyncWork();
    });

    expect(readPromptHistoryEntries("/workspace")).toEqual(["重复消息"]);
    expect(setItem).not.toHaveBeenCalledWith(
      getPromptHistoryStorageKey("/workspace"),
      expect.any(String),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not restore the submitted draft while the composer is promoted to a session", async () => {
    let resolveSend: (() => void) | undefined;
    const onSendText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { rerenderSession, root } = renderComposer(onSendText);
    const submit = chatPromptEditorProps.at(-1)?.onSubmit;

    await act(async () => {
      (submit as (value: string) => boolean)("首条消息");
      await flushAsyncWork();
    });

    rerenderSession("session-1");
    expect(readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)).toBeNull();

    await act(async () => {
      resolveSend?.();
      await flushAsyncWork();
    });

    expect(readV4ComposerDraft("/workspace", undefined, V4_DRAFT_SCOPE_ROOT)).toBeNull();

    await act(async () => {
      root.unmount();
    });
  });
});
