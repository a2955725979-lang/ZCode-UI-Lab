import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveCoreBundledAgentEntrypoint } from "../src/runtime/agentWiring.js";

const temporaryDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zcode-server-agent-wiring-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("resolveCoreBundledAgentEntrypoint", () => {
  it("returns the Core sibling bundle as an internal fact without mutating external env", async () => {
    const entryDir = await makeTempDir();
    const bundlePath = join(entryDir, "zcode.cjs");
    await writeFile(bundlePath, "// bundle\n", "utf8");

    const env = {};
    expect(await resolveCoreBundledAgentEntrypoint(entryDir, env)).toBe(await realpath(bundlePath));
    expect(env).toEqual({});
  });

  it("keeps an explicit ZCODE_AGENT_SERVER_COMMAND untouched", async () => {
    const entryDir = await makeTempDir();
    await writeFile(join(entryDir, "zcode.cjs"), "// bundle\n", "utf8");

    const wiring = await resolveCoreBundledAgentEntrypoint(entryDir, {
      ZCODE_AGENT_SERVER_COMMAND: "/custom/agent",
    });
    expect(wiring).toBeUndefined();
  });

  it("returns null when no bundled zcode.cjs exists (dev workspace)", async () => {
    const entryDir = await makeTempDir();
    expect(await resolveCoreBundledAgentEntrypoint(entryDir, {})).toBeUndefined();
  });

  it("resolves each candidate Core's own runtime rather than reusing the supervisor bundle", async () => {
    const oldRuntime = await makeTempDir();
    const newRuntime = await makeTempDir();
    for (const root of [oldRuntime, newRuntime])
      await writeFile(join(root, "zcode.cjs"), "// bundle");
    expect(await resolveCoreBundledAgentEntrypoint(oldRuntime, {})).toBe(
      await realpath(join(oldRuntime, "zcode.cjs")),
    );
    expect(await resolveCoreBundledAgentEntrypoint(newRuntime, {})).toBe(
      await realpath(join(newRuntime, "zcode.cjs")),
    );
  });

  it("does not claim an outside symlink as its bundled CLI", async () => {
    const coreDir = await makeTempDir();
    const otherDir = await makeTempDir();
    const outside = join(otherDir, "zcode.cjs");
    await writeFile(outside, "// external");
    await symlink(outside, join(coreDir, "zcode.cjs"));
    expect(await resolveCoreBundledAgentEntrypoint(coreDir, {})).toBeUndefined();
  });
});
