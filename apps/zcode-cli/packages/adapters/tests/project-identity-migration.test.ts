import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { projectIdFromWorkspace, type SessionId } from "@zcode/contracts";
import { createSqliteSessionStore } from "../src/storage/index.js";

const roots: string[] = [];
const legacyProjectID = `proj_${"a".repeat(80)}`;
const longPrefix = `/workspace/${"a".repeat(100)}`;
const firstPath = `${longPrefix}/中文/甲`;
const secondPath = `${longPrefix}/中文/乙`;
const remoteIdentity = "remote:host-one:repo";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function legacyFixture() {
  const root = await mkdtemp(join(tmpdir(), "zcode-project-id-migration-"));
  roots.push(root);
  const dbPath = join(root, "session.sqlite");
  createSqliteSessionStore({ dbPath }).close();
  const db = new DatabaseSync(dbPath);
  // 当前 schema 已建好；撤销 v2 账本后灌入升级前旧 key，模拟真实旧库。
  db.prepare("delete from schema_migration where id = ?").run("0023_project_identity_v2");
  const insertSession = db.prepare(
    `insert into session
      (id, project_id, workspace_id, slug, directory, title, version, permission, time_created, time_updated)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSession.run(
    "sess_first",
    legacyProjectID,
    null,
    "first",
    firstPath,
    "First",
    "old",
    '{"mode":"yolo"}',
    1,
    1,
  );
  insertSession.run(
    "sess_second",
    legacyProjectID,
    null,
    "second",
    secondPath,
    "Second",
    "old",
    '{"mode":"plan"}',
    2,
    2,
  );
  insertSession.run(
    "sess_remote",
    legacyProjectID,
    remoteIdentity,
    "remote",
    firstPath,
    "Remote",
    "old",
    '{"mode":"build"}',
    3,
    3,
  );
  const insertHistory = db.prepare(
    `insert into input_history (id, project_id, session_id, text, kind, time_created)
     values (?, ?, ?, ?, 'prompt', ?)`,
  );
  insertHistory.run("input_first", legacyProjectID, "sess_first", "first text", 10);
  insertHistory.run("input_second", legacyProjectID, "sess_second", "second text", 11);
  insertHistory.run("input_remote", legacyProjectID, "sess_remote", "remote text", 12);
  insertHistory.run("input_null", legacyProjectID, null, "unattributed text", 13);
  insertHistory.run("input_orphan", legacyProjectID, "sess_missing", "orphan text", 14);
  db.prepare(
    "insert into permission (project_id, time_created, time_updated, data) values (?, 1, 1, ?)",
  ).run(legacyProjectID, '{"version":1,"allow":[{"toolName":"Bash"}]}');
  db.prepare(
    `insert into local_setting
      (scope, scope_id, namespace, key, value, schema_version, time_created, time_updated)
     values ('project', ?, 'permission', 'mode', '{"mode":"yolo"}', 1, 1, 1)`,
  ).run(legacyProjectID);
  db.close();
  return dbPath;
}

describe("project identity v2 SQLite migration", () => {
  it("migrates exact session and linked history identity without widening legacy permissions", async () => {
    const dbPath = await legacyFixture();
    const first = projectIdFromWorkspace({ workspacePath: firstPath });
    const second = projectIdFromWorkspace({ workspacePath: secondPath });
    const remote = projectIdFromWorkspace({
      workspacePath: firstPath,
      workspaceIdentity: remoteIdentity,
    });
    const store = createSqliteSessionStore({ dbPath });
    expect(new Set([first, second, remote]).size).toBe(3);
    expect((await store.getSession("sess_first" as SessionId))?.projectID).toBe(first);
    expect((await store.getSession("sess_second" as SessionId))?.projectID).toBe(second);
    expect((await store.getSession("sess_remote" as SessionId))?.projectID).toBe(remote);
    expect((await store.getSession("sess_first" as SessionId))?.permission?.mode).toBe("yolo");
    expect((await store.getSession("sess_second" as SessionId))?.permission?.mode).toBe("plan");
    expect((await store.recallPreviousInputHistory({ projectID: first }))?.text).toBe("first text");
    expect((await store.recallPreviousInputHistory({ projectID: second }))?.text).toBe(
      "second text",
    );
    expect((await store.recallPreviousInputHistory({ projectID: remote }))?.text).toBe(
      "remote text",
    );
    expect(await store.getProjectPermission(first)).toBeNull();
    expect(store.getProjectPermissionMode(first)).toBe("build");
    expect(await store.getProjectPermission(second)).toBeNull();
    expect(store.getProjectPermissionMode(second)).toBe("build");
    expect(store.getProjectPermissionMode(remote)).toBe("build");
    store.saveProjectPermissionMode({ projectID: first, mode: "yolo" });
    store.close();

    const db = new DatabaseSync(dbPath);
    const histories = db
      .prepare(
        "select id, project_id, session_id, text, time_created from input_history order by id",
      )
      .all() as Array<{
      id: string;
      project_id: string;
      session_id: string | null;
      text: string;
      time_created: number;
    }>;
    expect(histories).toHaveLength(5);
    expect(histories.find((row) => row.id === "input_null")?.project_id).toBe(legacyProjectID);
    expect(histories.find((row) => row.id === "input_orphan")?.project_id).toBe(legacyProjectID);
    expect(histories.map((row) => row.text)).toEqual([
      "first text",
      "unattributed text",
      "orphan text",
      "remote text",
      "second text",
    ]);
    expect(
      (
        db
          .prepare("select count(*) as count from permission where project_id = ?")
          .get(legacyProjectID) as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        db
          .prepare(
            "select count(*) as count from local_setting where scope = 'project' and scope_id = ?",
          )
          .get(legacyProjectID) as { count: number }
      ).count,
    ).toBeGreaterThan(0);
    db.close();

    createSqliteSessionStore({ dbPath }).close();
    const reopened = new DatabaseSync(dbPath);
    expect(
      (reopened.prepare("select count(*) as count from input_history").get() as { count: number })
        .count,
    ).toBe(5);
    expect(
      (
        reopened
          .prepare(
            "select count(*) as count from schema_migration where id = '0023_project_identity_v2'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    reopened
      .prepare(
        `insert into session (id, project_id, slug, directory, title, version, time_created, time_updated)
       values ('sess_late', ?, 'late', ?, 'Late', 'old', 20, 20)`,
      )
      .run(legacyProjectID, secondPath);
    reopened
      .prepare(
        `insert into input_history (id, project_id, session_id, text, kind, time_created)
       values ('input_late', ?, 'sess_late', 'late text', 'prompt', 20)`,
      )
      .run(legacyProjectID);
    reopened.close();

    // 用户回滚到旧版后又写入旧 slug，已记账的 0023 在再次升级时仍会幂等补迁。
    createSqliteSessionStore({ dbPath }).close();
    const afterRollbackWrite = new DatabaseSync(dbPath);
    expect(
      (
        afterRollbackWrite
          .prepare("select project_id from session where id = 'sess_late'")
          .get() as { project_id: string }
      ).project_id,
    ).toBe(second);
    expect(
      (
        afterRollbackWrite
          .prepare("select project_id from input_history where id = 'input_late'")
          .get() as { project_id: string }
      ).project_id,
    ).toBe(second);
    expect(
      (
        afterRollbackWrite
          .prepare(
            "select count(*) as count from schema_migration where id = '0023_project_identity_v2'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        afterRollbackWrite
          .prepare(
            "select value from local_setting where scope = 'project' and scope_id = ? and namespace = 'permission' and key = 'mode'",
          )
          .get(first) as { value: string }
      ).value,
    ).toBe('{"mode":"yolo"}');
    afterRollbackWrite.close();
  });

  it("rolls back session and history changes together when a persisted path is invalid", async () => {
    const dbPath = await legacyFixture();
    const malformed = new DatabaseSync(dbPath);
    malformed
      .prepare("update session set directory = ? where id = 'sess_second'")
      .run(new Uint8Array([0, 1, 2]));
    malformed.close();

    expect(() => createSqliteSessionStore({ dbPath })).toThrow();
    const db = new DatabaseSync(dbPath);
    expect(
      (
        db.prepare("select project_id from session where id = 'sess_first'").get() as {
          project_id: string;
        }
      ).project_id,
    ).toBe(legacyProjectID);
    expect(
      (
        db.prepare("select project_id from input_history where id = 'input_first'").get() as {
          project_id: string;
        }
      ).project_id,
    ).toBe(legacyProjectID);
    expect(
      (
        db
          .prepare(
            "select count(*) as count from schema_migration where id = '0023_project_identity_v2'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(0);
    db.close();
  });
});
