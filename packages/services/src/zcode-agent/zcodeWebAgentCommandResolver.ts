import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname } from "node:path";
import {
  shouldSpawnInDetachedProcessGroup,
  terminateProcessTree,
} from "../process/processTreeTerminator.js";
import {
  applyZCodeAgentWebSurface,
  resolveDefaultZCodeAgentCommand,
  resolveZCodeAgentCommandCandidate,
  type ZCodeAgentCommand,
  type ZCodeAgentCommandCandidate,
  type ZCodeAgentCommandResolver,
} from "./zcodeAgentProcessManager.js";

const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 128 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 5_000;
const MAX_CACHE_ENTRIES = 32;

interface WebAgentResolverOptions {
  /** Core 从自身 ESM 文件同目录解析的内置入口，不能来自客户端或外部覆盖 env。 */
  bundledAgentEntrypoint?: string;
  probeTimeoutMs?: number;
}

function probeEnvironment(command: ZCodeAgentCommand): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // 不继承 NODE_OPTIONS、账号、遥测或 Provider 凭据；只保留进程运行所需环境。
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  // 当前受控命令只需要这一项；未来的 command.env 不自动成为 probe 的账号入口。
  if (command.env?.ELECTRON_RUN_AS_NODE === "1") env.ELECTRON_RUN_AS_NODE = "1";
  return env;
}

async function artifactIdentity(candidate: ZCodeAgentCommandCandidate): Promise<string | null> {
  const entrypoint = candidate.bundledEntrypoint;
  if (!entrypoint || candidate.command.args?.[0] !== entrypoint) return null;
  const [entry, runtime, entryDirectory] = await Promise.all([
    realpath(entrypoint),
    realpath(candidate.command.command),
    realpath(dirname(entrypoint)),
  ]);
  if (dirname(entry) !== entryDirectory) return null;
  const [entryStat, runtimeStat] = await Promise.all([
    stat(entry, { bigint: true }),
    stat(runtime, { bigint: true }),
  ]);
  if (!entryStat.isFile() || !runtimeStat.isFile() || entryStat.size > MAX_BUNDLE_BYTES)
    return null;
  const bytes = await readFile(entry, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  return JSON.stringify([
    entry,
    createHash("sha256").update(bytes).digest("hex"),
    String(entryStat.ino),
    String(entryStat.mtimeNs),
    String(entryStat.ctimeNs),
    runtime,
    String(runtimeStat.dev),
    String(runtimeStat.ino),
    String(runtimeStat.size),
    String(runtimeStat.mtimeNs),
    String(runtimeStat.ctimeNs),
    candidate.command.env?.ELECTRON_RUN_AS_NODE === "1",
  ]);
}

function probeWebSurface(
  candidate: ZCodeAgentCommandCandidate,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const command = candidate.command;
    const detached = shouldSpawnInDetachedProcessGroup();
    // version 在解析 surface 后、app-server 启动前返回；prepare-storage 跳过入口预热。
    const child = spawn(
      command.command,
      [
        candidate.bundledEntrypoint!,
        "app-server",
        "--surface",
        "web",
        "--version",
        "--prepare-storage",
      ],
      {
        cwd: dirname(candidate.bundledEntrypoint!),
        detached,
        env: probeEnvironment(command),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let settled = false;
    let outputBytes = 0;
    let stdout = "";
    const finish = (supported: boolean, stop = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stop) {
        terminateProcessTree(child, {
          forceAfterMs: 0,
          ...(detached && child.pid ? { ownedProcessGroupId: child.pid } : {}),
        });
      }
      resolve(supported);
    };
    const timer = setTimeout(() => finish(false, true), timeoutMs);
    const collect = (chunk: Buffer, isStdout: boolean): void => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_PROBE_OUTPUT_BYTES) finish(false, true);
      else if (isStdout) stdout += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.once("error", () => finish(false));
    child.once("close", (code) =>
      finish(code === 0 && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/u.test(stdout.trim())),
    );
  });
}

/** 只供 standalone Web 装配；Desktop 继续使用同步默认 resolver。 */
export function createStandaloneWebZCodeAgentCommandResolver(
  options: WebAgentResolverOptions = {},
): ZCodeAgentCommandResolver {
  const confirmations = new Map<string, Promise<boolean>>();
  const timeoutMs = Math.min(
    PROBE_TIMEOUT_MS,
    Math.max(50, options.probeTimeoutMs ?? PROBE_TIMEOUT_MS),
  );
  return async (context) => {
    if (context.presentationSurface !== "web") return resolveDefaultZCodeAgentCommand(context);
    let candidate: ZCodeAgentCommandCandidate | null;
    // 显式覆盖始终走原分支；不会把任意 env command 当作同目录内置 CLI 探测。
    if (!process.env.ZCODE_AGENT_SERVER_COMMAND?.trim() && options.bundledAgentEntrypoint) {
      candidate = {
        bundledEntrypoint: options.bundledAgentEntrypoint,
        command: {
          command: process.execPath,
          args: [options.bundledAgentEntrypoint, "app-server", "--stdio"],
          cwd: context.workspacePath,
        },
      };
    } else {
      candidate = resolveZCodeAgentCommandCandidate(context);
    }
    if (!candidate) return null;
    if (!candidate.bundledEntrypoint) return candidate.command;
    const controlledCandidate = candidate;
    try {
      const identity = await artifactIdentity(controlledCandidate);
      if (!identity) return applyZCodeAgentWebSurface(candidate.command, false);
      // source-tsx 还有传递源码依赖，不按 main.ts 的单文件身份缓存结果。
      const cacheable = extname(candidate.bundledEntrypoint) !== ".ts";
      let confirmation = cacheable ? confirmations.get(identity) : undefined;
      if (!confirmation) {
        confirmation = (async () => {
          const supported = await probeWebSurface(controlledCandidate, timeoutMs);
          return supported && (await artifactIdentity(controlledCandidate)) === identity;
        })().catch(() => false);
        if (cacheable) {
          if (confirmations.size >= MAX_CACHE_ENTRIES)
            confirmations.delete(confirmations.keys().next().value!);
          confirmations.set(identity, confirmation);
        }
      }
      return applyZCodeAgentWebSurface(candidate.command, await confirmation);
    } catch {
      return applyZCodeAgentWebSurface(candidate.command, false);
    }
  };
}
