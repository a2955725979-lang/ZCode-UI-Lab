import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createStandaloneWebZCodeAgentCommandResolver } from "../src/zcode-agent/zcodeWebAgentCommandResolver.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const dirs: string[] = [];
const context = {
  workspacePath: "/unused-workspace",
  workspaceKey: "web",
  presentationSurface: "web" as const,
};

async function fixture(body: string, extension = "cjs") {
  const dir = await mkdtemp(join(tmpdir(), "zcode-web-probe-"));
  dirs.push(dir);
  const entry = join(dir, `zcode.${extension}`);
  const count = join(dir, "count.txt");
  await writeFile(
    entry,
    `require('node:fs').appendFileSync(${JSON.stringify(count)}, 'probe\\n');\n${body}\n`,
  );
  return { dir, entry, count };
}

beforeEach(() => {
  vi.stubEnv("ZCODE_AGENT_SERVER_COMMAND", "");
  vi.stubEnv("ZCODE_AGENT_SERVER_ARGS_JSON", "");
  vi.stubEnv("ZCODE_AGENT_SERVER_CWD", "");
  vi.mocked(spawn).mockClear();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe("standalone Web controlled CLI confirmation", () => {
  it("adds web only after a bounded, fixed offline probe of an internal bundle", async () => {
    vi.stubEnv("NODE_OPTIONS", "--must-not-be-inherited-by-probe");
    vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", "synthetic-test-header");
    const { entry } = await fixture(
      `if (!process.argv.includes('--prepare-storage') || !process.argv.includes('--version')) process.exit(7); console.log('1.2.3-dev');`,
    );
    const resolve = createStandaloneWebZCodeAgentCommandResolver({ bundledAgentEntrypoint: entry });
    const command = await resolve(context);
    expect(command?.args).toEqual([entry, "app-server", "--stdio", "--surface", "web"]);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      [entry, "app-server", "--surface", "web", "--version", "--prepare-storage"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"], windowsHide: true }),
    );
    const env = vi.mocked(spawn).mock.calls[0]![2]!.env;
    expect(env).not.toHaveProperty("NODE_OPTIONS");
    expect(env).not.toHaveProperty("OTEL_EXPORTER_OTLP_HEADERS");
  });

  it.each([
    ["old CLI", "console.error('Unsupported --surface value: web'); process.exit(1);"],
    ["failed", "process.exit(2);"],
    ["unknown output", "console.log('unexpected success output');"],
    ["oversized output", "process.stdout.write('x'.repeat(70000));"],
    ["timeout", "setInterval(() => {}, 1000);"],
  ])("falls back without an appended surface for an internal %s", async (_name, body) => {
    const { entry } = await fixture(body);
    const resolve = createStandaloneWebZCodeAgentCommandResolver({
      bundledAgentEntrypoint: entry,
      probeTimeoutMs: 200,
    });
    const started = Date.now();
    expect((await resolve(context))?.args).toEqual([entry, "app-server", "--stdio"]);
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it("missing internal artifacts safely fall back without executing anything", async () => {
    const resolve = createStandaloneWebZCodeAgentCommandResolver({
      bundledAgentEntrypoint: join(tmpdir(), "not-present-zcode-web-test.cjs"),
    });
    expect((await resolve(context))?.args).not.toContain("--surface");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not probe an internal-looking symlink that escapes its owning directory", async () => {
    const owned = await fixture("console.log('1.2.3');");
    const outside = await fixture("console.log('1.2.3');");
    await rm(owned.entry);
    await symlink(outside.entry, owned.entry);
    const resolve = createStandaloneWebZCodeAgentCommandResolver({
      bundledAgentEntrypoint: owned.entry,
    });
    expect((await resolve(context))?.args).not.toContain("--surface");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["app-server", "--stdio"],
    ["app-server", "--surface=web", "--stdio"],
    ["app-server", "--surface", "--stdio"],
    ["app-server", "--surface", "desktop", "--stdio"],
  ])("never executes or rewrites an explicit external override: %j", async (...args) => {
    vi.stubEnv("ZCODE_AGENT_SERVER_COMMAND", "/must-not-be-executed/external-cli");
    vi.stubEnv("ZCODE_AGENT_SERVER_ARGS_JSON", JSON.stringify(args));
    vi.stubEnv("ZCODE_AGENT_SERVER_CWD", "/external/workspace");
    const { entry } = await fixture("console.log('1.2.3');");
    const resolve = createStandaloneWebZCodeAgentCommandResolver({ bundledAgentEntrypoint: entry });
    expect(await resolve(context)).toEqual({
      command: "/must-not-be-executed/external-cli",
      args,
      cwd: "/external/workspace",
    });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reuses concurrent confirmations only for the same content and runtime identity", async () => {
    const { entry, count } = await fixture("console.log('1.2.3');");
    const resolve = createStandaloneWebZCodeAgentCommandResolver({ bundledAgentEntrypoint: entry });
    const results = await Promise.all([
      resolve(context),
      resolve({ ...context, workspaceKey: "other" }),
    ]);
    expect(results.every((result) => result?.args?.includes("web"))).toBe(true);
    await resolve(context);
    expect((await readFile(count, "utf8")).match(/probe/g)).toHaveLength(1);
    await writeFile(entry, "process.exit(1); // replaced old artifact\n");
    expect((await resolve(context))?.args).not.toContain("--surface");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a negative confirmation after replacement with a supported bundle", async () => {
    const { entry } = await fixture("process.exit(1);");
    const resolve = createStandaloneWebZCodeAgentCommandResolver({ bundledAgentEntrypoint: entry });
    expect((await resolve(context))?.args).not.toContain("--surface");
    await writeFile(entry, "console.log('1.2.3');\n");
    expect((await resolve(context))?.args).toContain("web");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("does not accept a supported probe if the artifact changed during confirmation", async () => {
    const { entry } = await fixture(
      "require('node:fs').appendFileSync(__filename, '// changed during probe\\n'); console.log('1.2.3');",
    );
    const resolve = createStandaloneWebZCodeAgentCommandResolver({ bundledAgentEntrypoint: entry });
    expect((await resolve(context))?.args).not.toContain("--surface");
  });

  it("does not cache source-tsx results by a single source file", async () => {
    const { entry } = await fixture("console.log('1.2.3');", "ts");
    const resolve = createStandaloneWebZCodeAgentCommandResolver({ bundledAgentEntrypoint: entry });
    await resolve(context);
    await resolve(context);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("keeps Desktop synchronous behavior without probing even when a bundled Web option exists", async () => {
    vi.stubEnv("ZCODE_AGENT_SERVER_COMMAND", "/must-not-be-executed/external-cli");
    vi.stubEnv(
      "ZCODE_AGENT_SERVER_ARGS_JSON",
      JSON.stringify(["app-server", "--surface", "--stdio"]),
    );
    const resolve = createStandaloneWebZCodeAgentCommandResolver({
      bundledAgentEntrypoint: "/unused/zcode.cjs",
    });
    expect((await resolve({ ...context, presentationSurface: "desktop" }))?.args).toEqual([
      "app-server",
      "--stdio",
      "--surface",
      "desktop",
    ]);
    expect(spawn).not.toHaveBeenCalled();
  });
});
