import { mkdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export function resolvePortableApplicationHome({ homeDir = homedir(), temporaryRoot = tmpdir(), testHome } = {}) {
  if (!testHome) return join(homeDir, "Library", "Application Support", "ZCode-UI-Lab-Portable");
  if (!isAbsolute(testHome)) throw new Error("Portable test home must be absolute");
  const root = realpathSync(temporaryRoot);
  const requested = resolve(testHome);
  const parent = dirname(requested);
  const name = basename(requested);
  // 验证后才能创建。测试只需临时目录的一个直属专用目录，避免经由嵌套 symlink 写出边界。
  if (![resolve(temporaryRoot), root].includes(parent) ||
      !name.startsWith("zcode-ui-lab-portable-test-")) {
    throw new Error("Portable test home must be a dedicated direct temporary test directory");
  }
  const candidate = join(root, name);
  try { mkdirSync(candidate, { mode: 0o700 }); } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const canonical = realpathSync(candidate);
  if (canonical !== candidate) throw new Error("Portable test home must not be a symbolic link");
  return canonical;
}
