# 设置页侧栏布局

设置页使用桌面化左右分栏结构，并统一收敛到 [DESIGN.md](../../DESIGN.md#color-palette) 中的语义 token：

- 外层容器使用 `bg-background + border-border`，形成独立设置工作区。
- 左侧导航使用 `bg-sidebar`，承载返回按钮、分组导航和当前分组说明。
- 左侧导航需要响应窗口宽度：`lg` 及以上保持 264px 文本侧栏，即 256px 内容宽度加 8px 安全余量；低于 `lg` 时收敛为 64px 图标侧栏，隐藏可视文本并通过 tooltip 暴露返回、分组和引导入口标题，避免窄窗口挤压右侧设置内容。
- 右侧内容区保持 `bg-background`，标题与设置内容分离，正文宽度收敛到中等阅读列。
- 设置项卡片统一使用 `bg-card + border-border`，行内分隔线统一使用 `border-border`。
- 交互控件优先使用 `bg-input / border-input-border / bg-hover / bg-selected`，避免页面局部再拼新的中性色值。
- 通用 `Card` 基类也同步收敛到 `bg-card + border-card-border + text-foreground`，避免页面组件重复手写卡片轮廓语义。

## 导航分组

设置入口保留现有设置 id 与持久化，按职责显示四组：

- 使用体验：常规、外观、浏览器、电脑控制（仅桌面）、快捷键。
- 个性化：全局指令、工作区记忆。两者分别解释 profile 全局指令与按工作区保存的记忆，不承诺跨所有会话共享。
- 模型与扩展：模型供应商、子智能体、插件、MCP、技能、命令、钩子。
- 数据与统计：使用统计。

模型供应商页管理供应商、凭据和可用模型能力；当前聊天使用哪个模型与推理档位在输入区选择，选项受模型能力约束。界面模式继续保存 `office/coding`，显示为“聊天/工作”；不改权限模式、Plan 或模型选择。

分组标题属于导航结构，不是可点击入口。宽侧栏显示本地化标题；低于 `lg` 收敛为 64px 图标栏时隐藏可视标题，并用弱分隔线保留组边界。每组使用独立的无障碍 group 名称，组内入口继续保留 tooltip、`aria-current` 和原有 test id。引导入口不归入设置分组，继续放在分组列表之后。

分组只影响 desktop / web 共用设置页的导航视觉和语义结构，不改变设置分区 id、最近访问分区、显式跳转意图、内容路由或持久化。手机 `/remote` 当前没有设置页入口，因此不新增移动端专属交互；窄窗口仅验证响应式图标栏表现。

当前入口职责如下：

- 常规：语言、聊天/工作界面模式及通用行为。
- 外观：主题、界面字号、代码主题、行号、换行与代码字号。
- 模型供应商：本地 profile 的供应商、凭据、可用模型及能力定义。
- 全局指令：本地 profile 的 `AGENTS.md` 状态、安全创建与外部编辑器入口；见 [全局指令设置](global-instructions-settings.md)。
- 工作区记忆：按工作区浏览本地 profile 的已保存记忆；开关影响新会话且可能产生模型成本。
- 插件、技能、MCP、命令、钩子：保留各自既有 User/Workspace 与 Host 选择和读写路径。
- 浏览器、电脑控制、快捷键：沿用现有平台能力边界。
- 用量：查看应用与编程套餐用量。

历史窗口里残留的已隐藏分区跳转意图会回落到可见的默认分区，避免打开空白设置页。

## 阻塞交互隔离

设置页打开后，它是当前窗口唯一可交互的主表面。底层 workspace 为了保留会话订阅、草稿、终端和布局状态继续挂载，但必须同时标记为 `aria-hidden` 和 `inert`；仅使用透明度与 `pointer-events` 隐藏不够，因为权限卡片的自动聚焦仍可能把焦点从设置表单抢走。

```text
CLI pending interaction
  -> conversation snapshot 继续更新
  -> 被设置页覆盖的 workspace（mounted + aria-hidden + inert）
       |-> 不聚焦 Permission / AskUserQuestion
       |-> 不接收键盘或指针交互
       `-> 任务徽标 / 系统通知仍可提示

用户显式返回工作区或点击任务通知
  -> settings layer 关闭
  -> workspace 移除 inert
  -> 在原 task 的 bottom dock 展示待处理交互
```

| 当前表面 | 后台事件 | 期望结果 |
| --- | --- | --- |
| 设置页 | 普通权限请求 | 设置页、表单值和当前焦点保持不变；请求继续留在原 task |
| 设置页 | `AskUserQuestion` | 与普通权限使用同一表面隔离规则；不强制切回会话 |
| 设置页 | 请求完成或自动结束 | 只更新后台 task 投影；设置页不切换 |
| workspace | 权限或问答仍 pending | 按既有 bottom dock 交互展示并允许响应 |

该边界只约束 renderer 表面和焦点所有权，不修改 `pendingInteractions`、请求倒计时、权限响应、任务通知、desktop `desktop-continuous` 或手机 `web-remote-replayable` 的协议与恢复语义。手机 `/remote` 没有桌面设置覆盖层时继续使用现有移动端交互，不从本 case 推导新的远控行为。

这次调整只修改 UI 结构与视觉层级，不改动底层设置状态、持久化方式，以及 desktop / web 共用的设置逻辑。
