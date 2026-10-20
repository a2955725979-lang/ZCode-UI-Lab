# ZCode UI Lab

基于 [zai-org/ZCode](https://github.com/zai-org/ZCode) v3.15.1 的个人定制实验版。本仓库保留完整客户端、共享 UI、服务和 Agent 源码；它不是 ZCode 官方发行版，也不提供模型权重或免费模型额度。

官方源码基线：`aac4755666d09fdcd70272fcf063c077a639015f`。上游使用说明保留在 [README.md](README.md) 和 [README.en.md](README.en.md)。本定制版的使用方式以本文件及 `packaging/` 为准。

## 本次分发

- `Releases` 中的 macOS Apple Silicon（arm64）应用 ZIP：解压后得到独立应用，不需要原开发目录、Node.js 或 Vite 服务。
- 源码归档：包含定制代码、测试、构建脚本和锁文件，不含 `node_modules`、账号、个人配置、聊天记录、缓存或历史审计截图。
- `SHA256SUMS.txt`：下载后可使用 `shasum -a 256 -c SHA256SUMS.txt` 校验归档。

请先完整解压再打开应用。应用名与 Bundle ID 与正式版区分；不要替换已有 `/Applications/ZCode.app`。本包没有 Apple Developer ID 签名或 Apple 公证，下载后可能被 macOS 拦截；本项目不要求关闭 Gatekeeper、SIP 或其他系统安全机制。受限时可以从源码在本机构建。

## 数据与账号

发布包使用新的独立数据目录 `~/Library/Application Support/ZCode-UI-Lab-Portable`，与正式版、开发中的 UI Lab 分离。初次打开不应出现原账号或原历史；请通过正常流程自行登录、配置模型。归档不迁移旧数据。

模型调用仍需要可用的账号、套餐或提供商配置，按相应服务规则计费；本包不绕过认证、额度或服务验证。定制版自动更新关闭，未来同步上游需重新合并、构建和验收。

## 已加入的定制能力

- Chat / Work 模式及分开的历史归属；支持手动调整旧会话归属。
- 工作首发确认窗、执行中提问、待处理入口和自动任务清单。
- 后续提示词的可编辑草稿接受方式、可关闭设置，以及同机业务窗口的即时同步。
- 草稿并发保护、对话管理失败提示、Markdown 示例误识别回归修复，以及输入框焦点样式修复。

这些能力不等同于模型跨会话记忆，也不保证每次回答都会产生执行清单或后续建议。

## 已知限制

- 开源 `@zcode/zcode-cua` 是占位实现，不包含真正的 Computer Use runtime / Helper。电脑控制的权限页可能显示误导性的“正在验证／未知”，不能作为系统权限已授予的依据；只打开系统设置无法补齐缺失实现。
- 此次运行包只针对 macOS arm64。Windows、Linux、Intel Mac 和手机端没有本次发布包验收结果。
- 打包验收不新增模型请求。真实模型发送、Agent 文件操作和电脑控制执行没有在此发布流程中重测。
- Web 构建成功不代表桌面 renderer 可以脱离 Electron preload 在普通浏览器独立运行；通用 Web 服务按上游文档部署。
- 先前测试驱动的 relaunch 自动重连仍有兼容性限制，不能把替代核验路径视为该驱动已修复。
- 长期性能、所有辅助技术及极端存储故障组合没有本次完整验收。

## 开发与构建

工具版本以 `mise.toml` 为准：Node.js 24.14.0、pnpm 10.33.2。`pnpm bootstrap` 会安装依赖和准备运行时资产；它可能下载第三方组件，应在联网开发环境运行。生产构建、独立分发 bootstrap 与配置见 `packaging/`。不要把自己的 `.env.local`、账号文件或运行数据提交到版本控制。

本仓库首次发布默认关闭 GitHub Actions，避免复制上游工作流后自动触发发布或计算任务。需要 CI 时应先审查工作流、凭据和费用，再明确启用。

## 许可

第一方代码采用 Apache-2.0，保留 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md)、[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 和 `third-party/`。第三方组件使用各自许可；ZCode 品牌及服务不因此转让。本分发不承诺拥有官方闭源组件或所有官方功能。

详细版本变化与验收边界见 [RELEASE-NOTES.zh-CN.md](RELEASE-NOTES.zh-CN.md)。
