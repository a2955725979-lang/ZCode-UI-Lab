# Project identity v2 与旧库迁移

## 产品规则

`workspaceIdentity` 是身份隔离键，`workspacePath` 只用于文件操作和路径展示。唯一身份输入为 `workspaceIdentity?.trim() || workspacePath`。本地调用未提供 identity 时使用入口的 workspace 路径；远端调用必须使用其不透明 identity，不能按相同路径合并。Core、Bootstrap 和 SQLite 迁移只调用 Contracts 提供的同一个纯函数，不各自实现 slug。

`ProjectId` v2 为 `proj_v2_` 加上完整身份输入 UTF-8 字节的 SHA-256 十六进制摘要。哈希前不做小写、截断、ASCII 化或路径分隔符替换；调用方负责提供已确定的入口身份。版本前缀用于与旧 `proj_<slug>` 区分。输入路径的表示与现有 workspace key 规则一致，因此有无末尾分隔符是不同身份，除非上游原本已规范化。Bash 中途 `cd` 不改变项目身份。

## 状态所有者与顺序

```text
入口 workspace identity/path
  -> Contracts project ID 函数
  -> Bootstrap 启动项目偏好、Core session/runtime、Input History
  -> Adapter SQLite 持久化

旧库打开 -> SQLite BEGIN IMMEDIATE -> schema migration + project ID 数据迁移
        -> schema_migration 记账 -> COMMIT -> Runtime/协议可见
```

Adapter 是迁移唯一写入者。`0023` 只记一次账；数据修复在每次启动事务中幂等检查仍为旧格式的行，以处理用户回滚到旧版后再次写入的记录。多进程启动由 `BEGIN IMMEDIATE` 串行。失败必须整体回滚且禁止交付未迁移的 store。旧的已应用 migration SQL/checksum 不修改。

## 旧数据裁决

| 数据                                      | 可用证据                                                                     | 处理                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `session.project_id`                      | 该行 `workspace_id` 非空时为 workspace identity；否则 `directory` 为本地路径 | 按完整身份生成 v2 ID 并原地更新；保留 `directory`、`workspace_id` 和会话级权限。                        |
| `input_history.project_id`                | `session_id` 指向现存 session                                                | 跟随该 session 的目标 ID；不删除、不重建历史行，数量与顺序保持。                                        |
| `input_history.project_id`                | `session_id` 为 NULL 或悬空                                                  | 旧 ID 留存；不根据旧 slug 或文本猜测归属。新项目召回不会读取它。                                        |
| `permission.project_id`                   | 只有旧 slug，没有目录或 identity                                             | 留存供旧版本回滚，不复制到 v2 ID。                                                                      |
| `local_setting(scope='project').scope_id` | 只有旧 slug，包含项目 mode/ruleset                                           | 原记录留存，不复制旧值；每个迁移到 v2 的项目若尚无新 mode，则写入受限的 `build` 模式。其他 scope 不改。 |

旧 slug 可能由多个目录或远端 identity 共享。项目级 `yolo`、允许规则和其他高权限设置不可安全反推归属；每个被迁移项目写入新 ID 的 `build` 模式，阻断全局 `yolo` 默认值意外兜底。若该新 ID 已有用户显式设置，则不覆盖。旧记录只可由旧 ID 精确读取，不能做前缀、slug 或 fallback 查询。会话级持久权限与模式属于有精确 session 归属的记录，冷恢复继续按既有优先级读取；迁移不抹掉会话自己的 mode，也不把旧项目 mode 当作新的会话 mode。

## 验收场景

1. 两个路径前 80 个 slug 字符相同，以及中文路径与长路径，都得到稳定且不同的 v2 ID；同一路径本地生成器一致。
2. 相同远端路径、不同 workspace identity 得到不同 ID；本地与远端同路径不相同。
3. 旧会话迁移后仍可按 ID 冷恢复，会话级 mode 不变；其关联历史的行数、文本、时间和顺序不变。
4. NULL 或悬空 `session_id` 的历史行留存但不出现在新身份召回中。
5. 一个旧 slug 对应多个新身份时，旧 `permission` 与旧 project `local_setting` 不复制到任一新身份；旧记录本身保留。迁移得到的新项目仅新增受限的 `build` mode，不能因全局默认 `yolo` 进入高权限。
6. 重开数据库不重复迁移、不改变数量；人为制造迁移失败时整库回滚。
