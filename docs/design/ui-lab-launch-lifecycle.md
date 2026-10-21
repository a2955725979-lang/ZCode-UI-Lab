# B03 独立 Lab 重启链最小方案

> 分发边界（2026-10-22）：本文保留本机 Lab 的历史设计与验收要求。提到的 `run-ui-lab-p0.mjs`、native entry、guardian 和切换/回滚脚本位于仓库外，包含机器专用路径，不随公开源码分发。克隆仓库不会自动建立同一 Dock 入口；`packaging/` 是独立 Portable 分发流程。本次源码推送未重建 Portable 安装包。下文“不提交 Git”等约束属于当时修复任务，不是当前仓库发布状态。

## 目标和边界

修复生成 Lab 的应用内 app.relaunch 重新进入现有 root/origin=5184 的 renderer 链路，覆盖重复打开、正常退出及端口冲突。只修改 Lab 根 native / launcher / guardian 及必要根测试；不改 Desktop main 或正式应用；不改 Framework、Helpers、fuse、sandbox、用户数据、账号或更新策略；不发送模型请求、不提交 Git。

## 已核对的事实

- run-ui-lab-p0.mjs 的 Dock 流程以 launcher PID 启动 guardian，ready 后 execve 生成 Lab Electron，同 PID 进入业务。
- ui-lab-native-entry.c 仅无参或 `-psn_` 认作 Dock；包含业务 appDirectory 参数时直接进入 ElectronMain。
- ui-lab-preview-guardian.mjs 只有最初 owner PID，owner 退出立即 finally close 自己启动的 renderer。
- source main 的三处默认 app.relaunch() 不改 argv。Electron 本地官方 app.md 说明默认使用当前参数、等待旧进程退出后重启。
- 2026-10-18 原始审计记载 48453 正常退出、48967 创建窗口后 5184 ERR_CONNECTION_REFUSED；旧 guardian 48454 消失，与上述代码路径一致。没有把未获取的实时 argv 或 stopReason 写成已观察。

## 最小方案对比

1. 推荐：根 native 的一次性进入标志 + guardian 内核锁。所有 Lab main 冷启动及默认 relaunch 都经同一 Node launcher；Framework/Node 特殊模式保留。新 guardian 必须拿到同一私有 flock 才 prepare；旧 guardian 先完整 close 自有 renderer，最后退出释放 flock。无长期残留 owner 转移状态。
2. 长期 guardian/IPC 转移 owner：可以保留 renderer 连续，但需要额外 socket 鉴权、closing/claim 竞态处理及新旧 owner 选择；对当前单机开发版复杂度更高，不采用。
3. 仅修改 Desktop main 的一个 relaunch args 或固定 sleep：遗漏另外两个 relaunch 路径或留下 old guardian 释放竞态，不采用。

## 唯一所有者与时序

```mermaid
sequenceDiagram
  participant L as native/Node launcher PID N
  participant O as old guardian (optional)
  participant G as new guardian PID G
  participant R as own renderer :5184
  L->>G: native internal guardian mode, nonblocking flock
  alt old lock held
    G-->>L: BUSY (no renderer started)
    alt active lease owner still alive
      L-->>L: duplicate launch exits 0
    else owner exited or lease being published
      L->>L: wait/check lock state within bounded startup timeout
      O->>R: await close owned renderer
      O-->>O: remove own active lease; process exit releases flock
      L->>G: retry acquisition
    end
  end
  G->>G: acquire flock; publish private immutable active lease
  G->>R: requireFreePort + strictPort; await HTTP ready
  G-->>L: atomic ready identity
  L->>L: execve generated native Electron with one-shot env
  L->>L: native consumes/unsets env, ElectronMain same PID N
  Note over L,G: app.relaunch gets normal appDirectory argv and no bypass env
  L-->>L: default app.relaunch exits N; replacement starts again at native launcher
  G->>R: owner N exited => await close only own renderer
  G-->>G: remove lease, then exit/unlock
```

OS flock, not a stale PID file, is the exclusive source for permission to create preview. Active lease is read-only coordination evidence (owner PID, guardian PID, identity); it cannot itself authorize taking over an occupied port. A lock file may persist, but lock ownership disappears on process exit automatically. A busy contender never starts another renderer, signals a reported PID, or spawns a delayed second Electron. Typical LaunchServices repeat-open remains the existing reopen/focus behavior. A direct concurrent native execution returns success when the current owner is live, so it cannot race the first launcher to Electron single-instance lock.

Native dispatch order: nonempty ELECTRON_RUN_AS_NODE -> framework Node entry; helper --type arguments -> framework ElectronMain unchanged; one-shot ZCODE_UI_LAB_ENTER_ELECTRON=1 -> unsetenv before ElectronMain; other Lab main starts -> bundled Node launcher --dock, forwarding relevant application arguments. The bypass is never present inside the business main and thus is not inherited by app.relaunch.

The guardian lock bridge is an exact internal native CLI mode. It opens only the compiled Lab private launch/preview.lock with O_NOFOLLOW and current-user regular-file checks, obtains LOCK_EX|LOCK_NB, leaves its FD open across same-PID exec into bundled Node guardian, and returns a dedicated BUSY exit status if unavailable. The ready handshake retains exact Lab root/source/appDirectory/bundleExecutable identity checks. Guardian finally awaits owned runtime.close, removes only its own lease, then the inherited lock FD releases on process exit. Arbitrary :5184 occupation still fails requireFreePort/strictPort without killing/reusing another server.

## New tests (isolation first)

- Native mock framework: cold/no-args/psn and inherited Lab appDirectory both go launcher; one-shot env is consumed before ElectronMain and all argv preserved there; simulated app.relaunch re-entry without marker returns to launcher.
- Preserve Node mode, --type=renderer/gpu/utility (and split --type value if supported), valid inherited stdio, closed stdio repair; no Framework/fuse/sandbox edits.
- Actual OS flock: two helper processes cannot own lock at once; busy attempt produces no renderer; lock is retained after exec into Node; release follows guardian completion and automatically follows process exit.
- Guardian fake runtime: normal owner exit, SIGTERM during prepare, renderer failure, close rejection and duplicate stop remain exactly-once cleanup; no success before identity/renderer ready, no secrets in ready or lease.
- Sequential real child-process handoff fixture using an ephemeral temporary port and fake renderer (no real app/user root): old owner disappears while close is deliberately blocked; new launcher must not ready until old close/lock release; next ready succeeds on same port.
- Concurrent cold launch: only one owner reaches Electron phase, duplicate exits cleanly, one guardian/renderer. Repeated open of live fixture does not restart renderer.
- Foreign port occupant: launch fails, occupant remains live and response unchanged; no PID signaling other than zero owner existence probes and own child cleanup.
- Installer existing isolated tests retain identity/Mach-O/backup/idempotence checks. Compile -std=c11 -Wall -Wextra -Werror -O2. Root JS syntax and Node tests use pinned bundled Node.

## Delivery evidence limits

Staging tests are isolated behavior evidence. Actual generated Lab app must later be built/installed by authorized main flow and native cold/relaunch/duplicate/quit observed before claiming real application recovery. Models/login need not be exercised. Current task has not changed any product file or process.
