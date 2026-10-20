import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsSyncService } from "../src/settings-sync/settingsSyncService.js";
import type { ISettingService } from "../src/setting/setting.js";

let temporaryRoot: string;
let profile: string;
let target: string;
const service = createSettingsSyncService({ settingService: {} as ISettingService });

beforeEach(async () => {
  temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zcode-global-instructions-")));
  profile = join(temporaryRoot, "isolated-profile");
  target = join(profile, ".zcode", "AGENTS.md");
  vi.stubEnv("HOME", join(temporaryRoot, "official-home"));
  vi.stubEnv("ZCODE_APPLICATION_HOME", profile);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("global instructions fixed target", () => {
  it("reads status without creating or copying the official user file", async () => {
    const original = join(process.env.HOME!, ".zcode", "AGENTS.md");
    await mkdir(join(process.env.HOME!, ".zcode"), { recursive: true });
    await writeFile(original, "official instructions");
    await expect(service.getGlobalAgentsFileStatus()).resolves.toEqual({
      path: target,
      exists: false,
    });
    await expect(readFile(target)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(service.createGlobalAgentsFile()).resolves.toEqual({ path: target, exists: true });
    expect(await readFile(target, "utf8")).toBe("");
    expect(await readFile(original, "utf8")).toBe("official instructions");
  });

  it("preserves existing bytes through repeated and concurrent creation", async () => {
    await Promise.all([service.createGlobalAgentsFile(), service.createGlobalAgentsFile()]);
    await writeFile(target, "# Custom\nNever overwrite this.\n");
    await Promise.all([service.createGlobalAgentsFile(), service.createGlobalAgentsFile()]);
    expect(await readFile(target, "utf8")).toBe("# Custom\nNever overwrite this.\n");
  });

  it.each(["link", "directory"])("rejects a %s target", async (kind) => {
    await mkdir(join(profile, ".zcode"), { recursive: true });
    const external = join(temporaryRoot, "external.md");
    await writeFile(external, "untouched");
    if (kind === "link") await symlink(external, target);
    else await mkdir(target);
    await expect(service.getGlobalAgentsFileStatus()).rejects.toThrow("regular file");
    await expect(service.createGlobalAgentsFile()).rejects.toThrow("regular file");
    expect(await readFile(external, "utf8")).toBe("untouched");
  });

  it.each(["profile", "zcode"])("rejects a symlink %s directory", async (kind) => {
    const external = join(temporaryRoot, "external");
    await mkdir(external);
    if (kind === "profile") await symlink(external, profile);
    else {
      await mkdir(profile);
      await symlink(external, join(profile, ".zcode"));
    }
    await expect(service.createGlobalAgentsFile()).rejects.toThrow("regular directory");
    await expect(readFile(join(external, "AGENTS.md"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("surfaces an invalid profile instead of reporting a missing file", async () => {
    await writeFile(profile, "not a directory");
    await expect(service.getGlobalAgentsFileStatus()).rejects.toThrow("regular directory");
  });

  it("uses only isolated Claude migration sources", async () => {
    const officialClaude = join(process.env.HOME!, ".claude");
    await mkdir(officialClaude, { recursive: true });
    await writeFile(join(officialClaude, "CLAUDE.md"), "official source");
    await expect(service.getClaudeAgentsFileMigrationStatus({})).resolves.toMatchObject({
      sourcePath: join(profile, ".claude", "CLAUDE.md"),
      sourceExists: false,
      targetPath: target,
      targetExists: false,
    });
  });
});
