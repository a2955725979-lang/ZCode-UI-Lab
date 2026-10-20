import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const options = Object.fromEntries(process.argv.slice(2).map(value => {
  const index = value.indexOf("=");
  if (index < 1) throw new Error("Expected --source=PATH --output=PATH");
  return [value.slice(0, index), value.slice(index + 1)];
}));
const source = resolve(options["--source"] || "");
const output = resolve(options["--output"] || "");
if (!options["--source"] || !options["--output"]) throw new Error("Missing source/output");
const markerPath = join(source, ".zcode-ui-lab-portable-build-staging.json");
if (!existsSync(markerPath) || JSON.parse(readFileSync(markerPath, "utf8")).purpose !== "zcode-ui-lab-portable-disposable-build") {
  throw new Error("Build requires a disposable marked staging clone; use stage-portable.mjs first");
}
const desktop = join(source, "packages/desktop");
const application = join(desktop, "portable-package-app");
if (existsSync(application)) throw new Error("Refuse to overwrite existing package staging");
mkdirSync(application, { recursive: true });
mkdirSync(output, { recursive: true });
const packagingRoot = dirname(fileURLToPath(import.meta.url));
const clone = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  execFileSync("/bin/cp", ["-cR", from, to]);
};
const productPackage = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const roots = Object.entries(productPackage.dependencies)
  .filter(([name, version]) => version !== "workspace:*" && !["react", "react-dom"].includes(name) && !name.startsWith("@lydell/"))
  .map(([name]) => name);
const { collectRuntimeModuleClosureEntries } = await import(pathToFileURL(join(desktop, "scripts/runtime-dependency-closure.mjs")));
const closure = collectRuntimeModuleClosureEntries(roots, [desktop, source]);
if (closure.some(item => !item.sourceModulePath)) throw new Error("Missing runtime dependency");
for (const entry of closure) clone(entry.sourceModulePath, join(application, "node_modules", entry.moduleName));
const whitelist = ["main", "host", "preload", "renderer", "plugin-sandbox", "scheduler", "metadata"];
for (const entry of whitelist) clone(join(desktop, "out", entry), join(application, "out", entry));
for (const name of ["portable-bootstrap.mjs", "portable-home.mjs"]) cpSync(join(packagingRoot, name), join(application, name));
const dependencies = Object.fromEntries(roots.map(name => [name,
  JSON.parse(readFileSync(join(application, "node_modules", name, "package.json"), "utf8")).version]));
writeFileSync(join(application, "package.json"), JSON.stringify({
  name: "zcode-ui-lab-portable", version: "3.15.1", private: true, type: "module",
  description: "Unofficial isolated ZCode UI Lab Portable", author: "ZCode UI Lab custom build",
  main: "portable-bootstrap.mjs", dependencies,
}, null, 2) + "\n");
// 与既有 producer 规范一致：占位开源构建没有 CUA 插件，也不应要求其 Koffi 产物。
const originalConfigPath = join(desktop, "electron-builder.config.js");
const originalConfig = readFileSync(originalConfigPath, "utf8");
const koffiFunction = "function assertPackagedCuaKoffi(context) {";
if (!originalConfig.includes(`${koffiFunction}\n  if (!shouldPackageComputerUseHelper) return;`)) {
  if (originalConfig.split(koffiFunction).length !== 2) throw new Error("Unexpected CUA validation config");
  writeFileSync(originalConfigPath, originalConfig.replace(koffiFunction,
    `${koffiFunction}\n  if (!shouldPackageComputerUseHelper) return;`));
}
const configPath = join(desktop, "portable-electron-builder.config.js");
writeFileSync(configPath, `import original from "./electron-builder.config.js";\nimport { cpSync } from "node:fs";\nimport { join } from "node:path";\nexport default {\n ...original,\n appId: "dev.zcode.app.ui-lab.portable", productName: "ZCode UI Lab Portable",\n directories: { ...original.directories, app: "portable-package-app", output: ${JSON.stringify(output)} },\n electronDist: ${JSON.stringify(join(source, "node_modules/electron/dist"))},\n extraMetadata: { ...original.extraMetadata, main: "portable-bootstrap.mjs", name: "zcode-ui-lab-portable", zcodeProductFlavor: "ui-lab-portable" },\n protocols: [], publish: [],\n files: [...original.files, "portable-bootstrap.mjs", "portable-home.mjs"],\n extraResources: [...original.extraResources, { from: ${JSON.stringify(join(source, "LICENSE"))}, to: "LICENSE" }, { from: ${JSON.stringify(join(source, "NOTICE.md"))}, to: "NOTICE.md" }],\n afterExtract: async context => {\n  for (const name of ["LICENSE", "LICENSES.chromium.html"]) cpSync(join(${JSON.stringify(join(source, "node_modules/electron/dist"))}, name), join(context.appOutDir, name));\n  await original.afterExtract(context);\n },\n mac: { ...original.mac, target: ["zip"], identity: null, notarize: false, hardenedRuntime: false, artifactName: "ZCode-UI-Lab-Portable-3.15.1-mac-arm64.zip" },\n};\n`);
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
writeFileSync(join(output, "packaging-inputs.json"), JSON.stringify({
  product: "ZCode UI Lab Portable", version: "3.15.1", platform: "darwin-arm64", outDirectories: whitelist,
  runtimeDependencyCount: closure.length, runtimeDependencies: closure.map(item => ({name: item.moduleName,
    version: JSON.parse(readFileSync(join(item.sourceModulePath, "package.json"), "utf8")).version})),
  coreEntrySha256: Object.fromEntries(["main/index.js", "host/index.js", "scheduler/index.js", "renderer/index.html"].map(name => [name, hash(join(application, "out", name))])),
  bootstrapSha256: hash(join(application, "portable-bootstrap.mjs")),
  defaultDataDirectory: "~/Library/Application Support/ZCode-UI-Lab-Portable",
  signedWithDeveloperID: false, notarized: false,
}, null, 2) + "\n");
console.log(`Prepared ${closure.length} runtime dependency packages; building arm64 directory`);
execFileSync(process.execPath, [join(source, "node_modules/electron-builder/cli.js"), "--config", configPath, "--mac", "--arm64", "--dir", "--publish", "never"], {
  cwd: desktop, stdio: "inherit", env: { ...process.env, ZCODE_ENV: "production", ZCODE_PREVIEW_IDENTITY: "1",
    ZCODE_TARGET_OS: "mac", ZCODE_TARGET_ARCH: "arm64", CSC_IDENTITY_AUTO_DISCOVERY: "false", ZCODE_ENABLE_MAC_SIGN: "0" },
});
