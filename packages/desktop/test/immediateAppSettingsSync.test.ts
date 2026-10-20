import { readFile } from "node:fs/promises";
import ts from "typescript";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@zcode/shared";

let createSync: (dependencies: Record<string, unknown>) => (patch: Partial<AppSettings>) => void;

beforeAll(async () => {
  // 只装载真实函数，避免导入 Main 时启动 Electron；不复制通知条件来测试自己。
  const path = new URL("../src/main/index.ts", import.meta.url);
  const source = ts.createSourceFile(
    path.pathname,
    await readFile(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "syncImmediateAppSettings",
  );
  if (!declaration) throw new Error("Missing production syncImmediateAppSettings");
  const code = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  createSync = (dependencies) =>
    new Function(...Object.keys(dependencies), `${code}; return syncImmediateAppSettings;`)(
      ...Object.values(dependencies),
    );
});

function setup() {
  const sendA = vi.fn();
  const sendB = vi.fn();
  const destroyedSend = vi.fn();
  const rebuildMenu = vi.fn();
  const sync = createSync({
    syncCloseToTrayOnWindows: vi.fn(),
    reconcileKeepAwakeBlocker: vi.fn(),
    refreshAutoUpdaterReleaseChannel: vi.fn(),
    rebuildMenu,
    getApplicationWindowsExcludingCuaIndicator: () => [
      { isDestroyed: () => false, webContents: { send: sendA } },
      { isDestroyed: () => false, webContents: { send: sendB } },
      { isDestroyed: () => true, webContents: { send: destroyedSend } },
    ],
    PlatformChannels: { SettingsChanged: "settings-changed" },
  });
  return { sync, sendA, sendB, destroyedSend, rebuildMenu };
}

describe("Main immediate settings invalidation", () => {
  it.each([false, true])(
    "notifies both windows once for strict suggestion value %s without rebuilding menus",
    (value) => {
      const state = setup();
      state.sync({ followupSuggestionsEnabled: value });
      expect(state.sendA).toHaveBeenCalledExactlyOnceWith("settings-changed");
      expect(state.sendB).toHaveBeenCalledExactlyOnceWith("settings-changed");
      expect(state.destroyedSend).not.toHaveBeenCalled();
      expect(state.rebuildMenu).not.toHaveBeenCalled();
    },
  );

  it("coalesces mixed shortcut and suggestion patches into one notification per window", () => {
    const state = setup();
    state.sync({ shortcutBindings: {}, followupSuggestionsEnabled: false });
    expect(state.rebuildMenu).toHaveBeenCalledOnce();
    expect(state.sendA).toHaveBeenCalledOnce();
    expect(state.sendB).toHaveBeenCalledOnce();
  });

  it("preserves the shortcut-only notification and menu rebuild", () => {
    const state = setup();
    state.sync({ shortcutBindings: {} });
    expect(state.rebuildMenu).toHaveBeenCalledOnce();
    expect(state.sendA).toHaveBeenCalledOnce();
    expect(state.sendB).toHaveBeenCalledOnce();
  });

  it.each([undefined, null, "false", 0, 1, {}, []])(
    "does not notify for nonboolean suggestion value %j",
    (value) => {
      const state = setup();
      state.sync({ followupSuggestionsEnabled: value } as Partial<AppSettings>);
      expect(state.sendA).not.toHaveBeenCalled();
      expect(state.sendB).not.toHaveBeenCalled();
      expect(state.rebuildMenu).not.toHaveBeenCalled();
    },
  );

  it("does not broaden invalidation to unrelated settings", () => {
    const state = setup();
    state.sync({ providerFamilyDomain: "existing-domain" } as Partial<AppSettings>);
    expect(state.sendA).not.toHaveBeenCalled();
    expect(state.sendB).not.toHaveBeenCalled();
    expect(state.rebuildMenu).not.toHaveBeenCalled();
  });
});
