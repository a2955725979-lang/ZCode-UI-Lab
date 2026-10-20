import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const options = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf("=");
  if (index < 1) throw new Error("Expected --source=PATH --work=PATH --output=PATH");
  return [value.slice(0, index), value.slice(index + 1)];
}));
if (!["--source", "--work", "--output"].every(key => options[key])) throw new Error("Missing source/work/output");
// 先按真实祖先解析新路径，防止符号链接别名把制作目录带回输入仓库。
function canonicalFuturePath(value) {
  try { return realpathSync(value); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(value);
    if (parent === value) throw error;
    return join(canonicalFuturePath(parent), relative(parent, value));
  }
}
const source = realpathSync(resolve(options["--source"]));
const work = canonicalFuturePath(resolve(options["--work"]));
const output = canonicalFuturePath(resolve(options["--output"]));
for (const candidate of [work, output]) {
  const suffix = relative(source, candidate);
  if (suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`))) {
    throw new Error("Work and output must stay outside the input source directory");
  }
}
if (existsSync(work)) throw new Error("Refuse to overwrite an existing working directory");
if (existsSync(output)) throw new Error("Refuse to overwrite an existing output directory");
mkdirSync(work, { recursive: true });
const stage = join(work, "source");
execFileSync("/bin/cp", ["-cR", source, stage], { stdio: "inherit" });
writeFileSync(join(stage, ".zcode-ui-lab-portable-build-staging.json"), JSON.stringify({
  schemaVersion: 1, purpose: "zcode-ui-lab-portable-disposable-build",
}) + "\n");
execFileSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "build-portable.mjs"),
  `--source=${stage}`, `--output=${output}`], { stdio: "inherit" });
