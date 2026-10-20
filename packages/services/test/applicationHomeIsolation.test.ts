import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "zcode-isolation-service-")));
  vi.stubEnv("ZCODE_APPLICATION_HOME", root);
  vi.stubEnv("ZCODE_DATA_BASE_DIR", join(root, "wrong-data"));
  vi.stubEnv("ZCODE_DESKTOP_HOME_DIR", join(root, "wrong-home"));
  vi.resetModules();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await rm(root, { recursive: true, force: true });
});

describe("application home across services and bootstrap", () => {
  it("locks data/config/credentials to the application root before and after saved settings", async () => {
    const paths = await import("../src/paths.js");
    await mkdir(join(root, ".zcode", "v2"), { recursive: true });
    await writeFile(paths.getApplicationSettingsFile(), JSON.stringify({ dataBaseDir: join(root, "wrong-saved"), desktopChromiumHardwareAccelerationEnabled: false }));
    const { applyEarlyDataBaseDirBootstrap, resolveBootstrapSettingsFile } = await import("../../desktop/src/main/desktopDataBaseDirBootstrap.js");
    const { applyEarlyChromiumHardwareAccelerationBootstrap } = await import("../../desktop/src/main/desktopChromiumHardwareAccelerationBootstrap.js");
    expect(applyEarlyDataBaseDirBootstrap()).toBe(root);
    paths.setDataBaseDir(join(root, "wrong-override"));
    expect(paths.getDataBaseDir()).toBe(root);
    expect(paths.getAppConfigDir()).toBe(join(root, ".zcode", "v2"));
    expect(paths.getProviderWorkspaceConfigDir()).toBe(join(root, ".zcode", "cli"));
    expect(resolveBootstrapSettingsFile()).toBe(paths.getApplicationSettingsFile());
    const disableHardwareAcceleration = vi.fn();
    expect(applyEarlyChromiumHardwareAccelerationBootstrap({ disableHardwareAcceleration })).toBe(false);
    expect(disableHardwareAcceleration).toHaveBeenCalledOnce();
  });

  it("writes only lab settings and rejects migration and direct escaped root patches before IO", async () => {
    const { createSettingService } = await import("../src/setting/settingService.js");
    const service = createSettingService();
    await service.update({ theme: "dark" });
    const settingsFile = join(root, ".zcode", "v2", "setting.json");
    const before = await readFile(settingsFile, "utf8");
    const rejectedRoot = join(root, "must-not-be-created");
    await expect(service.updateDataBaseDir(rejectedRoot)).rejects.toThrow("fixed");
    await expect(service.update({ dataBaseDir: rejectedRoot })).rejects.toThrow("fixed");
    expect(await readFile(settingsFile, "utf8")).toBe(before);
    await expect(access(rejectedRoot)).rejects.toThrow();
    expect((await service.get()).dataBaseDir).toBe(root);
  });

  it("never executes a login shell and preserves OS HOME in the Agent environment", async () => {
    const { captureLoginShellEnvSnapshot, captureLoginShellEnvSnapshotSync } = await import("../src/runtime-tools/runtimeLoginShellEnvCapture.js");
    const executeShell = vi.fn();
    const baseEnv = { ...process.env, VITEST: undefined };
    expect(await captureLoginShellEnvSnapshot({ baseEnv, executeShell })).toBeNull();
    expect(captureLoginShellEnvSnapshotSync(baseEnv)).toBeNull();
    expect(executeShell).not.toHaveBeenCalled();
    const { buildCleanEnv } = await import("../src/runtime-tools/providerRuntimeResolver.js");
    const env = buildCleanEnv("glm", join(root, ".zcode", "cli"));
    expect(env.HOME).toBe(process.env.HOME);
    expect(env.USERPROFILE).toBe(process.env.USERPROFILE);
    expect(env.CODEX_HOME).toBe(process.env.CODEX_HOME);
    expect(env.ZCODE_DATA_BASE_DIR).toBe(root);
    expect(env.ZCODE_STORAGE_DIR).toBe(join(root, ".zcode"));
  });

  it("resolves compatibility resources and model traces only inside the lab", async () => {
    const { resolveUserSubagentRoot } = await import("../src/subagents/subagentStorage.js");
    const { resolveModelIODirs } = await import("../src/zcode-agent/modelTrajectoryFileTail.js");
    expect(await resolveUserSubagentRoot()).toBe(join(root, ".zcode", "agents"));
    expect(resolveModelIODirs()).toEqual([join(root, ".zcode", "cli", "debug"), join(root, ".zcode", "cli", "rollout")]);
  });
});
