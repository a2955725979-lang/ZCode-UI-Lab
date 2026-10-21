import type { DatabaseSync } from "node:sqlite";
import { projectIdFromWorkspace } from "@zcode/contracts";

interface MigratingSessionRow {
  id: string;
  project_id: string;
  workspace_id: string | null;
  directory: string;
}

const PROJECT_ID_V2 = /^proj_v2_[a-f0-9]{64}$/;

/** 必须由 migration-runner 的 BEGIN IMMEDIATE 包裹；可重跑以修复旧版本回滚后新增的行。 */
export function migrateProjectIdentityV2(db: DatabaseSync): void {
  const sessions = db
    .prepare("select id, project_id, workspace_id, directory from session")
    .all() as unknown as MigratingSessionRow[];
  const updateSession = db.prepare("update session set project_id = ? where id = ?");
  const migratedProjectIDs = new Set<string>();

  for (const session of sessions) {
    if (PROJECT_ID_V2.test(session.project_id)) continue;
    if (
      typeof session.directory !== "string" ||
      session.directory.length === 0 ||
      (session.workspace_id !== null && typeof session.workspace_id !== "string")
    ) {
      throw new Error("Invalid persisted workspace identity during project ID migration");
    }
    const projectID = projectIdFromWorkspace({
      workspacePath: session.directory,
      workspaceIdentity: session.workspace_id ?? undefined,
    });
    updateSession.run(projectID, session.id);
    migratedProjectIDs.add(projectID);
  }

  // 旧 slug 可能碰撞；只有确切指向 session 的历史有足够证据可迁。
  // NULL/悬空 session_id、旧 permission 与 project local_setting 都必须原样留存，
  // 防止把 yolo 或永久允许规则扩散到多个新项目。
  db.exec(`
    update input_history
    set project_id = (
      select session.project_id from session where session.id = input_history.session_id
    )
    where session_id is not null
      and exists (select 1 from session where session.id = input_history.session_id)
      and project_id <> (
        select session.project_id from session where session.id = input_history.session_id
      );
  `);

  // 只不复制旧 yolo 仍会回退到全局 yolo；为确实迁移过的项目补受限 build 默认值。
  // INSERT OR IGNORE 保留用户已经在新 ID 下显式选择的 mode，且重开库不会重复写入。
  const insertRestrictedMode = db.prepare(`
    insert or ignore into local_setting
      (scope, scope_id, namespace, key, value, schema_version, time_created, time_updated)
    values ('project', ?, 'permission', 'mode', '{"mode":"build"}', 1, ?, ?)
  `);
  for (const projectID of migratedProjectIDs) {
    const now = Date.now();
    insertRestrictedMode.run(projectID, now, now);
  }
}
