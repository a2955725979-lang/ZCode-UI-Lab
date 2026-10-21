import { createHash } from "node:crypto";
import type { ProjectId } from "./interfaces/shared.js";

const PROJECT_ID_VERSION_PREFIX = "proj_v2_";

/** 与 workspaceKey 共用同一份不透明身份输入，完整 UTF-8 内容参与摘要。 */
export function projectIdFromWorkspace(input: {
  workspacePath: string;
  workspaceIdentity?: string;
}): ProjectId {
  const identity = input.workspaceIdentity?.trim() || input.workspacePath;
  // 旧 slug 会截断长路径并抹掉中文；项目权限因此可能跨目录串用。
  // 全量哈希保留这些差异，版本前缀阻止旧权限 key 被新项目误读。
  const digest = createHash("sha256").update(identity, "utf8").digest("hex");
  return `${PROJECT_ID_VERSION_PREFIX}${digest}` as ProjectId;
}
