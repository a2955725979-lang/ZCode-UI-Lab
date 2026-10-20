import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  GEN_UI_STATIC_DOMAINS,
  genUiStateTargetSchema,
  type GenUiStateChange,
  type GenUiStateTarget,
  type GenUiWidgetState,
} from "@zcode/shared/gen-ui";
import type { PluginSandboxRegisterInput } from "@zcode/shared/mcp-apps";
import { exampleGenUiPrepare } from "./contract.example.js";
import { IGenUiService, type GenUiPrepareParams } from "./index.js";
import { createGenUiService } from "./node.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gen-ui-contract-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const outputRoot = join(root, "output");
  await mkdir(outputRoot);
  const target: GenUiStateTarget = {
    workspacePath: root,
    workspaceIdentity: "ssh:contract:/workspace",
    sessionId: "session",
    path: join(outputRoot, "chart.html"),
  };
  return { root, stateRoot: join(root, "state"), outputRoot, target };
}

function service(options: Parameters<typeof createGenUiService>[0]) {
  const value = createGenUiService(options);
  cleanup.push(() => value.dispose());
  return value;
}

describe("gen-ui-service contract", () => {
  it("exposes the typed service descriptor, example and Node factory through public entries", () => {
    expect(IGenUiService.channelName).toBe("gen-ui");
    expectTypeOf(exampleGenUiPrepare).toMatchTypeOf<GenUiPrepareParams>();
    expectTypeOf<ReturnType<typeof createGenUiService>>().toMatchTypeOf<IGenUiService>();
    const { html, ownerWebContentsId, instanceKey, ...target } = exampleGenUiPrepare;
    expect(genUiStateTargetSchema.parse(target)).toEqual(target);
    expect(html).toContain("chart");
    expect(ownerWebContentsId).toBeGreaterThan(0);
    expect(instanceKey).not.toBe("");
  });

  it("reads Host output retained by a fork but rejects outside paths and symbolic links", async () => {
    const input = await fixture();
    const api: IGenUiService = service(input);
    const html = "<div>Retained fragment</div>";
    await writeFile(input.target.path, html);
    await expect(api.readDocument({ ...input.target, sessionId: "fork" })).resolves.toEqual({
      path: input.target.path,
      html,
    });
    const outside = join(input.root, "outside.html");
    await writeFile(outside, "<p>Outside</p>");
    await expect(api.readDocument({ ...input.target, path: outside })).rejects.toThrow(
      "host output directory",
    );
    const linked = join(input.outputRoot, "linked.html");
    await symlink(outside, linked);
    await expect(api.readDocument({ ...input.target, path: linked })).rejects.toThrow(
      "symbolic links",
    );
  });

  it("persists complete widget state and isolates workspace identities and sessions", async () => {
    const input = await fixture();
    const first: IGenUiService = service(input);
    const second: IGenUiService = service(input);
    const state: GenUiWidgetState = {
      modelContent: { selected: "chart" },
      privateContent: { tab: 2 },
    };
    await expect(first.getState(input.target)).resolves.toBeNull();
    await first.setState({ target: input.target, state });
    await expect(second.getState(input.target)).resolves.toEqual(state);
    const { path: _path, ...scope } = input.target;
    await expect(second.listState(scope)).resolves.toEqual([{ path: input.target.path, state }]);
    for (const target of [
      { ...input.target, workspaceIdentity: "ssh:other:/workspace" },
      { ...input.target, sessionId: "other-session" },
    ]) {
      await expect(second.getState(target)).resolves.toBeNull();
      const { path: _targetPath, ...otherScope } = target;
      await expect(second.listState(otherScope)).resolves.toEqual([]);
    }
  });

  it("publishes state changes only when an independent service can read the durable snapshot", async () => {
    const input = await fixture();
    const writer: IGenUiService = service(input);
    const reader: IGenUiService = service(input);
    const events: GenUiStateChange[] = [];
    const snapshots: Array<Promise<GenUiWidgetState | null>> = [];
    const subscription = writer.onStateChanged((change) => {
      events.push(change);
      snapshots.push(reader.getState(change.target));
    });
    cleanup.push(() => subscription.dispose());
    const state = { modelContent: { selection: 1 }, privateContent: null };
    expect(events).toEqual([]);
    await writer.setState({ target: input.target, state });
    expect(events).toEqual([{ target: input.target, state }]);
    await expect(Promise.all(snapshots)).resolves.toEqual([state]);
  });

  it("rejects failed persistence without publishing an accepted state", async () => {
    const input = await fixture();
    // 回归依据：通知只能投影已持久化状态，真实文件阻塞状态目录可验证失败不产生成功通知。
    await writeFile(input.stateRoot, "not a directory");
    const api: IGenUiService = service(input);
    const events: GenUiStateChange[] = [];
    const subscription = api.onStateChanged((change) => events.push(change));
    cleanup.push(() => subscription.dispose());
    await expect(
      api.setState({ target: input.target, state: { modelContent: 1, privateContent: null } }),
    ).rejects.toThrow();
    expect(events).toEqual([]);
  });

  it("registers explicit Gen UI provenance with restricted CSP and escaped initial state", async () => {
    const input = await fixture();
    const registrations: PluginSandboxRegisterInput[] = [];
    const api: IGenUiService = service({
      ...input,
      registerSandbox: async (registration) => {
        registrations.push(registration);
        return {
          instance: registration.instance,
          sandboxId: "contract-sandbox",
          initId: 1,
          partition: "contract-gen-ui",
          shellUrl: "zcode-sandbox://contract",
        };
      },
    });
    const state = {
      modelContent: { selected: 1 },
      privateContent: "</script><script>bad()</script>",
    };
    await api.setState({ target: input.target, state });
    const prepare: GenUiPrepareParams = {
      ...input.target,
      html: "<div>Chart</div>",
      ownerWebContentsId: 7,
      instanceKey: "message:1",
    };
    const handle = await api.prepareSandbox(prepare);
    expect(handle.sandboxId).toBe("contract-sandbox");
    expect(registrations).toHaveLength(1);
    const registration = registrations[0]!;
    expect(registration).toMatchObject({
      contentKind: "gen-ui",
      workspacePath: input.target.workspacePath,
      workspaceIdentity: input.target.workspaceIdentity,
      sessionId: input.target.sessionId,
      ownerWebContentsId: 7,
      scopeId: "message:1",
      csp: {
        connectDomains: [],
        frameDomains: [],
        baseUriDomains: [],
        resourceDomains: GEN_UI_STATIC_DOMAINS.map((host) => `https://${host}`),
      },
    });
    expect(registration.pluginId).toBeUndefined();
    expect(registration.serverName).toBeUndefined();
    expect(registration.html).not.toContain("<script>bad()");
    const initial = /id="zcode-gen-ui-initial-state">([^]*?)<\/script>/u.exec(registration.html);
    expect(JSON.parse(initial![1]!)).toEqual(state);
    expect(registration.html.indexOf("zcode-gen-ui-initial-state")).toBeLessThan(
      registration.html.indexOf("__ZCODE_GEN_UI_RUNTIME__"),
    );
    await expect(api.prepareSandbox({ ...prepare, html: "<html></html>" })).rejects.toThrow(
      "fragment",
    );
    await expect(api.prepareSandbox({ ...prepare, ownerWebContentsId: 0 })).rejects.toThrow();
    expect(registrations).toHaveLength(1);
  });

  it("does not prepare a sandbox without the desktop registration port", async () => {
    const input = await fixture();
    const api: IGenUiService = service(input);
    await expect(
      api.prepareSandbox({
        ...input.target,
        html: "<div>Chart</div>",
        ownerWebContentsId: 7,
        instanceKey: "message:1",
      }),
    ).rejects.toThrow("desktop sandbox");
  });
});
