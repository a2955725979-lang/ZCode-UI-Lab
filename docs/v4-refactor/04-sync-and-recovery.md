# 订阅与恢复：连接级 resync 是唯一恢复路径

> 当前事实（V4 wire v3）：刷新、gap、慢订阅者溢出、relay 重连、attachment 重建和 CLI runtime restart 都收敛到 connection-scoped 恢复。活跃 subscription 的 gap/fault 走 same-sub resync；只有 attachment/runtime 代际重建才 fresh-subscribe。恢复不改变 desktop `continuous` / mobile `replayable` 边界。

## 1. 订阅生命周期

客户端不能选择 profile。host 从可信 attachment 上下文注入 `connectionId/clientMode/profile`，并只把帧送回拥有 subscription 的端口。

```text
client                  connection facade               CLI publisher
  │ hello(v2, connectionId, trusted clientMode)              │
  │ clientHello(clientId, version, telemetry kind)            │
  │ subscribe(topic, base?) ─►│                                │
  │                            │ inject connection/profile ───►│
  │◄─ SubscribeAck{subId,mode,logEpoch} ───────────────────────│
  │   （ACK response 写出后）                                  │
  │◄════════ initial/online TopicWireFrame(subId) only ═══════│
  │                                                            │
  │ gap / fragment loss ── v4/conversation/resync{subId,base} ►│
  │                         （同连接 single-flight）             │
  │◄──────────── resume；若再次 gap 则 forceSnapshot ──────────│
  │                                                            │
  │ attachment close          │ unsubscribeAll(connectionId) ─►│
```

服务端裁决：

- `base.logEpoch` 与当前 CLI epoch 相同，且 `base.seq` 仍在保留窗内：`mode="resume"`，从 `(base.seq, now]` 续传。
- 无 base、epoch 不同、base 超出保留窗或客户端要求 `forceSnapshot`：`mode="snapshot"`。
- 同 `(connectionId, topic)` 重订阅只替换该连接的旧 subscription；另一连接的同 topic subscription 不受影响。
- 活跃订阅的 `v4/conversation/resync` 必须精确命中当前 connection registry 中的
  `subscriptionId`，保持同一 subId/profile/topic；客户端不能借 resync 选择 topic、connection
  或 delivery profile。合法 base 从该订阅者的客户端水位重新裁决，不使用 publisher 的
  `sentSeq` 代替。

subscribe response 只能携带小 ACK，不能内嵌 logical snapshot，也不能返回 `frames[]`（数组整体仍可能超过 1 MiB）。ACK 写出后，initial snapshot/resume 才以普通 owned-port wire notification 发送；客户端完整 assembly 前保持旧 store 或 loading 状态。

`SubscribeAck.logEpoch` 只证明本次 subscription admission 与服务端裁决，**不会凭空创建 resume
base**。客户端若在请求前确实持有一致 projection，且 ACK=`resume` 并确认同 epoch，可继续使用该
已证明的旧 base；ACK=`snapshot` 则立即使旧 base 失效，直到一个完整 owned snapshot 原子 apply。
无既有 base 的 conversation、sessions-index、workspace-config 必须等 logical snapshot 完成 assembly、
schema/checksum 校验并 apply 后才能建立 `{logEpoch,seq}`。若 initial 在此之前 fault/overflow，客户端
必须以 `base:null + forceSnapshot:true` 恢复（或 fresh snapshot subscribe）；禁止用 ACK epoch 拼出
`{epoch,0}`。尤其 sessions-index 的 cold seed 不进入 delta log，伪造 seq=0 可能得到合法空 resume，
却永久漏掉冷会话 baseline。无 valid base 时 delta 一律不 apply；完整 owned snapshot（包括 online
overflow snapshot）仍可建立 base。

### 1.1 ACK 后 physical batch 与 publisher reservation（04B）

三类 subscribe（conversation、sessions-index、workspace-config）的公共 result schema
都是 strict `{ ack }`。CLI publisher 先建立不破坏水位的 reservation，gateway 将该
logical frame 编码为完整 physical notification batch，server 按 request id 保存
`{messages, commit}` 一次性 post-response outbox。NDJSON connection 对每个请求机械执行：

```text
publisher reserve R(frame, stable logicalFrameId, deliveryKind)
                         │
gateway encode R -> { ack, physical notifications[0..k], commit }
                         │
                         ├─ response.result = { ack }
                         └─ requestId outbox = { messages[0..k], commit }

connection: take(requestId)
  -> write(response line)
  -> write every physical notification in order
  -> commit R only after every line entered this connection-owned write queue
```

编码失败、同步 enqueue 抛错或 connection 在 batch admission 中途关闭时不得
commit；下次 reserve 必须返回相同 `logicalFrameId` 与相同 logical content。Node
`Writable.write()` 正常返回（包括 `false` 背压信号）表示该 line 已被当前 connection
接管，此时可以 commit；若稍后异步 EPIPE/close，该 connection epoch 整体终结，旧
subscription/outbox 不会迁移到新管道，客户端必须在新 attachment 上重新订阅。
reservation 在途时的新事件进入下一 buffer，不得被当前 commit 吃掉；退订/
重订会作废旧 reservation，迟到 commit 返回 false；但新 initial encode 在 ACK admission
前失败时，replacement 必须 rollback 到旧 subscription/mapping/flush state，旧客户端不能断流。
没有 initial frame 时 outbox 为空，
只写 response。online frame 使用同一 reserve → encode → emit-all → commit 管线。

每个 reservation 必须由 publisher 权威赋值 `deliveryKind`，encoder 将它原样写入
每个 physical notification：subscribe admission 产生 `initial`，普通 flush（包括
publisher 自主 buffer-overflow snapshot）产生 `online`，显式
`v4/conversation/resync` 产生 `recovery`。同一 logical frame 的所有 fragment 必须携带
相同值，assembler 对不一致 fail closed。UI 禁止根据“刚调用过 subscribe/resync”、
Promise continuation 或收到帧的数组位置猜测类型；迟到 online duplicate 也不能消耗
recovery 标记。

host facade、UI transport 与 task-index syncer 在 ACK 生效前暂存的是 physical
wire，最多 1,024 帧、32 MiB transport bytes。ownership 判定必须在 assembly 之前；
foreign `subscriptionId` 不得消耗 assembly 内存。暂存溢出必须清空整批并显式
失败/标记 `fault.subscription.initialFrameStagingOverflow`，禁止只 shift 最旧分片。
stale generation、unsubscribe 与 close 同时清除 staging、assembly 和超时引用。

### 1.2 same-sub resync 与 reservation 作废

`v4/conversation/resync` 的公共参数/结果固定为：

```ts
interface ConversationResyncParams {
  subscriptionId: string;
  base: { logEpoch: string; seq: number } | null;
  forceSnapshot?: boolean;
}
interface ConversationResyncResult {
  ack: SubscribeAck; // subscriptionId 保持不变
}
```

server 与 subscribe 使用同一 post-response outbox：先写 strict `{ack}` response，再按序写完整
physical recovery batch，全部进入 connection-owned queue 后才 commit。resync admission 会立即
supersede 该 sub 的旧 reservation；旧 reservation 的迟到 commit 必须返回 `false`。旧 reservation
之后进入的权威事件仍由新 recovery snapshot/replay 覆盖，不能因 supersede 丢失。

`base` 匹配 epoch、处于保留窗且未要求 `forceSnapshot` 时回 `mode="resume"`，从
`(base.seq,currentSeq]` 重新生成 replay；其他情况回 `mode="snapshot"`。同一连接的另一个 topic、
同 topic 的另一个 connection 均不受影响。

## 2. 客户端规范 apply

客户端先把 wire v3 的 physical fragment 还原为一个 logical topic frame，并保留信封中
权威的 `deliveryKind`；只有 envelope、类型、长度、fragment 总数与 checksum 全部通过，
才原子 apply。缺片、重复冲突、checksum 不符或 assembly 超限都不得部分修改 store。

assembly 之前先执行每 subscription 的 `logicalFrameOrdinal` 单调闸门：小于已完成/
fault/timed-out ordinal 的 wire 静默丢弃；同 ordinal 仅允许同 `logicalFrameId` 的重复片，
换 id 必须产生 `proto.frameAssemblyOrdinalConflict`；更高 ordinal 可 supersede 当前残片，
但 consumer 因同批 fault 执行 abort 时必须保留 ordinal tombstone，直到 unsubscribe 清理。

```ts
function onLogicalFrame(store, frame, deliveryKind) {
  if (frame.subscriptionId !== store.subscriptionId) return; // 旧代际

  if (frame.payload.kind === "snapshot") {
    store.replaceAll(frame.payload.snapshot);                // 整体替换
    store.logEpoch = frame.payload.snapshot.logEpoch;
    store.seq = frame.toSeq;
    store.hasAppliedBase = true;
    // online overflow snapshot 是权威全量，可建立 base，但不能冒充 recovery 收口 flight。
    if (deliveryKind === "recovery") markRecoveryFrameSeen(store);
    return;
  }

  if (frame.toSeq <= store.seq) {
    // aligned `(N,N]` 或已被更新 snapshot 覆盖的 recovery 仍是有效 logical frame。
    if (deliveryKind === "recovery") markRecoveryFrameSeen(store);
    return;                                                   // 迟到/重复，不改 projection
  }

  if (deliveryKind === "online" && store.recoveryFlight) {
    // recovery 已 apply 后的 residual online 交给 ACK 后 successor；此前的 online
    // 已被本次 recovery 的权威区间覆盖。两者都不能消费当前 recovery flight。
    if (store.recoveryFlight.validFrameSeen) markSuccessorRecoveryNeeded(store);
    return;
  }

  if (frame.fromSeq !== store.seq) {
    requestResyncOnce(store, {
      base: { logEpoch: store.logEpoch, seq: store.seq },
      forceSnapshot: store.lastSubscribeMode === "resume",
    });
    return;
  }

  applyDeltasAtomically(store, frame.payload.deltas);
  store.seq = frame.toSeq;
  store.hasAppliedBase = true;
  if (deliveryKind === "recovery") markRecoveryFrameSeen(store);
}
```

封闭规则：

1. snapshot 永远整体替换，绝不 merge。
2. `toSeq <= localSeq` 永远不重复修改 projection，也不产生额外 resubscribe；若它是完整、有效的
   recovery logical frame，仍需标记该 flight 已收到交付。
3. 第一个 gap 只创建一个在途 resync；在 `deliveryKind="recovery"` 的 logical frame 完整校验并被接受前，后续 gap/fault
   复用同一 flight，而不是在 RPC ACK 到达时提前清除。
4. 只有 `deliveryKind="recovery"` 的 `resume` frame 再次断档，才把同一 flight 升级并再发一次
   `forceSnapshot=true`；状态必须跨过同步 ACK activation 存活，禁止无限 resume 循环。
5. snapshot/resume logical frame 分片期间，旧 store 继续可读；assembly 完成并校验后一次性替换/apply。
6. `base` 与投影同生共死：刷新丢失内存投影时不能只保留 seq；subscribe ACK 也不能单独
   建立 base。只有 initial/recovery/online logical frame 原子 apply 后的 epoch/seq 才可续传。
7. original subscribe 的 initial assembly fault 一旦进入 same-sub recovery，必须清除
   `awaitingInitial`；随后的 recovery gap 优先按 recovery 规则升级，不能误走 fresh subscribe。
8. resync ACK 不是恢复完成。ACK 后若 30s 内连一个完整 recovery logical frame 都未得到（零 wire/整批
   丢失也包括在内），普通 resume 尝试升级一次 force snapshot；UI 的 force 尝试再超时进入明确
   ERROR，task-index 则只对故障 topic fresh-subscribe，不影响 sibling。
9. recovery logical frame 已完整校验并被接受（mark seen）后、ACK continuation 前若同批又出现非重复 online frame/gap，
   不得被旧 flight 吞掉；ACK 收口旧 flight 后立即从新 applied base 启动普通 successor resync。
10. `markRecoveryFrameSeen` 只标记权威 recovery logical frame 已完整到达；它与 ACK 两个条件都满足后才
    收口 flight。aligned `(N,N]` 或已被更新 snapshot 覆盖的 recovery 虽不改 projection，也必须标记，
    避免零变化恢复永久悬空。
11. **确定性内容 fault 不走瞬态阶梯。** 规则 3/4/8 的升级默认 fault 是瞬态的（丢片、超时、校验和
    不符，重投一次可能就好了）。`proto.frameAssemblyInvalidPayload` 不是：字节已过
    length/checksum/UTF-8/JSON 四道关，被拒说明客户端读不懂对端发来的**内容**，而 `resume` 档只会把
    同一批 delta 再投一遍。因此这类 fault 直接发一次 `forceSnapshot=true`（唯一可能产出不同字节的
    手段——快照是重新生成的，可能已不含那份内容），**跳过 resume 档**；强制 snapshot 仍被内容拒绝时
    停手，终态写 `fault.subscription.contentRejected` 而不是 `recoveryFailed`，且 sessions-index 不排
    退避重订阅（那对确定性失败是永不收敛的循环：清空投影 → 重订阅 → 再被拒）。自愈路径仍在：
    runtime 换代、fresh connect、用户重连都会重新订阅。判定函数与两个 code 见
    `packages/shared/src/zcode-protocol-v4/wire-fault.ts`；其余 reason code 一律仍按瞬态处理——把瞬态
    误判成确定性会让本该自愈的 gap 停在原地，那比多一次无用重试更坏。

    实测代价（2026-09-21，sess_4142de31）：一张工具卡载荷多带两个键，阶梯在同一份内容上烧掉三帧后
    fail closed，用户手动「重新连接」两次、每次再烧三帧，会话再也打不开。装饰载荷本身的兜底见
    10-protocol-spec §4.4.5（display 在信封层不设门），本规则是必填字段偏斜时的后备。

## 3. 自动恢复触发矩阵

| 触发 | 客户端/host 动作 | 权威恢复结果 |
| --- | --- | --- |
| 页面刷新、新 pane、新设备 | 无合法 base 时 subscribe | snapshot |
| 短断，内存投影仍在 | 带 `{logEpoch,seq}` subscribe | resume 或 snapshot |
| delta gap | single-flight `v4/conversation/resync` | resume；再 gap 强制 snapshot |
| `sendText` 已 `accepted|duplicate`，短暂宽限期后同 `sourceCommandId` 的 queue item / real-user row 仍不可见 | 当前 owned subscription single-flight `v4/conversation/resync` | resume 或 snapshot；只恢复投影，不重放 command |
| fragment 缺失/checksum 失败 | 丢弃整个 assembly + resync | 不产生半应用状态 |
| subscriber buffer 超限 | publisher 清空该 sub buffer、标 resync | 下一次只发最新 snapshot |
| relay/attachment 重建 | 完成 v2 握手后自动重订阅全部活跃 topic | 新 subId；旧帧丢弃 |
| CLI runtime restart | 新 `logEpoch`；客户端自动重订阅 | snapshot；旧 base 不续传 |
| port close | host `unsubscribeAll(connectionId)` | 释放 buffer/assembly，不影响其他连接 |

手机 relay/main 只透传 payload 与连接生命周期；raw adapter 的 `onSaturated/onDrained` 由 desktop main
写入 owning attachment 的 `connection-flow-v1` MessagePort sideband，再由 host 以 trusted
connectionId 送进 CLI。main/relay 不能缓存 snapshot、补 gap、维护 seq 或自行选择 pause target。
桌面 MessagePort 使用同一严格 control/binary 区分，只是 continuous 本地链路通常不会触发网络级拥塞。

conversation、sessions-index 与 workspace-config 各自持有独立的
`{subscriptionId,appliedBase,recoveryFlight,recoveryFrameDeadline}`。一个 topic 的 gap/assembly fault 只能恢复自己，
不能清空健康 sibling；task-index 的 pre-ACK overflow 必须退出 paused 状态并 fresh-subscribe，不能
永久 freeze。CLI runtime restart 只失效 runtime 与旧订阅，不销毁 workspace 级持久 frame emitters；
现有 listener 收到 restart 信号后，各活跃 store 恰好 full re-subscribe 一次。真正 workspace/service
teardown 才 dispose emitter 与 listener。

## 4. 三类易失状态，不是离线队列

```text
1. subscriber flush buffer（每 subscription，毫秒级）
   filter + coalesce 后 ≤500 ops 且 ≤max(1 MiB, snapshot 上界)；连接关闭即丢

2. fragment assembly（每 logical frame）
   ≤16 MiB；完整校验后原子 apply；失败即丢并 resync

3. session event log / projection（CLI 权威）
   event log 有界；projection 始终能生成最新 snapshot
```

服务端不为离线客户端积压 per-client 持久事件队列。长断回来要么回放仍在窗口内的权威 event log，要么直接 snapshot。一个慢手机 subscription 的 flush buffer 溢出只能让它自己 resync，不能阻塞桌面或同窗口其他 pane。

这里的“无离线事件队列”不等于“无输入队列”：所有已经提交的 busy/running 输入都进入 CLI/runtime 的唯一 `CommandInbox` FIFO；该输入队列是 conversation 业务事实，见 [10-protocol-spec.md](./10-protocol-spec.md) §4.2.5/§6。

## 5. Command 与输入恢复

UI 为已发出的普通文本/goal 保存 24h pending-command registry，包含可重发 payload；敏感 interaction 只保存 digest。QueueItem/guided projection 出现即删除对应记录；registry 只覆盖权威投递未知窗口，不是第二份 queue。

### 5.1 Renderer 恢复提示的隔离与同源多窗口持久化

- 唯一状态所有者仍为 renderer `PendingCommandRegistry`。它只记录待对账提示，CLI/runtime `CommandInbox` 仍是唯一已接受输入队列；恢复、迁移和刷新都不得自动重放命令。
- `workspaceIdentity?.trim() || workspacePath` 是恢复条目的作用域。自动/手动查询、single-flight、快照结算、展示及人工重发消费均先核对该作用域；相同路径的不同远端 identity 互不匹配。旧 createSession 可用 payload.workspaceId 恢复作用域；缺少作用域的旧普通输入不交给任意先连接的 pane 查询，保留至原 TTL 到期。
- `SessionPane` 可原地替换 workspace/session，不能假定 remount。租约绑定时冻结 owner 的 layer、workspaceKey 和实际 sessionId；render 到 acquire effect 更新之间，只有 owner 与当前目标一致的投影才可传给恢复 hook。不匹配时传空 snapshot、connecting 和空 subscriptionId，防止 A 的旧权威快照在 B 的作用域下结算同名命令。取得 B 自己的租约后恢复正常对账。
- 查询批次冻结条目身份与内容；只应用本批、同作用域、仍存在且未变更的记录。A 的 unknown 只能结算 A，异步旧回包不得覆盖更新后的提示或 session 迁移。single-flight 按 workspace 与 session 组合去重，不能吞掉 B 的首次 live/reconnect。
- 同源持久化 v2 使用逐 command key，稳定身份为 `[workspaceKey|null, clientId, commandId]`，sessionId 从 null 迁到创建结果时保持该稳定身份，并先写独立 resolved-session 事实；读取时让该事实覆盖旧 null 快照，防止极限交错写把绑定倒退。写入单条记录不重写整表；终态先写独立 settled tombstone，再删除记录。读取及写入均让 tombstone 优先，防止另一个 renderer 的旧值复活已结算提示。TTL 锚定首次登记，重读、迁移、更新均不续期；到期的记录、绑定事实与 tombstone 可清理。普通非终态展示字段不承诺跨窗口原子更新。
- v1 数组只读兼容：读取时合并尚未写入 v2 的有效条目，更新时按需写入 v2，v2 记录与 tombstone 优先；保留 legacy 原值，避免两个窗口迁移时删除对方尚未导入的记录。旧条目到期后不再读取。storage 不可用或配额失败时退化为当前 renderer 内存提示，不宣称持久化成功；敏感答案仍只存 digest。
- 同窗口写入同步通知订阅者，跨 renderer 使用 storage 事件；重新订阅或任何读取也重新取当前单条记录，不能只依赖事件。末订阅释放监听，测试实例提供 dispose。事件只刷新 UI，不产生上行命令。
- 人工消费会先核对 workspace 并结算旧提示，然后才产生新发送请求；本地同步 storage 不提供跨 renderer 的原子 compare-and-swap，因此不承诺两个窗口同时人工确认时的全局 exactly-once claim。任何窗口都不自动重放。

```text
当前 pane(workspace, session) → registry 作用域筛选 → 本批 commands/query → CLI/Host 权威结果
                                      │                    │
                                      └─ 冻结身份/内容校验 ←┘
                                           │
                              单条 v2 提示写入 / terminal tombstone
                                           │
                              本窗口通知 + 其它窗口 storage 事件
```

验收：A live/B offline 的命令集合不混合，B 线索保持且 B reconnect 独立恢复；同 path 不同 identity 隔离；并行 live 的 single-flight 不吞 B；两 renderer 交错 add/settle/重开不丢未结算记录且不复活终态；旧 v1 重读不复活、TTL 不延长；session remap、配额/读取失败退化、事件解绑及迟到回包分别回归。Desktop continuous 与 mobile replayable 仍共用同一权威命令语义，本修改只改变各安装本地恢复提示，不增加跨设备同步。

```text
send(commandId, payload)
        │
        ├─ ACK / queue / row 到达 ──> 用 sourceCommandId 对账
        │
        └─ 重连或 ACK 丢失 ────────> commands/query[{sessionId,commandId}]
                                      │
                                      ├─ duplicate/noop/failed -> 收口
                                      ├─ discarded queue/guide -> 静默清账
                                      ├─ discarded startNow    -> 用户确认后才能用新 command 重发
                                      └─ unknown               -> 静默清账，不呈现 UI 错误
```

CLI queue 只保证当前进程内可靠。CLI restart 时，已 admitted 但尚未进入 transcript 的 input 不自动恢复为可执行 queue，而是在 discarded input ledger 写入 tombstone；`commands/query` 返回 `failed` + `fault.command.inputDiscardedOnRestart` + 持久 `delivery`。ledger 只用于证明“该输入已被明确丢弃”，不能携带自动执行语义。UI 对 `queue/guide` 与无权威结论的 `unknown` 静默清账且不呈现错误；只有未进入 transcript 的 `startNow` 保留原文本和附件引用，待用户确认后以**新的 commandId** 重发。

服务端幂等内存分层为 `in-flight pinned / live queue-or-guide pinned / settled LRU`；512/session
上限只作用于 settled。query 与 execute 使用同一 key gate，持久化回源按 session 建一次惰性索引并由
新 anchor/marker/child/discarded 事实增量更新。任一持久化读取失败必须返回
`fault.command.queryUnavailable`，不能伪装成 `unknown`；`unknown` 本身不缓存。

最终不变量：每条已提交输入必须且只能处于 `queue / guided row / transcript / explicit rejected|failed|discarded` 之一。ACK 丢失、gap、重连或 restart 都不能造成“UI 已清空、权威层无记录”。
