import { runServerCli } from "./cli.js";

void runServerCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  confirm: async (prompt) => {
    process.stdout.write(prompt);
    return await new Promise<string>((resolve) => {
      process.stdin.once("data", (chunk) => resolve(String(chunk).trim()));
    });
  },
}).then((exitCode) => {
  process.exitCode = exitCode;
});
