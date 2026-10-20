import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildIsolatedApplicationEnv, getIsolatedApplicationHome } from "@zcode/shared/application-home";

const isolatedHome = getIsolatedApplicationHome();
if (isolatedHome) {
  const clean = buildIsolatedApplicationEnv(process.env);
  for (const key of Object.keys(process.env)) {
    if (!(key in clean)) delete process.env[key];
  }
  Object.assign(process.env, clean);
  // 首启 Chromium 会在 ready 前写 DevToolsActivePort；同步建目录，避免异步 IO
  // 让 Electron 先使用尚不存在的 sessionData，也不吞掉目录权限等启动错误。
  for (const directory of ["userData", "sessionData"]) {
    mkdirSync(join(isolatedHome, "electron", directory), { recursive: true });
  }
}
