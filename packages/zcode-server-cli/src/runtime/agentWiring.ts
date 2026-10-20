import { realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Core 自己定位当前 release 的 CLI，不把自动内置来源混入外部 command env。 */
export async function resolveCoreBundledAgentEntrypoint(
  entryDir: string,
  env: Record<string, string | undefined>,
): Promise<string | undefined> {
  if (env.ZCODE_AGENT_SERVER_COMMAND?.trim()) return undefined;
  try {
    const [directory, entrypoint] = await Promise.all([
      realpath(entryDir),
      realpath(join(entryDir, "zcode.cjs")),
    ]);
    // 不认领指向发行目录外的同名 symlink 为内置来源。
    if (dirname(entrypoint) !== directory || !(await stat(entrypoint)).isFile()) return undefined;
    return entrypoint;
  } catch {
    // 开发态没有同目录 bundle，保留 monorepo resolver；任何未知状态不放行 web。
    return undefined;
  }
}
