# 全局指令设置入口

## 产品规则与所有者

- 设置新增 `globalInstructions` 分区，归入“个性化”，与工作区记忆相邻。
- Desktop 使用本地 Base Host 的 `ISettingsSyncService` 查询当前应用 profile 的 `AGENTS.md` 路径和存在状态。路径由 `getApplicationHomeDir()` 决定，Renderer 不拼接用户目录，不因活动远端工作区改变目标。
- `getGlobalAgentsFileStatus()` 返回 `{ path, exists }`；不存在不是错误，不读取外部 Claude 文件、不触发迁移、不读文件正文。
- `createGlobalAgentsFile()` 只创建固定目标的空文件，没有任意路径或内容参数；异步 IO、`wx` 独占创建，不覆盖已有文件；重复/并发请求幂等。应用目录本身和目标文件若为 symlink 或类型不符则拒绝。已有文件必须是普通文件。
- 状态读取与创建失败均显示真实错误，错误时不能继续打开旧路径。创建成功后先回读状态，再由用户点击外部编辑器入口。
- 编辑和保存由用户选择的真实外部编辑器完成，调用 `IPlatformService.openInEditor`；设置页不显示“已保存”或实时生效承诺。编辑器打开失败可见，未发现编辑器时显示明确提示；文件管理器/终端不冒充文本编辑器。
- 全局指令适用于该 profile 启动的会话，项目自身 `AGENTS.md` 仍按既有规则叠加。建议新建会话应用更改；正在运行会话不会被此页重载或重启。
- Web Remote / Mobile 可见本地操作说明，但不查询本地路径、不创建文件、不枚举/调用本地编辑器。
- 不创建测试结果面板：当前没有通用测试证据的权威持久化域，工具成功、exit 0、Goal 验证均不能升级为测试通过。

## 事件顺序

```text
SettingsPage -> 本地 ServiceProvider -> useGlobalInstructions
  ├─ 打开/刷新 -> settingsSyncService.getGlobalAgentsFileStatus -> 本地展示投影
  ├─ 创建 -> settingsSyncService.createGlobalAgentsFile (固定目标/wx)
  │             -> getGlobalAgentsFileStatus -> 可打开状态
  └─ 选择编辑器/打开 -> IPlatformService.openInEditor -> 外部编辑器编辑与保存
```

服务拥有文件事实，hook 只保留本次挂载的投影、busy/error及请求序号；旧异步结果不得覆盖新请求或卸载后的状态。不存在第二个文件存储、后台轮询、运行时广播或远端同步。

## 验收

1. 缺失：显示真实隔离路径/未创建；明确点击创建才产生空文件；不从 Claude 复制。
2. 已有：保留逐字节内容；重复/并发创建不覆盖；拒绝 symlink/目录文件及 symlink profile。
3. 创建失败/状态失败：错误可见且无假成功；刷新可恢复。
4. 远端工作区激活：全局指令仍只发给本地 Base Host；Web/mobile 本地服务与编辑器零调用。
5. 选择编辑器后打开准确路径；没有编辑器或打开失败有可读反馈。创建成功不等同于已编辑/保存。
6. 中英、Zai Light/Dark、窄窗、键盘入口可达，遵循 `text-ui-*` 与语义颜色。

内嵌编辑、原子保存/版本冲突、远端全局指令管理和通用测试证据持久化尚未实现，不由本入口暗含提供。
