import type { ServiceAuthorityMode } from "@zcode/shared";

export type ZCodeAgentPresentationSurface = "desktop" | "web";

export interface ZCodeAgentPresentationHostFacts {
  runtimeSurface?: "desktop_local_host" | "remote_workspace_host";
  serviceAuthorityMode?: ServiceAuthorityMode;
  /** 仅独立 Web 入口的可信装配事实；不能从普通 HTTP/stdio 或客户端请求推断。 */
  standaloneWebHost?: boolean;
  /** Main 已完成服务端单功能灰度裁决；未提供时保持历史 Host 装配语义。 */
  desktopContextPromptEnabled?: boolean;
}

export function resolveZCodeAgentPresentationSurface(
  facts: ZCodeAgentPresentationHostFacts,
): ZCodeAgentPresentationSurface | undefined {
  // Desktop 呈现能力必须从 Host 已有的可信装配事实推导，不能让每个调用方重复传递独立开关。
  // 独立 Web 由装配入口显式声明；普通 manual app-server 不推断 Web，避免原始指令泄露到 TUI。
  const isDesktopHost =
    facts.runtimeSurface === "desktop_local_host" ||
    facts.serviceAuthorityMode === "desktop-attached-remote";
  if (isDesktopHost) {
    return facts.desktopContextPromptEnabled === false ? undefined : "desktop";
  }
  return facts.standaloneWebHost === true ? "web" : undefined;
}
