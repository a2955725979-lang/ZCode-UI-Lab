import { createHash } from "node:crypto";
import type { SessionInfo } from "@zcode/contracts";
import {
  buildZCodeTaskSearchableText,
  zcodeTaskIndexReadPersistedSearchPageParamsSchema,
  zcodeTaskIndexReadPersistedSearchPageResultSchema,
} from "@zcode/shared";
import { TASK_LIST_SESSION_TYPES } from "../zcode-protocol-v4/task-list-session-membership.js";
import { loadPersistedConversationMaterialization } from "../zcode-protocol-v4/cold-event-merge.js";
import { mapMessageWithParts } from "./message-mapper.js";
import {
  parseParams,
  ProtocolRequestError,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

function workspaceKey(input: { workspacePath: string; workspaceIdentity?: string }): string {
  return input.workspaceIdentity?.trim() || input.workspacePath;
}

function matchesWorkspace(session: SessionInfo, key: string): boolean {
  return (session.workspaceID?.trim() || session.path || session.directory) === key;
}

function encodeCursor(scope: string, sessionId: string): string {
  const scopeHash = createHash("sha256").update(scope).digest("hex").slice(0, 16);
  return Buffer.from(JSON.stringify([scopeHash, sessionId])).toString("base64url");
}

function decodeCursor(scope: string, cursor: string): string {
  try {
    const [scopeHash, sessionId] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as unknown[];
    if (
      scopeHash === createHash("sha256").update(scope).digest("hex").slice(0, 16) &&
      typeof sessionId === "string" &&
      sessionId.length > 0
    ) {
      return sessionId;
    }
  } catch {
    // 错误游标不能被当作第一页；否则 Host 会误以为索引已完成。
  }
  throw new ProtocolRequestError(-32602, "Invalid persisted task search cursor");
}

/** 冷索引只读持久会话；不 resume runtime，也不调用模型。 */
export async function readPersistedTaskSearchPage(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
) {
  const params = parseParams(zcodeTaskIndexReadPersistedSearchPageParamsSchema, rawParams);
  const store = context.deps.sessionStore;
  if (!store)
    throw new ProtocolRequestError(-32003, "Session store is unavailable for task search");
  const scope = workspaceKey(params);
  const afterId = params.cursor ? decodeCursor(scope, params.cursor) : undefined;
  // SessionStore 的旧接口不支持 keyset；此处先完整枚举身份，再仅物化当前页的正文。
  const sessions = (
    await store.listSessions({
      includeArchived: true,
      taskTypes: [...TASK_LIST_SESSION_TYPES],
    })
  )
    .filter((session) => matchesWorkspace(session, scope))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const remaining = afterId
    ? sessions.filter((session) => String(session.id).localeCompare(afterId) > 0)
    : sessions;
  const page = remaining.slice(0, params.limit);
  const items = await Promise.all(
    page.map(async (listed) => {
      const current = await store.getSession(listed.id);
      if (!current || !matchesWorkspace(current, scope)) {
        throw new ProtocolRequestError(-32004, "Persisted task changed workspace during search");
      }
      const source = await loadPersistedConversationMaterialization({
        memoryEvents: [],
        sessionId: String(current.id),
        store,
      });
      const searchableText = buildZCodeTaskSearchableText(source.messages.map(mapMessageWithParts));
      const sourceRevision = createHash("sha256")
        .update(
          JSON.stringify({
            id: current.id,
            updated: current.time.updated,
            revert: current.revert,
            messages: source.messages.map((message) => ({
              id: message.info.id,
              time: message.info.time,
              text: message.parts
                .filter((part) => part.type === "text")
                .map((part) => [part.id, part.text]),
            })),
          }),
        )
        .digest("hex");
      return { sessionId: String(current.id), sourceRevision, searchableText };
    }),
  );
  const complete = remaining.length <= page.length;
  const nextCursor =
    !complete && page.length > 0 ? encodeCursor(scope, String(page.at(-1)!.id)) : undefined;
  return zcodeTaskIndexReadPersistedSearchPageResultSchema.parse({ items, nextCursor, complete });
}
