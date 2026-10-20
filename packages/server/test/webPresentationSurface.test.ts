import { afterEach, expect, it, vi } from "vitest";

const { createLocalServices, createHttpServer, createCoreHttpServer } = vi.hoisted(() => ({
  createLocalServices: vi.fn(() => ({ getOptional: vi.fn() })),
  createHttpServer: vi.fn(),
  createCoreHttpServer: vi.fn(async () => ({ host: "127.0.0.1", port: 3030, close: vi.fn() })),
}));

vi.mock("@zcode/services/node", () => ({
  createLocalServices,
  createTopicResourcePeers: () => ({ getChannel: vi.fn() }),
  getAppConfigDir: () => "/isolated-web-config",
  materializeZCodeBuiltinProviderConfig: async () => "/isolated-web-config/provider.json",
  disposeServiceResourcesAndWait: vi.fn(),
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE_ENV: "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE",
}));
vi.mock("../src/bundledZCodeBuiltinProviderConfig.js", () => ({
  materializeBundledZCodeBuiltinProviderConfig: async () => "/isolated-web-config/provider.json",
  readBundledZCodeBuiltinProviderConfig: () => "{}",
}));
vi.mock("../src/http.js", () => ({ createHttpServer }));
vi.mock("../../zcode-server-cli/src/server-core/http.js", () => ({ createCoreHttpServer }));
vi.mock("../../zcode-server-cli/src/server-core/parentDisconnect.js", () => ({
  installParentDisconnectHandler: () => vi.fn(),
}));
vi.mock("../../zcode-server-cli/src/server-core/serverIdentity.js", () => ({
  resolveCoreServerId: async () => "isolated-web-server",
}));
vi.mock("../../zcode-server-cli/src/server-core/taskActivityTracker.js", () => ({
  createTaskActivityTracker: () => ({
    readRunningTaskCount: () => 0,
    onDidChangeRunningTaskCount: () => ({ dispose: vi.fn() }),
    dispose: vi.fn(),
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("HTTP Web入口显式声明Web，不改变通用HTTP服务器或stdio默认值", async () => {
  await import("../src/entry-http.js");
  await vi.waitFor(() => expect(createHttpServer).toHaveBeenCalledTimes(1));
  expect(createLocalServices).toHaveBeenCalledWith(
    expect.objectContaining({ standaloneWebHost: true }),
  );
});

it("独立Server Core显式声明Web；不依赖通用standalone-server authority猜测", async () => {
  vi.useFakeTimers();
  vi.stubEnv("ZCODE_BUILTIN_PROVIDER_CONFIG_FILE", "/isolated-web-config/provider.json");
  vi.spyOn(process, "on").mockReturnValue(process);
  vi.spyOn(process, "once").mockReturnValue(process);
  const { runServerCore } = await import("../../zcode-server-cli/src/server-core/core.js");
  await runServerCore(1);
  expect(createCoreHttpServer).toHaveBeenCalledTimes(1);
  expect(createLocalServices).toHaveBeenCalledWith(
    expect.objectContaining({
      standaloneWebHost: true,
      serviceAuthorityMode: "standalone-server",
    }),
  );
});
