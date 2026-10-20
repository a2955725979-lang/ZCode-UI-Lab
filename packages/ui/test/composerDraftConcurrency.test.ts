// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionConfigState } from "@zcode/shared/zcode-protocol-v4";
import {
  useDraftConfigControl,
  type DraftConfigControl,
} from "@/v4/composer/useDraftConfigControl.js";
import {
  clearV4ComposerDraft,
  getV4ComposerDraftScopeStorageKey,
  getV4ComposerDraftStorageKey,
  persistV4ComposerDraft,
  readV4ComposerDraft,
  type V4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";

vi.mock("@/hooks/useWorkspacePrepare.js", () => ({
  prepareWorkspaceWithZCodeSessionService: vi.fn(() => {
    throw new Error("Unexpected RPC");
  }),
}));
vi.mock("@/hooks/useZCodeSessionService.js", () => ({ useZCodeSessionService: () => ({}) }));
vi.mock("@/hooks/useSettingService.js", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({ connectionKind: "remote-waiting" }),
}));
vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const workspace = "/synthetic-b04";
const scope = "session";
const roots: Root[] = [];
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  localStorage.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function makeOwner(
  initialScope: string | null = scope,
  identity?: string,
  initialConfig?: Partial<SessionConfigState>,
) {
  let current: DraftConfigControl;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  function Probe({
    sessionId,
    config,
  }: {
    sessionId: string | null;
    config?: Partial<SessionConfigState>;
  }) {
    current = useDraftConfigControl({
      workspacePath: workspace,
      workspaceIdentity: identity,
      sessionId,
      sessionConfig: config ?? { mode: "build" },
      agentStartupAllowed: false,
      modelSelectionService: null,
    });
    return null;
  }
  return {
    root,
    read: () => current!,
    render: (sessionId = initialScope, config = initialConfig) =>
      root.render(createElement(Probe, { sessionId, config })),
  };
}
const read = (sessionId = scope, identity?: string) =>
  readV4ComposerDraft(workspace, identity, sessionId);
const richDraft: Omit<V4ComposerDraft, "updatedAt"> = {
  text: "OLD",
  editorStateJson: "old-editor",
  mode: "build",
  planEnabled: false,
  modelSelection: { providerId: "provider", modelId: "model", options: { reasoningLevel: "high" } },
  taskStart: { outcome: "old", deliverable: "Word", constraints: "keep" },
  mention: { id: "one", category: "files", label: "one", value: "/one", markdown: "@one" },
};

describe("B04 draft concurrency with real hook/store and synthetic storage", () => {
  it("F1: another owner gets the latest draft; an unchanged content callback does not write", async () => {
    persistV4ComposerDraft(workspace, undefined, scope, richDraft);
    const a = makeOwner();
    const b = makeOwner();
    await act(async () => {
      a.render();
      b.render();
    });
    await act(async () =>
      a.read().updateComposerContent({ text: "A NEW SAVED", editorStateJson: "new-json" }),
    );
    expect(read()?.text).toBe("A NEW SAVED");
    expect(b.read().composerDraft.text).toBe("A NEW SAVED");
    const before = localStorage.getItem(
      getV4ComposerDraftScopeStorageKey(workspace, undefined, scope),
    );
    await act(async () => b.read().updateComposerContent({ text: b.read().composerDraft.text }));
    expect(
      localStorage.getItem(getV4ComposerDraftScopeStorageKey(workspace, undefined, scope)),
    ).toBe(before);
    expect(read()).toMatchObject({
      text: "A NEW SAVED",
      editorStateJson: "new-json",
      mode: "build",
      taskStart: richDraft.taskStart,
    });
  });

  it("a genuinely new edit through an old closure is accepted and keeps latest config/startup fields", async () => {
    persistV4ComposerDraft(workspace, undefined, scope, richDraft);
    const a = makeOwner();
    const b = makeOwner();
    await act(async () => {
      a.render();
      b.render();
    });
    const oldBUpdate = b.read().updateComposerContent;
    const next = {
      ...richDraft,
      text: "A NEW",
      mode: "edit" as const,
      planEnabled: true,
      modelSelection: { providerId: "new-provider", modelId: "new-model" },
      taskStart: { outcome: "new", deliverable: "PPT", constraints: "latest" },
    };
    await act(async () => {
      a.read().replaceComposerDraft(next);
      oldBUpdate({ text: "B GENUINE EDIT", editorStateJson: "B JSON" });
    });
    const { mention: _oldMention, ...expected } = next;
    expect(read()).toMatchObject({
      ...expected,
      text: "B GENUINE EDIT",
      editorStateJson: "B JSON",
    });
    expect(read()?.mention).toBeUndefined();
    expect(a.read().composerDraft.text).toBe("B GENUINE EDIT");
  });

  it("delayed and out-of-order storage notifications reread the current value and never write back", async () => {
    persistV4ComposerDraft(workspace, undefined, scope, richDraft);
    const b = makeOwner();
    await act(async () => b.render());
    const key = getV4ComposerDraftScopeStorageKey(workspace, undefined, scope);
    const newest = { ...richDraft, text: "LATEST", mode: "yolo", updatedAt: 20 };
    localStorage.setItem(key, JSON.stringify({ version: 1, draft: newest }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          oldValue: null,
          newValue: JSON.stringify({ version: 1, draft: { ...richDraft, text: "STALE EVENT" } }),
        }),
      ),
    );
    expect(b.read().composerDraft.text).toBe("LATEST");
    expect(b.read().composerDraftRestoreRevision).toBe(1);
    expect(setItem).not.toHaveBeenCalled();
    await act(async () =>
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "ignored" })),
    );
    expect(b.read().composerDraftRestoreRevision).toBe(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("a delayed storage notification is unnecessary for a new explicit edit to keep fresh config", async () => {
    persistV4ComposerDraft(workspace, undefined, scope, richDraft);
    const b = makeOwner();
    await act(async () => b.render());
    localStorage.setItem(
      getV4ComposerDraftScopeStorageKey(workspace, undefined, scope),
      JSON.stringify({
        version: 1,
        draft: { ...richDraft, text: "A NEW", mode: "edit", planEnabled: true, updatedAt: 9 },
      }),
    );
    expect(b.read().composerDraft.text).toBe("OLD");
    await act(async () =>
      b.read().updateComposerContent({ text: "B NEW", editorStateJson: "rich" }),
    );
    expect(read()).toMatchObject({
      text: "B NEW",
      mode: "edit",
      planEnabled: true,
      taskStart: richDraft.taskStart,
      modelSelection: richDraft.modelSelection,
    });
  });

  it("an old scope callback cannot write to either session after navigation", async () => {
    const b = makeOwner();
    await act(async () => b.render());
    const oldUpdate = b.read().updateComposerContent;
    await act(async () => b.render("new-session"));
    const previous = read();
    const next = read("new-session");
    await act(async () => oldUpdate({ text: "WRONG SCOPE", editorStateJson: "wrong" }));
    expect(read()).toEqual(previous);
    expect(read("new-session")).toEqual(next);
  });

  it("legacy records are read intact; clearing leaves a tombstone without modifying the old file", async () => {
    const legacyKey = getV4ComposerDraftStorageKey(workspace);
    const legacy = JSON.stringify({
      version: 1,
      scopes: { [scope]: { ...richDraft, updatedAt: 5 }, other: { text: "OTHER", updatedAt: 6 } },
    });
    localStorage.setItem(legacyKey, legacy);
    expect(read()).toEqual({ ...richDraft, updatedAt: 5 });
    const a = makeOwner();
    const b = makeOwner();
    await act(async () => {
      a.render();
      b.render();
    });
    await act(async () => clearV4ComposerDraft(workspace, undefined, scope));
    expect(read()).toBeNull();
    expect(localStorage.getItem(legacyKey)).toBe(legacy);
    expect(read("other")?.text).toBe("OTHER");
    expect(
      JSON.parse(
        localStorage.getItem(getV4ComposerDraftScopeStorageKey(workspace, undefined, scope))!,
      ),
    ).toEqual({ version: 1, draft: null });
    await act(async () =>
      window.dispatchEvent(new StorageEvent("storage", { key: legacyKey, newValue: legacy })),
    );
    expect(read()).toBeNull();
  });

  it("different scopes survive forced interleaving instead of replacing the workspace JSON", () => {
    const original = Storage.prototype.setItem;
    const aKey = getV4ComposerDraftScopeStorageKey(workspace, undefined, "A");
    let injected = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key === aKey && !injected) {
        injected = true;
        persistV4ComposerDraft(workspace, undefined, "B", { text: "B SAVED", mode: "edit" });
      }
      original.call(this, key, value);
    });
    persistV4ComposerDraft(workspace, undefined, "A", { text: "A SAVED", mode: "build" });
    expect(read("A")?.text).toBe("A SAVED");
    expect(read("B")?.text).toBe("B SAVED");
  });

  it("same-scope simultaneous explicit snapshots use the last atomic write; this is not CAS", () => {
    const original = Storage.prototype.setItem;
    let injected = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (!injected) {
        injected = true;
        persistV4ComposerDraft(workspace, undefined, scope, { text: "FIRST WRITE", mode: "edit" });
      }
      original.call(this, key, value);
    });
    persistV4ComposerDraft(workspace, undefined, scope, { text: "LAST WRITE", mode: "build" });
    expect(read()).toMatchObject({ text: "LAST WRITE", mode: "build" });
  });

  it("same path with different remote identities never shares changes", async () => {
    const a = makeOwner(scope, "remote-a");
    const b = makeOwner(scope, "remote-b");
    await act(async () => {
      a.render();
      b.render();
    });
    await act(async () => a.read().updateComposerContent({ text: "A" }));
    expect(read(scope, "remote-a")?.text).toBe("A");
    expect(b.read().composerDraft.text).toBe("");
    expect(read(scope, "remote-b")?.text).toBe("");
  });
  it("quota failure keeps local model/Plan intent for the next edit and reports no saved replacement", async () => {
    persistV4ComposerDraft(workspace, undefined, scope, richDraft);
    const b = makeOwner();
    await act(async () => b.render());
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    await act(async () => b.read().handleDraftSelectModel("new-provider", "new-model"));
    await act(async () => b.read().handleDraftSwitchMode("plan"));
    await act(async () =>
      b.read().updateComposerContent({ text: "UNSAVED INPUT", editorStateJson: "NEW JSON" }),
    );
    expect(b.read().composerDraft).toMatchObject({
      text: "UNSAVED INPUT",
      planEnabled: true,
      modelSelection: { providerId: "new-provider", modelId: "new-model" },
    });
    expect(read()?.text).toBe("OLD");
    setItem.mockRestore();
    await act(async () =>
      b.read().updateComposerContent({ text: "RETRY INPUT", editorStateJson: "RETRY JSON" }),
    );
    expect(read()).toMatchObject({
      text: "RETRY INPUT",
      planEnabled: true,
      modelSelection: { providerId: "new-provider", modelId: "new-model" },
    });
  });
  it("consumed Plan IDs stop two-owner automatic replay and still admit a genuinely new transition", async () => {
    persistV4ComposerDraft(workspace, undefined, scope, {
      ...richDraft,
      lastPlanTransitionId: "T1",
    });
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      writes.push(JSON.parse(value).draft.lastPlanTransitionId);
      if (writes.length > 12) throw new Error("Synthetic automatic-loop circuit breaker");
      original.call(this, key, value);
    });
    const oldConfig = { mode: "build", planTransition: { toolCallId: "T1", planEnabled: false } };
    const newConfig = { mode: "build", planTransition: { toolCallId: "T2", planEnabled: true } };
    const a = makeOwner(scope, undefined, oldConfig);
    const b = makeOwner(scope, undefined, newConfig);
    await act(async () => a.render());
    await act(async () => b.render());
    expect(writes).toEqual(["T2"]);
    expect(a.read().composerDraft.planEnabled).toBe(true);
    expect(read()).toMatchObject({
      text: richDraft.text,
      taskStart: richDraft.taskStart,
      consumedPlanTransitionIds: ["T1", "T2"],
      lastPlanTransitionId: "T2",
    });
    await act(async () =>
      a.render(scope, { mode: "build", planTransition: { toolCallId: "T3", planEnabled: false } }),
    );
    expect(writes).toEqual(["T2", "T3"]);
    expect(read()?.planEnabled).toBe(false);
    expect(read()?.consumedPlanTransitionIds).toEqual(["T1", "T2", "T3"]);
  });

  it("consumed permission IDs stop metadata ping-pong and old grants preserve later manual mode", async () => {
    persistV4ComposerDraft(workspace, undefined, scope, {
      ...richDraft,
      lastPermissionGrantId: "G1",
    });
    const writes: string[] = [];
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      writes.push(JSON.parse(value).draft.lastPermissionGrantId);
      if (writes.length > 12) throw new Error("Synthetic automatic-loop circuit breaker");
      original.call(this, key, value);
    });
    const oldConfig = { mode: "build", permissionGrant: { interactionId: "G1" } };
    const newConfig = { mode: "build", permissionGrant: { interactionId: "G2" } };
    const a = makeOwner(scope, undefined, oldConfig);
    const b = makeOwner(scope, undefined, newConfig);
    await act(async () => a.render());
    await act(async () => b.render());
    expect(writes).toEqual(["G2"]);
    await act(async () => a.read().handleDraftSwitchMode("edit"));
    await act(async () => {
      a.render();
      b.render();
    });
    expect(writes).toEqual(["G2", "G2"]);
    expect(read()).toMatchObject({ mode: "edit", consumedPermissionGrantIds: ["G1", "G2"] });
    await act(async () =>
      b.render(scope, { mode: "build", permissionGrant: { interactionId: "G3" } }),
    );
    expect(writes).toEqual(["G2", "G2", "G3"]);
    expect(read()).toMatchObject({ mode: "yolo", consumedPermissionGrantIds: ["G1", "G2", "G3"] });
  });

  it("consumed histories survive replacement, promotion, remount and out-of-order same-origin notifications", async () => {
    persistV4ComposerDraft(workspace, undefined, "__draft__", {
      ...richDraft,
      lastPlanTransitionId: "T1",
      lastPermissionGrantId: "G1",
    });
    const latestConfig = {
      mode: "build",
      planTransition: { toolCallId: "T2", planEnabled: true },
      permissionGrant: { interactionId: "G2" },
    };
    const rootOwner = makeOwner(null, undefined, latestConfig);
    await act(async () => rootOwner.render());
    await act(async () =>
      rootOwner
        .read()
        .replaceComposerDraft({
          text: "RESTORED",
          mode: "edit",
          planEnabled: false,
          consumedPlanTransitionIds: ["REPLACEMENT-T0"],
          consumedPermissionGrantIds: ["REPLACEMENT-G0"],
        }),
    );
    expect(read("__draft__")).toMatchObject({
      text: "RESTORED",
      mode: "edit",
      planEnabled: false,
      lastPlanTransitionId: "T2",
      lastPermissionGrantId: "G2",
      consumedPlanTransitionIds: ["T1", "T2", "REPLACEMENT-T0"],
      consumedPermissionGrantIds: ["G1", "G2", "REPLACEMENT-G0"],
    });
    await act(async () => rootOwner.read().promoteComposerDraft("promoted"));
    const promoted = read("promoted");
    await act(async () => rootOwner.root.unmount());
    roots.splice(roots.indexOf(rootOwner.root), 1);
    const stale = makeOwner("promoted", undefined, {
      mode: "build",
      planTransition: { toolCallId: "T1", planEnabled: true },
      permissionGrant: { interactionId: "G1" },
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => stale.render());
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: getV4ComposerDraftScopeStorageKey(workspace, undefined, "promoted"),
          newValue: JSON.stringify({
            version: 1,
            draft: { ...richDraft, lastPlanTransitionId: "T1", lastPermissionGrantId: "G1" },
          }),
        }),
      ),
    );
    expect(read("promoted")).toEqual(promoted);
    expect(stale.read().composerDraft).toMatchObject({
      text: "RESTORED",
      mode: "edit",
      planEnabled: false,
    });
    expect(setItem).not.toHaveBeenCalled();
  });
});
