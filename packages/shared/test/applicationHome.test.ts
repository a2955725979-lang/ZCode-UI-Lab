import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIsolatedApplicationEnv, getApplicationHomeDir, getIsolatedApplicationHome } from "../src/applicationHome.js";

const mockedHome = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockedHome.value ?? actual.homedir() };
});

const roots: string[] = [];
afterEach(async () => { mockedHome.value = undefined; await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function temporaryRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "zcode-application-home-")));
  roots.push(root);
  return root;
}

describe("explicit application home", () => {
  it("preserves ordinary home resolution and inherited environment when unset", () => {
    expect(getApplicationHomeDir({ HOME: "/example/home" })).toBe("/example/home");
    expect(getIsolatedApplicationHome({})).toBeUndefined();
    expect(getApplicationHomeDir({ HOME: "/shell/home", USERPROFILE: "/profile" }, "/os/home")).toBe("/os/home");
    const env = { HOME: "/example/home", API_KEY: "synthetic" };
    expect(buildIsolatedApplicationEnv(env)).toEqual(env);
  });

  it("rejects relative paths and production roots without falling back", () => {
    for (const root of ["relative", homedir(), join(homedir(), ".zcode", "nested"), join(homedir(), ".zcode", "..named-child"), join(homedir(), ".agents"), join(homedir(), ".claude")]) {
      expect(() => getIsolatedApplicationHome({ ZCODE_APPLICATION_HOME: root })).toThrow();
    }
  });

  it.skipIf(process.platform === "win32")("rejects a symlink alias to real home", async () => {
    const root = await temporaryRoot();
    await symlink(homedir(), join(root, "alias"));
    expect(() => getIsolatedApplicationHome({ ZCODE_APPLICATION_HOME: join(root, "alias") })).toThrow();
  });

  it.skipIf(process.platform === "win32")("rejects the target of a symlinked production configuration directory", async () => {
    const root = await temporaryRoot();
    const systemHome = join(root, "system-home");
    const production = join(root, "production-store");
    await mkdir(systemHome);
    await mkdir(production);
    await symlink(production, join(systemHome, ".zcode"));
    mockedHome.value = systemHome;
    expect(() => getIsolatedApplicationHome({ ZCODE_APPLICATION_HOME: join(production, "new-child") })).toThrow("production user data");
  });

  it("derives all launch paths while dropping credentials, config pointers and test identities", async () => {
    const root = await temporaryRoot();
    const source = {
      HOME: homedir(), USERPROFILE: "synthetic-profile", PATH: "/trusted/bin", CODEX_HOME: "/production/codex",
      ZCODE_APPLICATION_HOME: root, ZCODE_DATA_BASE_DIR: "/production", ZCODE_DESKTOP_HOME_DIR: "/production",
      ZCODE_DESKTOP_USER_DATA_DIR: "/production", ZCODE_REMOTE_ASSET_CACHE_DIR: "/production",
      ANTHROPIC_API_KEY: "synthetic", AWS_PROFILE: "production", SSH_AUTH_SOCK: "/production/socket",
      ZCODE_E2E_FAKE_IDENTITY: "1", ZCODE_TOOL_ENV_PASSTHROUGH_JSON: "synthetic",
      ELECTRON_RENDERER_URL: "http://127.0.0.1:5174", LC_ALL: "C",
    };
    const clean = buildIsolatedApplicationEnv(source);
    expect(clean.HOME).toBe(source.HOME);
    expect(clean.USERPROFILE).toBe(source.USERPROFILE);
    expect(source.CODEX_HOME).toBe("/production/codex");
    expect(clean.CODEX_HOME).toBeUndefined();
    expect(clean).toMatchObject({
      ZCODE_APPLICATION_HOME: root, ZCODE_DATA_BASE_DIR: root,
      ZCODE_DESKTOP_HOME_DIR: root, ZCODE_DESKTOP_APPLICATION_NAME: "ZCode UI Lab",
      ZCODE_DESKTOP_USER_DATA_DIR: join(root, "electron", "userData"),
      ZCODE_DESKTOP_SESSION_DATA_DIR: join(root, "electron", "sessionData"),
      ELECTRON_RENDERER_URL: source.ELECTRON_RENDERER_URL, LC_ALL: "C",
    });
    for (const key of ["ANTHROPIC_API_KEY", "AWS_PROFILE", "SSH_AUTH_SOCK", "ZCODE_E2E_FAKE_IDENTITY", "ZCODE_TOOL_ENV_PASSTHROUGH_JSON", "ZCODE_REMOTE_ASSET_CACHE_DIR"]) expect(clean[key]).toBeUndefined();
  });
});
