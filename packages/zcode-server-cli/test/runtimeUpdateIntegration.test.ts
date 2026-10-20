import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { requestControl } from "../src/ipc/controlClient.js";
import { resolveCanonicalServerLayout, resolveServerLayout } from "../src/runtime/paths.js";
import { ReleaseManager } from "../src/runtime/releaseManager.js";

async function waitForReady(
  controlEndpoint: string,
): Promise<{ serviceRegistered?: boolean; state?: string }> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const status = (await requestControl(controlEndpoint, { command: "status" }, 200)) as {
        state?: string;
      };
      if (status.state === "ready") return status;
    } catch {
      // Supervisor/Core 仍在真实启动，继续轮询 control endpoint。
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for integration Supervisor ready");
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for integration CLI ready output");
}

async function listChildPids(parentPid: number): Promise<number[]> {
  const { execFile } = await import("node:child_process");
  return await new Promise<number[]>((resolve) => {
    execFile("pgrep", ["-P", String(parentPid)], (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(String(stdout).split(/\s+/u).filter(Boolean).map(Number));
    });
  });
}

async function waitForHttpClosed(port: number): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/server-info`, {
        signal: AbortSignal.timeout(250),
      });
      await response.arrayBuffer();
    } catch {
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe.skipIf(process.platform === "win32")("runtime update integration", () => {
  it("收口 Supervisor IPC 断连后的 Core，避免遗留孤儿监听进程", async () => {
    const root = await mkdtemp(join("/tmp", "zcode-orphan-"));
    const layout = resolveServerLayout(join(root, ".zcode", "server"));
    await new ReleaseManager(layout).ensure();
    const coreEntry = fileURLToPath(new URL("../src/server-core/entry.ts", import.meta.url));
    const zcodeBuiltinProviderConfigFilePath = fileURLToPath(
      new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
    );
    const harness = [
      "import { fork } from 'node:child_process';",
      `const core = fork(${JSON.stringify(coreEntry)}, ['1'], { execArgv: ['--import', 'tsx'], env: { ...process.env, ZCODE_SERVER_ROOT: ${JSON.stringify(layout.serverRoot)}, ZCODE_DATA_BASE_DIR: ${JSON.stringify(layout.dataBaseDir)}, ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: ${JSON.stringify(zcodeBuiltinProviderConfigFilePath)} }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });`,
      "core.on('message', (message) => { if (message && message.type === 'ready') process.stdout.write(JSON.stringify(message)); });",
    ].join("\n");
    const supervisor = spawn(process.execPath, ["--input-type=module", "-e", harness], {
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    supervisor.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        supervisor.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    let corePids: number[] = [];
    try {
      await waitForCondition(() => {
        try {
          JSON.parse(output);
          return true;
        } catch {
          return false;
        }
      });
      const ready = JSON.parse(output) as { port?: number };
      if (!ready.port) throw new Error("Core did not publish a listening port");
      corePids = await listChildPids(supervisor.pid ?? -1);
      expect(corePids.length).toBeGreaterThan(0);

      supervisor.kill("SIGKILL");
      await expect(exited).resolves.toMatchObject({ signal: "SIGKILL" });
      await expect(waitForHttpClosed(ready.port)).resolves.toBe(true);
    } finally {
      if (supervisor.exitCode === null) supervisor.kill("SIGKILL");
      for (const pid of corePids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* child 已退出 */
        }
      }
    }
  }, 20_000);

  it("launches real old/new Core fixtures with self-located bundled Agent facts, without external env wiring", async () => {
    // POSIX Unix socket 有路径长度限制，macOS 的 tmpdir() 可能位于很长的 /var/folders 路径；
    // 保持短路径，Windows 则使用其可移植的系统临时目录。
    const root = await mkdtemp(
      join(process.platform === "win32" ? tmpdir() : "/tmp", "zcode-runtime-"),
    );
    const layout = resolveServerLayout(join(root, ".zcode", "server"));
    const canonicalLayout = await resolveCanonicalServerLayout(layout.serverRoot);
    const releases = new ReleaseManager(layout);
    await releases.ensure();
    const fixture = fileURLToPath(new URL("./fixtures/coreWiringFixture.mjs", import.meta.url));
    for (const version of ["old", "new"]) {
      const runtimeRoot = join(layout.releasesDir, version, "runtime");
      await mkdir(runtimeRoot, { recursive: true });
      await symlink(process.execPath, join(runtimeRoot, "node"));
      await cp(fixture, join(runtimeRoot, "server-core.js"));
      await writeFile(
        join(runtimeRoot, "zcode.cjs"),
        version === "old"
          ? "if (process.argv.includes('--surface')) process.exit(1); console.log('1.0.0');\n"
          : "if (!process.argv.includes('--version')) process.exit(7); console.log('2.0.0');\n",
        "utf8",
      );
      await writeFile(
        join(runtimeRoot, "package.json"),
        JSON.stringify({ type: "module" }),
        "utf8",
      );
    }
    await releases.writePending({ version: "old", releaseDir: join(layout.releasesDir, "old") });
    await releases.applyPending();

    const wiringOutput = join(root, "wiring.jsonl");
    const mainEntry = fileURLToPath(new URL("../src/main.ts", import.meta.url));
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        mainEntry,
        "serve",
        "--supervisor",
        "--server-root",
        layout.serverRoot,
        "--json",
      ],
      {
        env: {
          ...process.env,
          ZCODE_TEST_WIRING_OUTPUT: wiringOutput,
          ZCODE_TEST_AGENT_WIRING_MODULE: new URL("../src/runtime/agentWiring.ts", import.meta.url)
            .href,
          ZCODE_TEST_WEB_RESOLVER_MODULE: new URL(
            "../../services/src/zcode-agent/zcodeWebAgentCommandResolver.ts",
            import.meta.url,
          ).href,
          ZCODE_AGENT_SERVER_COMMAND: "",
          ZCODE_AGENT_SERVER_ARGS_JSON: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let diagnostics = "";
    child.stdout.on("data", (chunk) => {
      diagnostics += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      diagnostics += String(chunk);
    });
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    try {
      await expect(waitForReady(layout.controlEndpoint)).resolves.toMatchObject({
        state: "ready",
        serviceRegistered: false,
      });
      // control socket 会比外层 serve 命令返回稍早；先等 CLI 完成自己的 ready barrier，
      // 避免测试立即 update/stop 让启动调用方错过短暂的 ready 状态。
      await waitForCondition(() => diagnostics.includes('"state":"ready"'));
      await releases.writePending({ version: "new", releaseDir: join(layout.releasesDir, "new") });
      await expect(
        requestControl(layout.controlEndpoint, { command: "apply-update" }, 15_000),
      ).resolves.toMatchObject({ applied: true, version: "new" });
      await expect(waitForReady(layout.controlEndpoint)).resolves.toMatchObject({
        state: "ready",
        serviceRegistered: false,
      });
      await requestControl(layout.controlEndpoint, { command: "stop" }, 2_000);
      await expect(exited).resolves.toBe(0);
    } catch (error) {
      await requestControl(layout.controlEndpoint, { command: "stop" }, 500).catch(() => undefined);
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1_000))]);
      if (child.exitCode === null) child.kill("SIGKILL");
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n${diagnostics}`);
    }

    const records = (await readFile(wiringOutput, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            agentArgs: string[];
            agentCommand: string | null;
            bundledAgentEntrypoint: string;
            resolvedAgentCommand: string;
            resolvedAgentArgs: string[];
            dataBaseDir: string;
            runtimeRoot: string;
          },
      );
    expect(records).toHaveLength(2);
    for (const [index, version] of ["old", "new"].entries()) {
      const runtimeRoot = join(layout.releasesDir, version, "runtime");
      expect(records[index]).toMatchObject({
        agentArgs: [],
        agentCommand: "",
        bundledAgentEntrypoint: await realpath(join(runtimeRoot, "zcode.cjs")),
        resolvedAgentCommand: await realpath(process.execPath),
        resolvedAgentArgs: [
          await realpath(join(runtimeRoot, "zcode.cjs")),
          "app-server",
          "--stdio",
          ...(version === "new" ? ["--surface", "web"] : []),
        ],
        dataBaseDir: canonicalLayout.dataBaseDir,
        runtimeRoot,
      });
    }
  }, 30_000);
});
