# ZCode UI Lab Portable 打包

这是基于现有已构建输出的非官方 macOS arm64 独立版本。首次运行不包含原版或本地 UI Lab 的账号、会话、配置、缓存、草稿；需要自行正常登录。数据位于 `~/Library/Application Support/ZCode-UI-Lab-Portable`。不更改 `HOME`，不注册官方 `zcode:` 协议，不配置更新源。

没有 Developer ID 签名或 Apple 公证；本流程不关闭 Gatekeeper、SIP 或其他系统安全机制。开源 `@zcode/zcode-cua` 是占位实现，Computer Use 不可用；打包不会恢复该能力，也没有新增模型测试请求。

## 前置材料

- macOS arm64、Node 24，以及当前仓库已经安装的依赖（本脚本不运行安装、不下载）。
- `packages/desktop/out/{main,host,preload,renderer,plugin-sandbox,scheduler,metadata}` 的已验证构建。
- `packages/desktop/bundled-agents/darwin-arm64/glm`、原生搜索工具、默认配置、图标、窗口信息 helper 和第三方声明。
- `node_modules/electron/dist/Electron.app`、同目录 Electron `LICENSE` 与 `LICENSES.chromium.html`。

若从纯源码重新构建，请先依照仓库 `AGENTS.md` 和实际构建脚本生成这些产物。本脚本不会把历史构建目录、`e2e` 或 `*.pre-*-retained` 备份打入应用。

## 安全制作

```sh
node --test packaging/portable-home.test.mjs
node packaging/stage-portable.mjs --source=/absolute/path/to/source --work=/absolute/path/to/new-disposable-work --output=/absolute/path/to/new-output
```

`stage-portable.mjs` 拒绝覆盖已有工作目录或输出目录；两者都必须在输入仓库之外，以免递归复制或写回原仓库。它先通过 APFS 克隆建立可丢弃的制作副本。`build-portable.mjs` 只接受带专用 marker 的副本，并拒绝覆盖既有 `portable-package-app`。原始输入仓库不被修改。

生产依赖由现有 `runtime-dependency-closure.mjs` 收集，复用官方 Electron Builder 和 afterPack 校验；不复制完整开发依赖树。复用本地 Electron 分发材料，先生成 `mac-arm64/ZCode UI Lab Portable.app`。随后可用 `ditto -c -k --sequesterRsrc --keepParent` 将该 `.app` 打为 zip；压缩前必须完成独立冷启动验收。

## 有界打包差异

1. bootstrap 在任何产品模块导入前指定全新数据根，随后由现有隔离模块处理 userData、sessionData、日志与凭据路径。
2. 唯一打包修复见 `placeholder-cua-packaging.patch`：既有 producer 契约规定占位开源构建应跳过 CUA 专属资源与校验。原 `assertPackagedCuaKoffi` 缺少该判定；脚本在可丢弃副本中补上与 Helper 一致的 gate，真实 producer 仍执行原断言。nativePolicy、node-pty、Sharp、许可和依赖闭包检查保留。
3. 本地 unpacked Electron 模式不会复制顶层许可文件；定制 afterExtract 先复制同版本原始两份声明，再调用原许可 hook。

## 仅供验收的临时根

`ZCODE_PORTABLE_TEST_HOME` 只接受 `os.tmpdir()` 直属且名称以 `zcode-ui-lab-portable-test-` 开头的目录，并拒绝符号链接。它在导入产品模块前移除，默认用户启动不需要配置。测试值失败时不会先创建外部路径。不要直接用已有账号或原 Lab 数据作为测试根。

回滚可保留或移走本 `.app`；不会删除正式版或原 Lab 数据。删除专用 Portable 数据根会清除 Portable 自身数据，应由用户另行明确确认。
