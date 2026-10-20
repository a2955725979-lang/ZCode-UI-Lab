import { appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const generation = Number(process.argv[2] ?? 0);
const outputPath = process.env.ZCODE_TEST_WIRING_OUTPUT;
if (!outputPath) throw new Error("ZCODE_TEST_WIRING_OUTPUT is required");
const { resolveCoreBundledAgentEntrypoint } = await import(
  process.env.ZCODE_TEST_AGENT_WIRING_MODULE
);
const bundledAgentEntrypoint = await resolveCoreBundledAgentEntrypoint(
  dirname(fileURLToPath(import.meta.url)),
  process.env,
);
const { createStandaloneWebZCodeAgentCommandResolver } = await import(
  process.env.ZCODE_TEST_WEB_RESOLVER_MODULE
);
const resolveCommand = createStandaloneWebZCodeAgentCommandResolver({ bundledAgentEntrypoint });
const resolvedAgentCommand = await resolveCommand({
  presentationSurface: "web",
  workspacePath: dirname(fileURLToPath(import.meta.url)),
  workspaceKey: "controlled-release-fixture",
});

await appendFile(
  outputPath,
  `${JSON.stringify({
    agentArgs: JSON.parse(process.env.ZCODE_AGENT_SERVER_ARGS_JSON?.trim() || "[]"),
    agentCommand: process.env.ZCODE_AGENT_SERVER_COMMAND ?? null,
    bundledAgentEntrypoint,
    resolvedAgentCommand: resolvedAgentCommand?.command,
    resolvedAgentArgs: resolvedAgentCommand?.args,
    dataBaseDir: process.env.ZCODE_DATA_BASE_DIR ?? null,
    generation,
    runtimeRoot: process.env.ZCODE_SERVER_RUNTIME_ROOT ?? null,
  })}\n`,
  "utf8",
);

process.send?.({
  type: "ready",
  host: "127.0.0.1",
  port: 43123 + generation,
  version: "fixture",
  generation,
});

process.on("message", (message) => {
  if (typeof message === "object" && message !== null && message.command === "shutdown") {
    process.send?.({ type: "shutdown-ack" });
    process.send?.({ type: "exit", reason: "requested" }, () => process.exit(0));
  }
});
