import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFileConfig } from "../src/config/file-config.adapter.js";
import { getDefaultSessionDbPath } from "../src/storage/session-store/paths.js";
import { resolveDefaultSkillRoots } from "../src/skills/roots.js";
import { resolveDefaultCustomCommandRoots } from "../src/commands/roots.js";
import { resolveSharedZCodeCredentialsPath } from "../src/auth/shared-credentials.js";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "zcode-cli-isolation-")));
  vi.stubEnv("ZCODE_APPLICATION_HOME", root);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("CLI application home", () => {
  it("isolates default config, session DB and shared credentials without modifying HOME", () => {
    const home = process.env.HOME;
    expect(loadFileConfig().path).toBe(join(root, ".zcode", "cli", "config.json"));
    expect(getDefaultSessionDbPath()).toBe(join(root, ".zcode", "cli", "db", "db.sqlite"));
    expect(resolveSharedZCodeCredentialsPath({ baseDir: "/wrong", filePath: "/wrong/credentials.json" })).toBe(join(root, ".zcode", "v2", "credentials.json"));
    expect(process.env.HOME).toBe(home);
  });

  it("discovers user skills and commands only below application home", async () => {
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    for (const roots of [await resolveDefaultSkillRoots(workspace), await resolveDefaultCustomCommandRoots(workspace)]) {
      const userRoots = roots.filter((entry) => entry.scope === "user");
      expect(userRoots.length).toBeGreaterThan(0);
      expect(userRoots.every((entry) => entry.path.startsWith(root))).toBe(true);
    }
  });
});
