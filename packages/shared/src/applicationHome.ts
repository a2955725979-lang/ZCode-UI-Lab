/** Node-only application paths for opt-in local UI previews. */
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const ZCODE_APPLICATION_HOME_ENV = "ZCODE_APPLICATION_HOME";

function canonicalPath(path: string): string {
  // Bootstrap runs before Electron ready; resolve the nearest existing ancestor
  // so a new root and a symlink alias obey the same production-data boundary.
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(canonicalPath(parent), relative(parent, path));
  }
}

function isInside(path: string, root: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

/** Explicit application home, never a replacement for the process OS identity. */
export function getIsolatedApplicationHome(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const requested = env[ZCODE_APPLICATION_HOME_ENV]?.trim();
  if (!requested) return undefined;
  if (!isAbsolute(requested)) throw new Error(`${ZCODE_APPLICATION_HOME_ENV} must be absolute`);
  const root = canonicalPath(resolve(requested));
  const systemHome = canonicalPath(homedir());
  if (root === systemHome || [".zcode", ".agents", ".claude"].some((name) =>
    isInside(root, canonicalPath(join(systemHome, name))),
  )) {
    throw new Error(`${ZCODE_APPLICATION_HOME_ENV} must be separate from production user data`);
  }
  return root;
}

/** Global application content home. Normal launches retain their current home defaults. */
export function getApplicationHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  fallbackHome: string = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir(),
): string {
  return getIsolatedApplicationHome(env) || fallbackHome;
}

const PROCESS_ENV_KEYS = new Set([
  "HOME", "USERPROFILE", "USER", "LOGNAME", "PATH", "PATHEXT", "SHELL",
  "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG", "TERM",
  "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "__CF_USER_TEXT_ENCODING",
  "ELECTRON_RENDERER_URL", "ZCODE_ENV", "ZCODE_RUNTIME_ENV", "ZCODE_APP_VERSION",
  "ZCODE_BUILD_COMMIT_ID",
]);

/** Narrow launch inheritance; configuration pointers and credentials are never copied. */
export function buildIsolatedApplicationEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const root = getIsolatedApplicationHome(env);
  if (!root) return { ...env };
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (PROCESS_ENV_KEYS.has(key.toUpperCase()) || /^LC_[A-Z0-9_]+$/i.test(key)) clean[key] = value;
  }
  return {
    ...clean,
    [ZCODE_APPLICATION_HOME_ENV]: root,
    ZCODE_DATA_BASE_DIR: root,
    ZCODE_DESKTOP_HOME_DIR: root,
    ZCODE_HOME: join(root, ".zcode"),
    ZCODE_STORAGE_DIR: join(root, ".zcode"),
    ZCODE_DESKTOP_APPLICATION_NAME: "ZCode UI Lab",
    ZCODE_DESKTOP_USER_DATA_DIR: join(root, "electron", "userData"),
    ZCODE_DESKTOP_SESSION_DATA_DIR: join(root, "electron", "sessionData"),
    ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
    ZCODE_AUTO_UPDATE: "0",
    ZCODE_AUTO_UPDATE_DEV: "0",
    ZCODE_ARMS_RUM_ENDPOINT: "",
    ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
  };
}
