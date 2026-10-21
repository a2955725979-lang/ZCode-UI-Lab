import { z } from "zod";

/** 仅供 Host 冷历史索引使用；游标和正文均有明确上界。 */
export const zcodeTaskIndexReadPersistedSearchPageParamsSchema = z
  .object({
    workspacePath: z.string().trim().min(1),
    workspaceIdentity: z.string().trim().min(1).optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(64).default(32),
  })
  .strict();

export const zcodeTaskIndexReadPersistedSearchPageResultSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            sessionId: z.string().min(1),
            sourceRevision: z.string().regex(/^[a-f0-9]{64}$/u),
            searchableText: z.string().max(200_000),
          })
          .strict(),
      )
      .max(64),
    nextCursor: z.string().min(1).max(512).optional(),
    complete: z.boolean(),
  })
  .strict();

export type ZCodeTaskIndexReadPersistedSearchPageParams = z.infer<
  typeof zcodeTaskIndexReadPersistedSearchPageParamsSchema
>;
export type ZCodeTaskIndexReadPersistedSearchPageResult = z.infer<
  typeof zcodeTaskIndexReadPersistedSearchPageResultSchema
>;
