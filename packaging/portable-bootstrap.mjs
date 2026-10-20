import { resolvePortableApplicationHome } from "./portable-home.mjs";

// 必须在导入任何产品模块前确定隔离根；不能更改 HOME 或读取现有 Lab 数据。
const applicationHome = resolvePortableApplicationHome({ testHome: process.env.ZCODE_PORTABLE_TEST_HOME });
delete process.env.ZCODE_PORTABLE_TEST_HOME;
process.env.ZCODE_APPLICATION_HOME = applicationHome;
// 清理上一个开发实例可能遗留的指向；产品隔离启动模块继续限制继承环境。
delete process.env.ELECTRON_RENDERER_URL;
process.env.ZCODE_AUTO_UPDATE = "0";
process.env.ZCODE_AUTO_UPDATE_DEV = "0";
process.env.ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT = "1";
await import("./out/main/index.js");
