# Task Search

侧栏“新建任务”下方提供“搜索”入口，快捷键为 `Cmd/Ctrl+K`。入口打开统一 Command Center；空搜索时展示当前任务最近变更、最近任务和分组命令，输入关键词后按命令、任务正文和文件匹配当前已打开 workspace 的 active 任务与文件。

搜索数据仍通过各 workspace scope 对应的 `zcodeTaskService.listTaskList` 获取：本地 workspace 通过本窗口
共用的 Local Host，并按 workspaceKey 隔离查询；远程 workspace 查询对应 remote session 所属的 Remote Host。
workspace scope 不代表独立 Host 进程。UI 不直接读取 session JSON，避免绕过 desktop / web remote 的服务边界。

为支持正文搜索，task sqlite 索引保存 `searchable_text`。实时快照和 Claude 导入只索引用户可见的聊天正文；assistant 文本在索引前剥离尾部 `::next-prompt{...}` 建议元数据，用户原文（包括相同字面量）保持不变，Markdown 正文保持原样。正文索引最多保留 200000 字符，避免长会话无限放大 `tasks-index.sqlite`。

## 旧索引隔离与持久历史重建

`tasks-index.sqlite` 的旧 `searchable_text` 可能包含 assistant 建议指令。新版迁移在一个 SQLite 事务中清空旧正文并把搜索正文版本置为待重建；保留 title、pin、archive、delete、分组和其它任务元数据。查询必须仅匹配且生成摘要于当前版本的正文，不能从待重建行回退读取旧正文。一个搜索范围仍有待重建行时，服务明确报告索引未就绪，不能把空结果解释成已搜完。

CLI 是持久会话文本的事实源。Host 通过 `readPersistedTaskSearchPage({ workspacePath, workspaceIdentity?, cursor?, limit })` 读取一页（`limit <= 64`），响应为 `{ items: [{ sessionId, sourceRevision, searchableText }], nextCursor?, complete }`。CLI 从 cold-event-merge 的当前 active branch 提取用户可见文本，不需要运行态，也不启动模型；workspace identity 必须严格匹配。`sourceRevision` 随 active branch、rewind 或新消息改变。`complete` 只有全 workspace 枚举到尾才为真，空页不能代表完成。Host 不使用运行态 `readSession(existing-only)` 代替这个接口，因为 dormant 历史不一定有运行态。

```text
CLI 持久 active branch → 只读分页 → Host task-index syncer → SQLite 版本/CAS → 搜索查询
实时快照 / Claude 导入 ────────────────────────────────┘
```

首次 sessions-index 基线建立后，syncer 以至多 64 条一批重建当前 workspace；分页错误、identity 不符、游标不前进、未返回 `complete` 或存在无法回源的非删除任务时保持未就绪。每条冷历史只在对应行仍待重建时写入正文；实时快照或导入先写入的当前版本优先，冷回填不得覆盖它。写入不改变 title、pin、archive 或任务排序。重建可重试且幂等；任务删除 tombstone 不因历史回填复活。搜索就绪由 SQLite 当前版本覆盖情况判定，不能仅根据内存任务或一次空分页判定。

搜索索引未就绪时，Host 向调用方传递 `TASK_SEARCH_INDEX_NOT_READY`；搜索界面显示“重建中”并允许重试，不将其转成“没有结果”。普通任务列表不依赖正文索引就绪状态。

### 冷启动后显式搜索

`TaskIndexRepo` 是搜索就绪状态的唯一所有者：`searchReadyWorkspaceKeys` 只在当前 Host 进程中有效，重启后不能从旧 SQLite 正文版本推断已经完成全量 CLI 枚举。因此，未打开的旧 workspace 在冷启动后首次全文搜索会先得到 `TASK_SEARCH_INDEX_NOT_READY`，由 `zcodeTaskService.listTaskList` 仅在这一显式搜索请求中让 task-index syncer 按 workspace identity 单飞重建，再重试同一查询。没有 `search` 的任务列表、侧栏观察和后台订阅不得因此启动 dormant CLI。

顺序为：用户输入搜索词 → Repo 拒绝未就绪范围 → syncer 对所请求 scope 启动本机只读 CLI（不发送模型请求）→ 分页枚举持久 active branch 并补齐缺失元数据 → Claude 旧快照按既有规则补齐 → Repo 确认无 pending 行后标记当前进程就绪 → 原搜索查询重试。已有活动 runtime 的后台重建与显式搜索按 workspace 单飞；新会话到达时撤销就绪并重扫，旧分页不可覆盖实时正文。分页失败、identity 不符、旧目录无法读取或 runtime 无法启动时保持未就绪并返回错误，不清空任务行，也不把不完整结果伪装成空结果。新进程冷启动重新执行同样枚举，不持久化“已就绪”标记。
