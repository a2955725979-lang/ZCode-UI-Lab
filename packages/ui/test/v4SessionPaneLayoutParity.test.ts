// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationSnapshot,
  PendingInteraction,
  SubagentRow,
  UserInputRow,
} from "@zcode/shared/zcode-protocol-v4";
import {
  claimSessionHistoryMode,
  SESSION_HISTORY_MODE_STORAGE_PREFIX,
  getExplicitSessionHistoryMode,
  hasUnpersistedSessionHistoryMode,
} from "@/store/sessionHistoryModeStore.js";
import {
  toast,
  ToastMessageView,
  type ToastOptions,
  type ToastItem,
} from "@/components/ui/toast.js";
import type { PendingCommandEntry } from "@/v4/pendingCommandRegistry.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import type {
  OpenScopedSubagentSideTabRequest,
  OpenScopedWorkflowRunSideTabRequest,
} from "@/lib/workspaceSidePane.js";
import {
  CONVERSATION_CONTENT_WITHOUT_STATUS_PANEL_WIDTH_CLASS_NAME,
  CONVERSATION_CONTENT_WITH_STATUS_PANEL_WIDTH_CLASS_NAME,
} from "@/v4/conversationLayout.js";

const projectionState = vi.hoisted(() => ({
  current: null as {
    status: "live";
    snapshot: ConversationSnapshot;
    subscriptionId: string;
    lastError: string | null;
    optimisticCommands: readonly [];
    loadingOlder: boolean;
  } | null,
}));

const statusPanelCapture = vi.hoisted(() => ({
  composerProps: [] as Array<Record<string, unknown>>,
  props: [] as Array<Record<string, unknown>>,
}));

const conversationTelemetryState = vi.hoisted(() => ({
  current: null as null | {
    acceptPromptSeed: ReturnType<typeof vi.fn>;
    attachForeground: ReturnType<typeof vi.fn>;
  },
}));

// Bugfix：本文件只验证 SessionPane 布局骨架，隔离闲时入口对真实 TabStore 的依赖。
vi.mock("@/v4/OffPeakNewTaskEntry.js", () => ({
  OffPeakNewTaskEntry: () => null,
}));

// 同理隔离推荐提示词容器：它通过 useWorkspaceServicesResolution 依赖 TabStoreProvider，
// 而本文件只挂 SessionPane 验证布局，不提供 Tab store。
vi.mock("@/v4/ConversationDraftSuggestedPromptsContainer.js", () => ({
  ConversationDraftSuggestedPromptsContainer: () => null,
}));

vi.mock("@/v4/telemetry/ConversationTelemetryAttachment.js", () => ({
  useScopedConversationTelemetrySupervisor: () => conversationTelemetryState.current,
  useScopedConversationTelemetryForegroundEnabled: () =>
    conversationTelemetryState.current !== null,
}));

vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => projectionState.current,
}));

const conversation = vi.hoisted(() => {
  const lease = {
    release: vi.fn(),
    store: {
      onOnlineModelTransition: vi.fn(() => () => {}),
      refreshPlans: vi.fn(async () => {}),
      settleCommand: vi.fn(),
    },
  };
  return {
    layer: { acquire: vi.fn(() => lease), queryCommands: vi.fn(async () => ({ results: [] })) },
    sendCommand: vi.fn(),
    attachmentPut: vi.fn(),
    workflowRuns: vi.fn(() => new Promise(() => {})),
  };
});
vi.mock("@/v4/V4ConversationContext.js", () => ({ useV4Conversation: () => conversation }));
const dockState = vi.hoisted(() => ({
  simpleTimeline: false,
  quotaVisible: false,
  quotaDismissed: false,
  recovery: [] as PendingCommandEntry[],
}));
vi.mock("@/v4/useV4SessionQuotaBanner.js", () => ({
  useV4SessionQuotaBanner: () => ({
    state: { visible: dockState.quotaVisible, blocksSubmit: false },
    dismissed: dockState.quotaDismissed,
    takesOverError: false,
    markShown: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/v4/usePendingCommandRecovery.js", () => ({
  usePendingCommandRecovery: () => dockState.recovery,
}));
vi.mock("@/v4/ConversationQuotaBanner.js", () => ({
  ConversationQuotaBanner: () => createElement("div", { "data-dock-banner": "quota" }),
}));
vi.mock("@/v4/PendingCommandRecoveryBanner.js", () => ({
  PendingCommandRecoveryBanner: () => createElement("div", { "data-dock-banner": "pending" }),
}));
vi.mock("@/v4/WorkspaceHookPendingBanner.js", () => ({
  WorkspaceHookPendingBanner: () => createElement("div", { "data-dock-banner": "hook" }),
}));
vi.mock("@/components/ui/toast.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui/toast.js")>()),
  toast: vi.fn(),
}));
vi.mock("@/v4/ConversationTimeline.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/v4/ConversationTimeline.js")>();
  return {
    ...actual,
    ConversationTimeline: (props: { bottomDock?: ReactNode }) =>
      dockState.simpleTimeline
        ? createElement("div", { "data-testid": "isolated-timeline" }, props.bottomDock)
        : createElement(
            actual.ConversationTimeline,
            props as Parameters<typeof actual.ConversationTimeline>[0],
          ),
  };
});

const interfaceState = vi.hoisted(() => ({ interfaceMode: "coding" as "coding" | "office" }));
vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStoreWithDefault: (
    selector: (state: typeof interfaceState) => unknown,
    fallback: unknown,
  ) => {
    try {
      return selector(interfaceState) ?? fallback;
    } catch {
      return fallback;
    }
  },
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({
    settings: { zcodeInteractionBehavior: "queue" },
    loading: false,
    error: null,
    update: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
  }),
}));

// Dock 状态验证不连接群消息广播；保留真实 SessionPane 的条件和顺序。
vi.mock("@/v4/BotGroupDeliveryAction.js", () => ({
  BotGroupDeliveryProvider: ({ children }: { children: ReactNode }) => children,
  ConnectedBotGroupDeliveryAction: () => null,
}));
const services = vi.hoisted(() => ({
  highspeedCardService: { getSnapshot: vi.fn(() => new Promise(() => {})) },
  zcodeSessionService: { updateProviderRegistry: vi.fn() },
  zcodeTaskService: { restartWorkspaceProcess: vi.fn() },
}));
vi.mock("@/hooks/useServices.js", () => ({
  useOptionalServices: () => null,
  useServices: () => services,
}));

vi.mock("@/v4/composer/useDraftConfigControl.js", () => ({
  buildDraftCreateConfigPayload: () => ({}),
  useDraftConfigControl: () => ({
    modelSelectionRead: { state: { status: "loading" }, reload: vi.fn() },
    captureAcceptedModelSelection: () => vi.fn(),
    draftConfig: {},
    draftConfigRef: { current: {} },
    resolveInitialDraftConfig: vi.fn(() => ({})),
    acceptAuthoritativeDraftModelConfig: vi.fn(),
    handleDraftSelectModel: vi.fn(),
    handleDraftSelectThought: vi.fn(),
    handleDraftSwitchMode: vi.fn(),
  }),
}));

vi.mock("@/v4/composer/useDraftSessionPrewarm.js", () => ({
  useDraftSessionPrewarm: () => ({
    binding: null,
  }),
}));

vi.mock("@/v4/ConversationComposer.js", async () => {
  const React = await import("react");
  return {
    ConversationComposer: (props: Record<string, unknown>) => {
      statusPanelCapture.composerProps.push(props);
      return React.createElement(
        "div",
        {
          "data-testid": "mock-composer",
          "data-blocking-request-id": (props.blockingRequestId as string | null) ?? "",
          "data-centered": props.centered ? "true" : "false",
          "data-draft-mode": props.draftMode ? "true" : "false",
        },
        "composer",
      );
    },
  };
});

vi.mock("@/v4/ConversationHeader.js", async () => {
  const React = await import("react");
  return {
    ConversationHeader: () => React.createElement("div", { "data-testid": "mock-header" }),
  };
});

vi.mock("@/v4/ConversationStatusPanel.js", async () => {
  const React = await import("react");
  return {
    ConversationStatusPanel: (props: Record<string, unknown>) => {
      statusPanelCapture.props.push(props);
      return React.createElement("div", { "data-testid": "mock-status" });
    },
  };
});

vi.mock("@/v4/ConversationQueuePanel.js", async () => {
  const React = await import("react");
  return {
    ConversationQueuePanel: () => React.createElement("div", { "data-testid": "mock-queue" }),
  };
});

vi.mock("@/v4/V4InteractionDialogs.js", async () => {
  const React = await import("react");
  return {
    V4InteractionDialogs: () => React.createElement("div", { "data-testid": "mock-interactions" }),
  };
});

vi.mock("@/request-security-edition/V4ProviderRuntimeHeadersController.js", async () => {
  const React = await import("react");
  return {
    V4ProviderRuntimeHeadersController: () =>
      React.createElement("div", { "data-testid": "mock-runtime-headers" }),
  };
});

vi.mock("@/v4/ConversationDraftEmptyState.js", async () => {
  const React = await import("react");
  return {
    ConversationDraftEmptyState: (props: { compactForRemoteControl?: boolean }) =>
      React.createElement("div", {
        "data-testid": "mock-draft-empty",
        "data-compact-remote": props.compactForRemoteControl ? "true" : "false",
      }),
  };
});

vi.mock("@/v4/ConversationTurnGroup.js", async () => {
  const React = await import("react");
  return {
    ConversationTurnGroup: () => React.createElement("div", { "data-testid": "mock-turn-group" }),
  };
});

function userInputRow(): UserInputRow {
  return {
    rowId: 1,
    turnId: "turn-1",
    createdAt: 1_777_777_777,
    createdAtSeq: 1,
    kind: "userInput",
    text: "hello",
    origin: "realUser",
  };
}

function subagentRow(overrides: Partial<SubagentRow> = {}): SubagentRow {
  return {
    rowId: 2,
    turnId: "turn-1",
    createdAt: 1_777_777_778,
    createdAtSeq: 2,
    kind: "subagent",
    subagentType: "Explore",
    status: "running",
    summaryText: "正在后台探索",
    backgrounded: true,
    workId: "work-agent",
    childSessionId: "child-session",
    ...overrides,
  };
}

function pendingPermissionInteraction(): PendingInteraction {
  return {
    interactionId: "perm-1",
    kind: "permission",
    anchorRowId: null,
    createdAt: 1_777_777_778,
    payload: {
      kind: "permission",
      toolCallId: "tool-call-1",
      toolName: "Bash",
      summary: "Tool has side effects and requires approval",
      detail: { command: "touch quickSort.js" },
      options: [
        { optionId: "allow_once", label: "允许", kind: "allowOnce" },
        { optionId: "allow_always", label: "始终允许", kind: "allowAlways" },
        { optionId: "deny", label: "拒绝", kind: "deny" },
      ],
    },
  };
}

function pendingStructuredUserInputInteraction(): PendingInteraction {
  return {
    interactionId: "ask-1",
    kind: "userInput",
    anchorRowId: null,
    createdAt: 1_777_777_779,
    payload: {
      kind: "userInput",
      prompt: "选择实现形式",
      freeText: false,
      toolName: "AskUserQuestion",
      toolCallId: "tool-call-ask-1",
      questions: [
        {
          question: "你想把这个番茄时钟作为什么形式存在？",
          header: "形式",
          options: [
            { value: "page", label: "独立新页面", description: "通过导航访问" },
            { value: "widget", label: "独立小工具视图", description: "可复用组件" },
          ],
        },
      ],
    },
  };
}

function makeSnapshot(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  const snapshot: ConversationSnapshot = {
    protocolVersion: 1,
    sessionId: "session-1",
    logEpoch: "epoch-1",
    seq: 1,
    revision: 1,
    control: {
      phase: "completedSuccess",
      sessionEnded: true,
      canStop: false,
      stopState: "idle",
      stopTargetKind: "unknown",
      activeWorks: [],
      lastError: null,
      apiRetry: null,
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      switchModelConfig: { allowed: true },
      setFollowupMode: { allowed: true },
      queueEdit: { allowed: true },
      sendQueuedNow: { allowed: true },
      pauseGoal: { allowed: false, reasonCode: "noGoalToPause" },
      resumeGoal: { allowed: false, reasonCode: "noGoalToResume" },
    },
    inputRouting: { mode: "startNow" },
    meta: { title: "Session", titleSource: "generated" },
    config: { provider: "", model: "", thought: "", followupMode: "queue" },
    usage: {
      contextWindow: null,
      cumulative: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
    queue: { items: [], autoDrain: true },
    pendingInteractions: [],
    pendingCommands: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    rows: { window: [userInputRow()], totalCount: 1, firstRowId: 1 },
  };
  return { ...snapshot, ...overrides };
}

function renderPane({
  compactForRemoteControl = false,
  interfaceMode = "coding",
  locale = "zh-CN",
  onOpenSubagentSession,
  onOpenWorkflowRun,
  onSummaryPanelVariantOverrideChange,
  snapshot = makeSnapshot(),
  sessionId = "session-1",
}: {
  compactForRemoteControl?: boolean;
  interfaceMode?: "coding" | "office";
  locale?: "zh-CN" | "en-US";
  onOpenSubagentSession?: (request: OpenScopedSubagentSideTabRequest) => void;
  onOpenWorkflowRun?: (request: OpenScopedWorkflowRunSideTabRequest) => void;
  onSummaryPanelVariantOverrideChange?: (variant: "panel" | "mini" | null) => void;
  snapshot?: ConversationSnapshot;
  sessionId?: string | null;
} = {}): string {
  interfaceState.interfaceMode = interfaceMode;
  statusPanelCapture.props = [];
  statusPanelCapture.composerProps = [];
  projectionState.current = {
    status: "live",
    snapshot,
    subscriptionId: "sub-1",
    lastError: null,
    optimisticCommands: [],
    loadingOlder: false,
  };

  return renderToStaticMarkup(
    createElement(
      ZCodeIntlProvider,
      { initialLocale: locale },
      createElement(SessionPane, {
        paneId: "workspace-main",
        sessionId,
        workspacePath: "/workspace",
        compactForRemoteControl,
        ...(onOpenSubagentSession ? { onOpenSubagentSession } : {}),
        ...(onOpenWorkflowRun ? { onOpenWorkflowRun } : {}),
        ...(onSummaryPanelVariantOverrideChange ? { onSummaryPanelVariantOverrideChange } : {}),
      }),
    ),
  );
}

beforeEach(() => {
  conversationTelemetryState.current = null;
  dockState.simpleTimeline = false;
  dockState.quotaVisible = false;
  dockState.quotaDismissed = false;
  dockState.recovery = [];
  vi.mocked(toast).mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SessionPane v4 chat layout parity", () => {
  it("renders the draft greeting and the composer in the shared timeline viewport", () => {
    const html = renderPane({ sessionId: null });

    expect(html).toContain('data-v4-conversation-drop-target="true"');
    expect(html).toContain('data-v4-timeline-scroll="true"');
    expect(html).toContain('data-testid="mock-draft-empty"');
    expect(html).toContain('data-v4-composer-dock="true"');
    expect(html).toMatch(
      /class="[^"]*flex[^"]*min-h-full[^"]*before:min-h-\[52px\][^"]*after:min-h-4/u,
    );
    expect(html).toMatch(/data-v4-composer-dock="true" class="[^"]*mt-3[^"]*"/u);
    expect(html).not.toContain("@media(max-height:700px)");
    const timelineSource = readFileSync(
      resolve(process.cwd(), "packages/ui/src/v4/ConversationTimeline.tsx"),
      "utf8",
    );
    expect(timelineSource).not.toContain('matchMedia("(max-height: 700px)")');
    expect(timelineSource).toMatch(
      /element\.scrollTop = responsiveCenteredEmptyLayout[\s\S]*?\? 0[\s\S]*?: element\.scrollHeight/u,
    );
    const emptyStateSource = readFileSync(
      resolve(process.cwd(), "packages/ui/src/v4/ConversationDraftEmptyState.tsx"),
      "utf8",
    );
    expect(emptyStateSource).not.toContain("100vw");
    expect(emptyStateSource).toContain("resolveGreetingFontSizePx");
    expect(emptyStateSource).toContain("new ResizeObserver");
    expect(emptyStateSource).toContain("data-v4-draft-greeting");
    expect(html).toContain('data-compact-remote="false"');
    expect(timelineSource).not.toContain("setDesktopWindowContentMinimumHeight");
    expect(timelineSource).not.toContain("draftWindowMinimumHeight");
    expect(timelineSource).not.toContain("useOptionalPlatform");
    expect(timelineSource).not.toMatch(/min-height:703px/u);
    expect(html).toContain('data-draft-mode="true"');
    expect(html).toContain('data-centered="true"');
    expect(html).not.toContain("发送第一条消息开始对话");
  });

  it("keeps the mobile remote draft on the original compact centered layout", () => {
    const html = renderPane({ sessionId: null, compactForRemoteControl: true });

    expect(html).toContain('data-compact-remote="true"');
    expect(html).toMatch(/class="[^"]*justify-center[^"]*gap-4/u);
    expect(html).not.toContain("before:min-h-[52px]");
  });

  it("scopes narrow-width shrinking to mobile remote conversations", () => {
    const desktopHtml = renderPane({ compactForRemoteControl: false });
    const mobileHtml = renderPane({ compactForRemoteControl: true });
    const readSessionPaneClassName = (html: string) =>
      html.match(/data-v4-conversation-drop-target="true"[^>]*class="([^"]*)"/u)?.[1] ?? "";
    const readTimelineClassName = (html: string) =>
      html.match(/data-v4-timeline-scroll="true"[^>]*class="([^"]*)"/u)?.[1] ?? "";

    expect(readSessionPaneClassName(mobileHtml)).toContain("min-w-0");
    expect(readTimelineClassName(mobileHtml)).toContain("min-w-0");
    expect(readSessionPaneClassName(desktopHtml)).not.toContain("min-w-0");
    expect(readTimelineClassName(desktopHtml)).not.toContain("min-w-0");
  });

  it("keeps constrained desktop draft content reachable through the timeline scroll viewport", () => {
    const timelineSource = readFileSync(
      resolve(process.cwd(), "packages/ui/src/v4/ConversationTimeline.tsx"),
      "utf8",
    );

    // 回归原因：内容可达性必须由 timeline 自身承担，不能依赖原生窗口反向扩高。
    expect(timelineSource).not.toContain('"h-full min-h-0 overflow-hidden"');
    expect(timelineSource).toMatch(/centeredEmptyLayout[\s\S]*?"flex[^"]*min-h-full[^"]*"/u);
  });

  it("keeps a bound empty session blank while preserving the bottom composer dock", () => {
    const html = renderPane({
      snapshot: makeSnapshot({
        rows: { window: [], totalCount: 0, firstRowId: null },
      }),
    });

    expect(html).toContain('data-v4-timeline-scroll="true"');
    expect(html).toContain('data-v4-composer-dock="true"');
    expect(html).toContain('data-testid="mock-composer"');
    expect(html).not.toContain("v4-timeline-empty");
    expect(html).not.toContain("发送第一条消息开始对话");
  });

  it("renders the composer inside the timeline scroll viewport with shared content width", () => {
    const html = renderPane();

    expect(html).toContain('data-v4-timeline-scroll="true"');
    expect(html).toMatch(
      /data-v4-timeline-scroll="true"[^>]*class="[^"]*overflow-x-hidden[^"]*overflow-y-auto/,
    );
    expect(html).toContain('data-v4-timeline-content-column="true"');
    expect(html).toContain('data-v4-composer-dock="true"');
    expect(html.indexOf('data-v4-timeline-scroll="true"')).toBeLessThan(
      html.indexOf('data-v4-composer-dock="true"'),
    );
    expect(html.indexOf('data-v4-composer-dock="true"')).toBeLessThan(
      html.indexOf('data-testid="mock-composer"'),
    );
    expect(html).toContain("@container/conversation");
    expect(html).toContain(CONVERSATION_CONTENT_WITHOUT_STATUS_PANEL_WIDTH_CLASS_NAME);
    expect(html).toContain(
      "transition-[width,max-width,transform] duration-150 ease-out @min-[1280px]/conversation:transition-[transform]",
    );
    expect(html).not.toContain("transition-transform duration-150 ease-out");
  });

  it("TN08：composer 只在内容列接收事件，不遮挡左侧问题导航", () => {
    const html = renderPane();

    expect(html).toMatch(/data-v4-composer-dock="true" class="[^"]*pointer-events-none/);
    expect(html).toMatch(/data-v4-composer-dock-content="true" class="[^"]*pointer-events-auto/);
  });

  it("keeps transparent composer bottom padding and masks only the message layer", () => {
    const html = renderPane();

    expect(html).toContain('data-v4-timeline-message-layer="true"');
    expect(html).toContain("px-4 pb-4");
    expect(html).not.toContain("px-4 pb-4 max-md:px-2");
    expect(html).not.toContain("max-md:pb-2");
    expect(html).not.toContain("h-4 bg-background max-md:h-2");
    expect(html).toContain("mask-repeat:no-repeat");
    const timelineSource = readFileSync(
      resolve(process.cwd(), "packages/ui/src/v4/ConversationTimeline.tsx"),
      "utf8",
    );
    expect(timelineSource).toContain("COMPOSER_MESSAGE_MASK_TRANSPARENT_HEIGHT_PX = 96");
    expect(timelineSource).toContain("COMPOSER_MESSAGE_MASK_FADE_PX = 24");
    expect(timelineSource).toContain("isAtBottom({");
    expect(timelineSource).toContain('messageLayer.style.maskImage = "none"');
    expect(timelineSource).toContain(
      "viewportHeight - COMPOSER_MESSAGE_MASK_TRANSPARENT_HEIGHT_PX",
    );
    expect(timelineSource).toContain("black ${opaqueEnd}px, transparent ${transparentStart}px");
    const maskSyncSource = timelineSource.slice(
      timelineSource.indexOf("const syncMessageLayerMask = useCallback"),
      timelineSource.indexOf("const syncTurnNavigatorViewport = useCallback"),
    );
    expect(maskSyncSource).not.toContain("getBoundingClientRect");
    expect(timelineSource).not.toContain("data-v4-composer-mask-target");
    // Bug 回归：composer 的纵向 mask 如果和正文 max-width 共用一层，会把 Markdown
    // 表格增强模式越出正文列的左右区域一起裁掉。mask 层必须全宽，正文宽度下沉到历史区和 live tail。
    expect(timelineSource).toContain(
      'className="relative w-full flex-1 [mask-repeat:no-repeat] [-webkit-mask-repeat:no-repeat]"',
    );
    expect(timelineSource).toMatch(
      /data-v4-timeline-virtual-history="true"[\s\S]*?contentWidthClassName/,
    );
    expect(timelineSource).toMatch(/data-v4-running-live-tail="true"[\s\S]*?contentWidthClassName/);
  });

  it("anchors the back-to-bottom control to the composer dock above input", () => {
    const html = renderPane();

    expect(html).toContain('data-v4-back-to-bottom-anchor="composer-dock"');
    expect(html.indexOf('data-v4-composer-dock="true"')).toBeLessThan(
      html.indexOf('data-v4-back-to-bottom-anchor="composer-dock"'),
    );
    expect(html.indexOf('data-v4-back-to-bottom-anchor="composer-dock"')).toBeLessThan(
      html.indexOf('data-testid="mock-composer"'),
    );
  });

  it("uses the z-code-2 icon-only back-to-bottom control", () => {
    const timelineSource = readFileSync(
      resolve(process.cwd(), "packages/ui/src/v4/ConversationTimeline.tsx"),
      "utf8",
    );

    expect(timelineSource).toContain('<ArrowDownIcon className="size-4" />');
    expect(timelineSource).not.toMatch(/>\s*回到底部\s*</);
    expect(timelineSource).toContain('id: "chat.scrollToBottom"');
  });

  it("renders pending permission before the composer inside the composer dock", () => {
    conversationTelemetryState.current = {
      acceptPromptSeed: vi.fn(),
      attachForeground: vi.fn(() => () => {}),
    };
    const html = renderPane({
      snapshot: makeSnapshot({
        pendingInteractions: [pendingPermissionInteraction()],
      }),
    });
    conversationTelemetryState.current = null;

    const dockIndex = html.indexOf('data-v4-composer-dock="true"');
    const interactionIndex = html.indexOf('data-testid="mock-interactions"');
    const composerIndex = html.indexOf('data-testid="mock-composer"');

    expect(dockIndex).toBeGreaterThanOrEqual(0);
    expect(interactionIndex).toBeGreaterThanOrEqual(0);
    expect(composerIndex).toBeGreaterThanOrEqual(0);
    expect(dockIndex).toBeLessThan(interactionIndex);
    expect(interactionIndex).toBeLessThan(composerIndex);
    // 2026-08-17：Start Plan runtime headers 应答方已迁出 SessionPane，改由 Root 的
    // V4WorkspaceProviderRuntimeHeadersBridge 按 workspace 常驻挂载（web 远控新建会话
    // 在桌面没有 pane 时也必须有应答方），pane 内不再渲染该控制器。
    expect(html).not.toContain('data-testid="mock-runtime-headers"');
    expect(html).toContain('data-blocking-request-id="perm-1"');
  });

  it("普通 Web 没有 desktop-continuous attachment 时不挂一次性 runtime header controller", () => {
    conversationTelemetryState.current = null;
    const html = renderPane();

    expect(html).not.toContain('data-testid="mock-runtime-headers"');
  });

  it("renders structured user input before the composer inside the composer dock", () => {
    const html = renderPane({
      snapshot: makeSnapshot({
        pendingInteractions: [pendingStructuredUserInputInteraction()],
      }),
    });

    const dockIndex = html.indexOf('data-v4-composer-dock="true"');
    const interactionIndex = html.indexOf('data-testid="mock-interactions"');
    const composerIndex = html.indexOf('data-testid="mock-composer"');

    expect(dockIndex).toBeGreaterThanOrEqual(0);
    expect(interactionIndex).toBeGreaterThanOrEqual(0);
    expect(composerIndex).toBeGreaterThanOrEqual(0);
    expect(dockIndex).toBeLessThan(interactionIndex);
    expect(interactionIndex).toBeLessThan(composerIndex);
    expect(html).toContain('data-blocking-request-id="ask-1"');
  });

  it("offsets the conversation column and composer when the status panel can sit inline", () => {
    vi.stubGlobal("window", {
      innerWidth: 1280,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    try {
      const html = renderPane({
        snapshot: makeSnapshot({
          goal: {
            targetId: "goal-inline",
            objective: "Keep status panel inline with the conversation column",
            summaryTitle: null,
            timeUsedSeconds: 0,
            activeRunStartedAtMs: null,
            status: "active",
            iteration: 1,
            verifications: [],
            iterations: [],
          },
        }),
      });

      expect(html).toContain("@min-[1280px]/conversation:-translate-x-42");
      expect(html).toContain(CONVERSATION_CONTENT_WITH_STATUS_PANEL_WIDTH_CLASS_NAME);
      expect(html).toContain('data-v4-timeline-content-column="true"');
      expect(html).toContain('data-v4-composer-dock="true"');
      expect(statusPanelCapture.props.at(-1)?.layoutMode).toBe("auto");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("wires pause/resume callbacks only from authoritative goal availability", () => {
    const active = makeSnapshot();
    active.goal = {
      targetId: "goal-controls",
      objective: "Restore goal controls",
      summaryTitle: null,
      timeUsedSeconds: 3,
      activeRunStartedAtMs: null,
      status: "active",
      iteration: 0,
      verifications: [],
      iterations: [],
    };
    active.availability = {
      ...active.availability,
      pauseGoal: { allowed: true },
      resumeGoal: { allowed: false, reasonCode: "goalNotPaused" },
    };
    renderPane({ snapshot: active });
    expect(statusPanelCapture.props.at(-1)?.onPauseGoal).toEqual(expect.any(Function));
    expect(statusPanelCapture.props.at(-1)?.onResumeGoal).toBeUndefined();

    const paused = makeSnapshot({
      goal: { ...active.goal, status: "paused" },
      availability: {
        ...active.availability,
        pauseGoal: { allowed: false, reasonCode: "goalNotActive" },
        resumeGoal: { allowed: true },
      },
    });
    renderPane({ snapshot: paused });
    expect(statusPanelCapture.props.at(-1)?.onPauseGoal).toBeUndefined();
    expect(statusPanelCapture.props.at(-1)?.onResumeGoal).toEqual(expect.any(Function));
  });

  it("keeps scoped Agent detail opening on remote compact while hiding the directory", () => {
    const onOpenSubagentSession = vi.fn();
    const row = subagentRow();
    const snapshot = makeSnapshot({
      backgroundWorks: [
        {
          workId: "work-agent",
          kind: "subagent",
          title: "分析状态面板",
          status: "running",
          startedAt: 1_777_777_778,
          anchorRowId: row.rowId,
          childSessionId: "child-session",
        },
      ],
      rows: { window: [userInputRow(), row], totalCount: 2, firstRowId: 1 },
    });

    renderPane({ snapshot, onOpenSubagentSession });
    const panelProps = statusPanelCapture.props.at(-1);
    if (!panelProps) throw new Error("Status panel props were not captured");
    expect(panelProps.parentSessionId).toBe("session-1");
    expect(panelProps.runningSubagents).toEqual([]);
    expect(panelProps.onOpenSubagentSession).toEqual(expect.any(Function));

    (
      panelProps.onOpenSubagentSession as (request: {
        rootSessionId: string;
        parentSessionId: string;
        childSessionId: string;
        subagentType: string;
        title: string;
      }) => void
    )({
      rootSessionId: "session-1",
      parentSessionId: "session-1",
      childSessionId: "child-session",
      subagentType: "Explore",
      title: "分析状态面板",
    });
    expect(onOpenSubagentSession).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      rootSessionId: "session-1",
      parentSessionId: "session-1",
      childSessionId: "child-session",
      subagentType: "Explore",
      title: "分析状态面板",
    });

    renderPane({
      compactForRemoteControl: true,
      snapshot,
      onOpenSubagentSession,
    });
    expect(statusPanelCapture.props.at(-1)?.isWebRemoteControl).toBe(true);
    expect(statusPanelCapture.props.at(-1)?.isMobileViewport).toBe(false);
    expect(statusPanelCapture.props.at(-1)?.onOpenSubagentSession).toEqual(expect.any(Function));
    expect(statusPanelCapture.props.at(-1)?.onOpenSubagentDirectory).toBeUndefined();
  });

  it("wires the Composer background entry to panel expansion and controlled Running state", () => {
    const onSummaryPanelVariantOverrideChange = vi.fn();
    const snapshot = makeSnapshot({
      backgroundWorks: [
        {
          workId: "work-bash",
          kind: "bash",
          title: "Run checks",
          status: "running",
          startedAt: 1_777_777_778,
          anchorRowId: null,
        },
      ],
    });

    renderPane({ snapshot, onSummaryPanelVariantOverrideChange });
    const composerProps = statusPanelCapture.composerProps.at(-1);
    const panelProps = statusPanelCapture.props.at(-1);
    expect(composerProps?.onOpenRunningBackgroundWorks).toEqual(expect.any(Function));
    expect(panelProps?.terminalSectionOpen).toBe(false);
    expect(panelProps?.onTerminalSectionOpenChange).toEqual(expect.any(Function));
    expect(panelProps?.agentSectionOpen).toBe(false);
    expect(panelProps?.onAgentSectionOpenChange).toEqual(expect.any(Function));

    (composerProps?.onOpenRunningBackgroundWorks as (() => void) | undefined)?.();
    expect(onSummaryPanelVariantOverrideChange).toHaveBeenCalledWith("panel");
  });

  it("keeps the Composer Agent count while the directory projection catches up", () => {
    const snapshot = makeSnapshot({
      backgroundWorks: [
        {
          workId: "work-agent",
          kind: "subagent",
          title: "后台分析",
          status: "running",
          startedAt: 1_777_777_778,
          anchorRowId: null,
          childSessionId: "child-session",
        },
      ],
      subagents: {
        revision: 2,
        childSessionIds: ["child-session"],
        running: [],
        endedTotal: 0,
      },
    });

    renderPane({ snapshot });
    const composerProps = statusPanelCapture.composerProps.at(-1);
    expect(composerProps?.runningSubagentCount).toBe(1);
    expect(composerProps?.onOpenRunningBackgroundWorks).toEqual(expect.any(Function));
  });

  // composer 徽标直达（docs/dynamic-workflow/presentation.md）：唯一在跑的工作流
  // 点徽标直接开详情 side tab，胶囊不动；其他形态照旧展开胶囊。
  describe("Composer background entry with dwf workflow runs", () => {
    const workflowWork = {
      workId: "dwfrun-1",
      kind: "workflow" as const,
      title: "发布前检查",
      status: "running" as const,
      startedAt: 1_777_777_778,
      anchorRowId: null,
    };
    const workflowRun = {
      runId: "dwfrun-1",
      toolCallId: "tool-wf-1",
      status: "running" as const,
      usage: { spentTokens: 0, nodesUsed: 0 },
      actors: [],
      nodes: [],
      lastEventSequence: 0,
    };

    it("opens the run details directly when one workflow is the only running activity", () => {
      const onSummaryPanelVariantOverrideChange = vi.fn();
      const onOpenWorkflowRun = vi.fn();
      const snapshot = makeSnapshot({
        backgroundWorks: [workflowWork],
        workflowRuns: { revision: 1, runs: [workflowRun] },
      });

      renderPane({ snapshot, onOpenWorkflowRun, onSummaryPanelVariantOverrideChange });
      const composerProps = statusPanelCapture.composerProps.at(-1);
      expect(composerProps?.backgroundWorkOpenTarget).toBe("workflow-run");

      (composerProps?.onOpenRunningBackgroundWorks as (() => void) | undefined)?.();
      expect(onOpenWorkflowRun).toHaveBeenCalledWith({
        parentSessionId: "session-1",
        runId: "dwfrun-1",
        toolCallId: "tool-wf-1",
        workflowName: "发布前检查",
        workspacePath: "/workspace",
      });
      expect(onSummaryPanelVariantOverrideChange).not.toHaveBeenCalled();
    });

    it("falls back to panel expansion when another kind runs alongside the workflow", () => {
      const onSummaryPanelVariantOverrideChange = vi.fn();
      const onOpenWorkflowRun = vi.fn();
      const snapshot = makeSnapshot({
        backgroundWorks: [
          workflowWork,
          {
            workId: "work-bash",
            kind: "bash",
            title: "Run checks",
            status: "running",
            startedAt: 1_777_777_778,
            anchorRowId: null,
          },
        ],
        workflowRuns: { revision: 1, runs: [workflowRun] },
      });

      renderPane({ snapshot, onOpenWorkflowRun, onSummaryPanelVariantOverrideChange });
      const composerProps = statusPanelCapture.composerProps.at(-1);
      expect(composerProps?.backgroundWorkOpenTarget).toBe("panel");

      (composerProps?.onOpenRunningBackgroundWorks as (() => void) | undefined)?.();
      expect(onOpenWorkflowRun).not.toHaveBeenCalled();
      expect(onSummaryPanelVariantOverrideChange).toHaveBeenCalledWith("panel");
    });

    it("falls back to panel expansion when the host cannot open run details", () => {
      const onSummaryPanelVariantOverrideChange = vi.fn();
      const snapshot = makeSnapshot({
        backgroundWorks: [workflowWork],
        workflowRuns: { revision: 1, runs: [workflowRun] },
      });

      renderPane({ snapshot, onSummaryPanelVariantOverrideChange });
      const composerProps = statusPanelCapture.composerProps.at(-1);
      expect(composerProps?.backgroundWorkOpenTarget).toBe("panel");

      (composerProps?.onOpenRunningBackgroundWorks as (() => void) | undefined)?.();
      expect(onSummaryPanelVariantOverrideChange).toHaveBeenCalledWith("panel");
    });
  });
});

describe("Chat / Work progress presentation", () => {
  it.each([
    "running",
    "prewarming",
    "completedSuccess",
    "completedInterrupted",
    "error",
    "stopping",
    "awaitingAnswer",
    "awaitingConfirmation",
    "backgroundRunning",
  ] as const)(
    "keeps %s plan feedback in the existing status panel without a duplicate dock summary",
    (scenario) => {
      const snapshot = makeSnapshot({
        plan: {
          updatedAt: 1,
          items: [
            { id: "done", content: "Inspect files", status: "completed" },
            { id: "current", content: "Check output", status: "inProgress" },
            { id: "later", content: "Deliver", status: "pending" },
          ],
        },
      });
      if (
        ["running", "prewarming", "completedSuccess", "completedInterrupted", "error"].includes(
          scenario,
        )
      ) {
        snapshot.control.phase = scenario as ConversationSnapshot["control"]["phase"];
      } else if (scenario === "stopping") {
        snapshot.control.phase = "running";
        snapshot.control.stopState = "stopping";
      } else if (scenario === "awaitingAnswer") {
        snapshot.pendingInteractions = [pendingStructuredUserInputInteraction()];
      } else if (scenario === "awaitingConfirmation") {
        snapshot.pendingInteractions = [pendingPermissionInteraction()];
      } else {
        snapshot.backgroundWorks = [
          {
            workId: "bg",
            kind: "bash",
            title: "Check",
            status: "running",
            startedAt: 1,
            anchorRowId: null,
          },
        ];
      }
      if (scenario === "running") {
        snapshot.control.canStop = true;
        snapshot.control.stopState = "stoppable";
        snapshot.control.stopTargetKind = "assistant";
      }
      if (scenario === "error")
        snapshot.control.lastError = {
          code: "fault.provider.rateLimited",
          message: "Provider rate limit exceeded.",
          recoverable: true,
          at: 1,
          source: "provider",
        };
      for (const compactForRemoteControl of [false, true]) {
        for (const interfaceMode of ["office", "coding"] as const) {
          const html = renderPane({ interfaceMode, compactForRemoteControl, snapshot });
          expect(
            html.includes('data-testid="v4-task-progress-summary"'),
            `${scenario}/${interfaceMode}/${compactForRemoteControl}`,
          ).toBe(false);
          expect(statusPanelCapture.props).toHaveLength(1);
          expect(statusPanelCapture.props[0]?.plan).toBe(snapshot.plan);
          expect(html).not.toMatch(/验收：未验证|Acceptance: unverified|verificationUnverified/);
          expect(html).toContain('data-testid="mock-composer"');
          expect(html).toContain('data-testid="mock-interactions"');
          const composer = statusPanelCapture.composerProps.at(-1)!;
          expect(composer.snapshot).toBe(snapshot);
          expect(composer.onStop).toEqual(expect.any(Function));
          if (snapshot.pendingInteractions.length) {
            expect(composer.blockingRequestId).toBe(snapshot.pendingInteractions[0]!.interactionId);
          }
          if (scenario === "error")
            expect(composer.error).toMatchObject({ message: "Provider rate limit exceeded." });
        }
      }
    },
  );

  it.each(["zh-CN", "en-US"] as const)(
    "keeps completed plan ownership in the status panel in %s without duplicate execution or verification labels",
    (locale) => {
      const snapshot = makeSnapshot({
        plan: {
          updatedAt: 1,
          items: [{ id: "done", content: "Completed step", status: "completed" }],
        },
      });
      const html = renderPane({ locale, snapshot });
      expect(statusPanelCapture.props).toHaveLength(1);
      expect(statusPanelCapture.props[0]?.plan).toBe(snapshot.plan);
      expect(statusPanelCapture.props[0]?.plan).toMatchObject({
        items: [{ id: "done", status: "completed" }],
      });
      expect(html).not.toContain('data-testid="v4-task-progress-summary"');
      expect(html).not.toMatch(
        /本次执行已结束|本轮已结束|Execution ended|Turn ended|验收|Acceptance|verification/i,
      );
    },
  );
});

function recoveryFixture(): PendingCommandEntry {
  return {
    commandId: "create-uncertain",
    clientId: "fixture-client",
    sessionId: "session-1",
    issuedAt: 1,
    expiresAt: Date.now() + 10_000,
    recovery: "creationUnknown",
    replay: { kind: "queryOnly", type: "forkAssistant" },
  };
}
function hookSnapshot(): ConversationSnapshot {
  return makeSnapshot({
    workspaceHookAdmission: { pendingCount: 1, bundleDigest: "fixture-hook-bundle" },
  });
}

describe("v2 dock priority and history persistence toast", () => {
  it.each([
    { quota: true, pending: true, hook: true, expected: "quota" },
    { quota: false, pending: true, hook: true, expected: "pending" },
    { quota: false, pending: false, hook: true, expected: "hook" },
    { quota: false, pending: false, hook: false, expected: null },
  ])(
    "renders one highest priority banner for $expected through the real SessionPane",
    ({ quota, pending, hook, expected }) => {
      dockState.quotaVisible = quota;
      dockState.recovery = pending ? [recoveryFixture()] : [];
      for (const interfaceMode of ["coding", "office"] as const) {
        for (const compactForRemoteControl of [false, true]) {
          const html = renderPane({
            snapshot: hook ? hookSnapshot() : makeSnapshot(),
            interfaceMode,
            compactForRemoteControl,
          });
          const banners = [...html.matchAll(/data-dock-banner="([^"]+)"/g)].map(
            (match) => match[1],
          );
          expect(banners).toEqual(expected ? [expected] : []);
          if (expected)
            expect(html.indexOf(`data-dock-banner="${expected}"`)).toBeLessThan(
              html.indexOf('data-testid="mock-queue"'),
            );
          expect(html.indexOf('data-testid="mock-queue"')).toBeLessThan(
            html.indexOf('data-testid="mock-interactions"'),
          );
          expect(html.indexOf('data-testid="mock-interactions"')).toBeLessThan(
            html.indexOf('data-testid="mock-composer"'),
          );
        }
      }
    },
  );

  it("lets a dismissed quota banner yield to pending creation, then yields to hook after recovery clears", () => {
    dockState.quotaVisible = true;
    dockState.quotaDismissed = true;
    dockState.recovery = [recoveryFixture()];
    const pendingHtml = renderPane({ snapshot: hookSnapshot() });
    expect(pendingHtml).toContain('data-dock-banner="pending"');
    expect(pendingHtml).not.toContain('data-dock-banner="quota"');
    expect(pendingHtml).not.toContain('data-dock-banner="hook"');
    dockState.recovery = [];
    const hookHtml = renderPane({ snapshot: hookSnapshot() });
    expect(hookHtml).toContain('data-dock-banner="hook"');
    expect(hookHtml).not.toContain('data-dock-banner="pending"');
  });

  it("keeps interaction and composer positions stable while forwarding the blocking request", () => {
    const snapshot = makeSnapshot({
      pendingInteractions: [pendingStructuredUserInputInteraction()],
    });
    const html = renderPane({ snapshot });
    const composer = statusPanelCapture.composerProps.at(-1)!;
    expect(composer.blockingRequestId).toBe("ask-1");
    expect(html.indexOf('data-testid="mock-queue"')).toBeLessThan(
      html.indexOf('data-testid="mock-interactions"'),
    );
    expect(html.indexOf('data-testid="mock-interactions"')).toBeLessThan(
      html.indexOf('data-testid="mock-composer"'),
    );
    expect(html).not.toContain('data-testid="v4-task-progress-summary"');
  });
});

let historyToastSerial = 0;
function mountHistoryPane(
  scope: { workspacePath: string; workspaceIdentity?: string },
  sessionId: string,
) {
  dockState.simpleTimeline = true;
  const element = (targetSessionId: string) => {
    projectionState.current = {
      status: "live",
      snapshot: makeSnapshot({ sessionId: targetSessionId }),
      subscriptionId: "history-toast",
      lastError: null,
      optimisticCommands: [],
      loadingOlder: false,
    };
    return createElement(
      ZCodeIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(SessionPane, { paneId: "history-toast", sessionId: targetSessionId, ...scope }),
    );
  };
  const view = render(element(sessionId));
  return {
    ...view,
    switchSession: (nextId: string) => view.rerender(element(nextId)),
    rerenderSame: () => view.rerender(element(sessionId)),
  };
}
function latestHistoryToast(): { message: string; options: ToastOptions } {
  const call = vi
    .mocked(toast)
    .mock.calls.filter(([, options]) => options?.dedupeKey?.startsWith("history-classification:"))
    .at(-1);
  expect(call).toBeDefined();
  return { message: call![0], options: call![1]! };
}
function renderHistoryToast(item: ReturnType<typeof latestHistoryToast>) {
  return render(
    createElement(ToastMessageView, {
      visible: true,
      item: {
        id: 1,
        message: item.message,
        durationMs: 3000,
        position: "top-center",
        ...item.options,
      } as ToastItem,
    }),
  );
}

describe("v2 real SessionPane history toast and Retry", () => {
  it("shows a single actionable toast instead of a dock banner and Retry persists the retained mode", () => {
    const scope = {
      workspacePath: `/history-toast-${++historyToastSerial}`,
      workspaceIdentity: `remote-${historyToastSerial}`,
    };
    const sessionId = "history-session";
    const failStorage = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw new Error("fixture storage failure");
    });
    expect(claimSessionHistoryMode(scope, sessionId, "work").persisted).toBe(false);
    const view = mountHistoryPane(scope, sessionId);
    const item = latestHistoryToast();
    expect(item.options.dedupeKey).toBe(
      `history-classification:${JSON.stringify([scope.workspaceIdentity, sessionId])}`,
    );
    expect(view.container.textContent).not.toContain(item.message);
    view.rerenderSame();
    expect(
      vi
        .mocked(toast)
        .mock.calls.filter(([, options]) => options?.dedupeKey === item.options.dedupeKey),
    ).toHaveLength(1);
    failStorage.mockRestore();
    const toastView = renderHistoryToast(item);
    fireEvent.click(toastView.getByRole("button", { name: item.options.actionLabel! }));
    expect(hasUnpersistedSessionHistoryMode(scope, sessionId)).toBe(false);
    expect(getExplicitSessionHistoryMode(scope, sessionId)).toBe("work");
    expect(item.options.actionLabel).toBe("重试");
  });

  it("retains failed Retry with the same dedupe key and retries its original scope after session navigation", () => {
    const scope = { workspacePath: `/history-toast-${++historyToastSerial}` };
    const originalSetItem = Storage.prototype.setItem;
    const failStorage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key, value) {
        if (key.startsWith(SESSION_HISTORY_MODE_STORAGE_PREFIX))
          throw new Error("fixture storage failure");
        originalSetItem.call(this, key, value);
      });
    claimSessionHistoryMode(scope, "first-session", "chat");
    const view = mountHistoryPane(scope, "first-session");
    const first = latestHistoryToast();
    act(() => first.options.onAction?.());
    const retryFailure = latestHistoryToast();
    expect(retryFailure.options.dedupeKey).toBe(first.options.dedupeKey);
    expect(hasUnpersistedSessionHistoryMode(scope, "first-session")).toBe(true);
    act(() => {
      claimSessionHistoryMode(scope, "second-session", "work");
    });
    view.switchSession("second-session");
    const second = latestHistoryToast();
    expect(second.options.dedupeKey).not.toBe(first.options.dedupeKey);
    failStorage.mockRestore();
    act(() => retryFailure.options.onAction?.());
    expect(hasUnpersistedSessionHistoryMode(scope, "first-session")).toBe(false);
    expect(getExplicitSessionHistoryMode(scope, "first-session")).toBe("chat");
    expect(hasUnpersistedSessionHistoryMode(scope, "second-session")).toBe(true);
    act(() => second.options.onAction?.());
    expect(hasUnpersistedSessionHistoryMode(scope, "second-session")).toBe(false);
  });
});
