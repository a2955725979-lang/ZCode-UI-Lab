import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  root = mkdtempSync(join(tmpdir(), "zcode-early-isolation-"));
  delete process.env.ZCODE_APPLICATION_HOME;
  vi.resetModules();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, originalEnv);
  rmSync(root, { recursive: true, force: true });
});

async function bootstrap() {
  await import("../src/main/desktopEarlyApplicationIsolation.js");
}

describe("early isolated Electron directories", () => {
  it("creates fresh profile and session directories before Electron uses them", async () => {
    process.env.ZCODE_APPLICATION_HOME = root;
    const originalHome = process.env.HOME;
    await bootstrap();

    expect(statSync(join(root, "electron", "userData")).isDirectory()).toBe(true);
    expect(statSync(join(root, "electron", "sessionData")).isDirectory()).toBe(true);
    expect(process.env.HOME).toBe(originalHome);
    const portFile = join(root, "electron", "sessionData", "DevToolsActivePort");
    expect(() => writeFileSync(portFile, "9222\n/devtools/browser/test")).not.toThrow();

    vi.resetModules();
    await bootstrap();
    expect(readFileSync(portFile, "utf8")).toBe("9222\n/devtools/browser/test");
  });

  it("leaves ordinary launch paths and environment unchanged", async () => {
    process.env.ZCODE_DESKTOP_USER_DATA_DIR = join(root, "profile");
    process.env.ZCODE_DESKTOP_SESSION_DATA_DIR = join(root, "session");
    const before = { ...process.env };
    await bootstrap();

    expect(process.env).toEqual(before);
    expect(existsSync(join(root, "profile"))).toBe(false);
    expect(existsSync(join(root, "session"))).toBe(false);
  });

  it("fails startup when an isolated directory cannot be created", async () => {
    process.env.ZCODE_APPLICATION_HOME = root;
    writeFileSync(join(root, "electron"), "not a directory");
    await expect(bootstrap()).rejects.toThrow();
    expect(readFileSync(join(root, "electron"), "utf8")).toBe("not a directory");
  });
});
