// @vitest-environment jsdom
import { createElement, useEffect, type ReactNode } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppSettings, IPlatformService } from "@zcode/shared";
import { ServiceProvider } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";

function createSettings(value: string): AppSettings {
  return { providerFamilyDomain: value } as AppSettings;
}

function createServices(settings: AppSettings) {
  return {
    settingService: {
      get: vi.fn(async () => settings),
      update: vi.fn(async () => {}),
    },
    botsService: {
      syncAppRuntimePreferences: vi.fn(async () => {}),
    },
    broadcastService: {
      send: vi.fn(async () => {}),
    },
    zcodeAgentService: {
      syncAppRuntimePreferences: vi.fn(async () => {}),
    },
  } as never;
}

function SettingsProbe({ onSnapshot }: { onSnapshot: (value: string | null) => void }) {
  const { settings } = useSettings();
  useEffect(() => {
    onSnapshot((settings?.providerFamilyDomain as string | undefined) ?? null);
  }, [onSnapshot, settings]);
  return null;
}

function EnvironmentProbes({
  remoteServices,
  localServices,
  onRemoteSnapshot,
  onLocalSnapshot,
}: {
  remoteServices: ReturnType<typeof createServices>;
  localServices: ReturnType<typeof createServices>;
  onRemoteSnapshot: (value: string | null) => void;
  onLocalSnapshot: (value: string | null) => void;
}): ReactNode {
  return createElement(
    PlatformProvider,
    { platform: {} as IPlatformService },
    createElement(
      ServiceProvider,
      { services: remoteServices },
      createElement(SettingsProbe, { onSnapshot: onRemoteSnapshot }),
      createElement(
        ServiceProvider,
        { services: localServices },
        createElement(SettingsProbe, { onSnapshot: onLocalSnapshot }),
      ),
    ),
  );
}

describe("useSettings Environment isolation", () => {
  it("keeps concurrent Local and Remote setting snapshots independent", async () => {
    const remoteServices = createServices(createSettings("remote"));
    const localServices = createServices(createSettings("local"));
    let remoteSnapshot: string | null = null;
    let localSnapshot: string | null = null;

    render(
      createElement(EnvironmentProbes, {
        remoteServices,
        localServices,
        onRemoteSnapshot: (value) => {
          remoteSnapshot = value;
        },
        onLocalSnapshot: (value) => {
          localSnapshot = value;
        },
      }),
    );

    await waitFor(() => {
      expect(remoteSnapshot).toBe("remote");
      expect(localSnapshot).toBe("local");
    });
    expect(remoteServices.settingService.get).toHaveBeenCalledOnce();
    expect(localServices.settingService.get).toHaveBeenCalledOnce();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createEnvironment(initialEnabled = true, value = "local") {
  let persisted = { ...createSettings(value), followupSuggestionsEnabled: initialEnabled };
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const services = {
    settingService: {
      get: vi.fn(async () => ({ ...persisted })),
      update: vi.fn(async (patch: Partial<AppSettings>) => {
        persisted = { ...persisted, ...patch };
      }),
    },
    botsService: { syncAppRuntimePreferences: vi.fn(async () => {}) },
    broadcastService: { send: vi.fn(async () => {}) },
    zcodeAgentService: { syncAppRuntimePreferences: vi.fn(async () => {}) },
  };
  const platform = {
    onSettingsChanged: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    syncAppSettings: vi.fn((_patch: Partial<AppSettings>) => notify()),
  } as unknown as IPlatformService;
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      PlatformProvider,
      { platform },
      createElement(ServiceProvider, { services: services as never }, children),
    );
  return {
    services,
    platform,
    wrapper,
    notify,
    setPersisted: (enabled: boolean) => {
      persisted = { ...persisted, followupSuggestionsEnabled: enabled };
    },
  };
}

describe("useSettings invalidation and write ordering", () => {
  it("re-reads after a notification invalidates an in-flight old value instead of dropping the event", async () => {
    const env = createEnvironment();
    const oldRead = deferred<AppSettings>();
    env.services.settingService.get.mockImplementationOnce(() => oldRead.promise);
    const observed: Array<boolean | undefined> = [];
    const hook = renderHook(
      () => {
        const state = useSettings();
        useEffect(() => {
          observed.push(state.settings?.followupSuggestionsEnabled);
        }, [state.settings]);
        return state;
      },
      { wrapper: env.wrapper },
    );
    await waitFor(() => expect(env.services.settingService.get).toHaveBeenCalledOnce());
    act(() => {
      env.setPersisted(false);
      env.notify();
    });
    await act(async () => {
      oldRead.resolve({ ...createSettings("local"), followupSuggestionsEnabled: true });
    });
    await waitFor(() =>
      expect(hook.result.current.settings?.followupSuggestionsEnabled).toBe(false),
    );
    expect(env.services.settingService.get).toHaveBeenCalledTimes(2);
    expect(observed).not.toContain(true);
    expect(env.services.settingService.update).not.toHaveBeenCalled();
    expect(env.platform.syncAppSettings).not.toHaveBeenCalled();
    expect(env.services.broadcastService.send).not.toHaveBeenCalled();
    hook.unmount();
  });

  it("coalesces repeated notifications but does another read when a later notification invalidates the queued read", async () => {
    const env = createEnvironment();
    const first = deferred<AppSettings>();
    const second = deferred<AppSettings>();
    env.services.settingService.get
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const hook = renderHook(() => useSettings(), { wrapper: env.wrapper });
    await waitFor(() => expect(env.services.settingService.get).toHaveBeenCalledTimes(1));
    act(() => {
      env.setPersisted(false);
      env.notify();
      env.notify();
    });
    await act(async () => {
      first.resolve({ ...createSettings("local"), followupSuggestionsEnabled: true });
    });
    await waitFor(() => expect(env.services.settingService.get).toHaveBeenCalledTimes(2));
    act(() => {
      env.setPersisted(true);
      env.notify();
    });
    await act(async () => {
      second.resolve({ ...createSettings("local"), followupSuggestionsEnabled: false });
    });
    await waitFor(() =>
      expect(hook.result.current.settings?.followupSuggestionsEnabled).toBe(true),
    );
    expect(env.services.settingService.get).toHaveBeenCalledTimes(3);
    hook.unmount();
  });

  it("retries the invalidated read after an old read rejects", async () => {
    const env = createEnvironment();
    const first = deferred<AppSettings>();
    env.services.settingService.get.mockImplementationOnce(() => first.promise);
    const hook = renderHook(() => useSettings(), { wrapper: env.wrapper });
    await waitFor(() => expect(env.services.settingService.get).toHaveBeenCalledOnce());
    act(() => {
      env.setPersisted(false);
      env.notify();
    });
    await act(async () => {
      first.reject(new Error("obsolete read failed"));
    });
    await waitFor(() =>
      expect(hook.result.current.settings?.followupSuggestionsEnabled).toBe(false),
    );
    expect(hook.result.current.error).toBeNull();
    expect(env.services.settingService.get).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it.each([false, true])(
    "does not notify before persistence succeeds, then refreshes value %s without write loops",
    async (enabled) => {
      const env = createEnvironment(!enabled);
      const write = deferred<void>();
      env.services.settingService.update.mockImplementationOnce(async () => {
        await write.promise;
        env.setPersisted(enabled);
      });
      const hook = renderHook(() => useSettings(), { wrapper: env.wrapper });
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      let updating!: Promise<void>;
      act(() => {
        updating = hook.result.current.update({ followupSuggestionsEnabled: enabled });
      });
      expect(env.platform.syncAppSettings).not.toHaveBeenCalled();
      await act(async () => {
        write.resolve();
        await updating;
      });
      expect(env.platform.syncAppSettings).toHaveBeenCalledExactlyOnceWith({
        followupSuggestionsEnabled: enabled,
      });
      expect(hook.result.current.settings?.followupSuggestionsEnabled).toBe(enabled);
      expect(env.services.settingService.update).toHaveBeenCalledOnce();
      expect(env.services.broadcastService.send).not.toHaveBeenCalled();
      expect(env.services.botsService.syncAppRuntimePreferences).not.toHaveBeenCalled();
      expect(env.services.zcodeAgentService.syncAppRuntimePreferences).not.toHaveBeenCalled();
      hook.unmount();
    },
  );

  it("does not notify or change the snapshot after a failed setting write", async () => {
    const env = createEnvironment();
    const error = new Error("write rejected");
    env.services.settingService.update.mockRejectedValueOnce(error);
    const hook = renderHook(() => useSettings(), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await expect(hook.result.current.update({ followupSuggestionsEnabled: false })).rejects.toBe(
        error,
      );
    });
    expect(env.platform.syncAppSettings).not.toHaveBeenCalled();
    expect(hook.result.current.settings?.followupSuggestionsEnabled).toBe(true);
    expect(env.services.settingService.get).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it("keeps Local/Remote invalidations, late reads and snapshots service-scoped", async () => {
    const local = createEnvironment(true, "local");
    const remote = createEnvironment(false, "remote");
    const oldLocal = deferred<AppSettings>();
    local.services.settingService.get.mockImplementationOnce(() => oldLocal.promise);
    const localHook = renderHook(() => useSettings(), { wrapper: local.wrapper });
    const remoteHook = renderHook(() => useSettings(), { wrapper: remote.wrapper });
    await waitFor(() => expect(remoteHook.result.current.loading).toBe(false));
    act(() => {
      local.setPersisted(false);
      local.notify();
    });
    await act(async () => {
      oldLocal.resolve({ ...createSettings("local"), followupSuggestionsEnabled: true });
    });
    await waitFor(() =>
      expect(localHook.result.current.settings?.followupSuggestionsEnabled).toBe(false),
    );
    expect(localHook.result.current.settings?.providerFamilyDomain).toBe("local");
    expect(remoteHook.result.current.settings?.providerFamilyDomain).toBe("remote");
    expect(remote.services.settingService.get).toHaveBeenCalledOnce();
    expect(local.services.settingService.get).toHaveBeenCalledTimes(2);
    localHook.unmount();
    remoteHook.unmount();
  });

  it("preserves the previous snapshot on an uninvalidated read failure and can refresh again", async () => {
    const env = createEnvironment();
    const hook = renderHook(() => useSettings(), { wrapper: env.wrapper });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const error = new Error("read unavailable");
    env.services.settingService.get.mockImplementationOnce(() => {
      throw error;
    });
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.settings?.followupSuggestionsEnabled).toBe(true);
    expect(hook.result.current.error).toBe(error);
    expect(hook.result.current.loading).toBe(false);
    env.setPersisted(false);
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.settings?.followupSuggestionsEnabled).toBe(false);
    expect(hook.result.current.error).toBeNull();
    expect(env.services.settingService.get).toHaveBeenCalledTimes(3);
    hook.unmount();
  });

  it("shares an initial read among components using the same service", async () => {
    const env = createEnvironment();
    const read = deferred<AppSettings>();
    env.services.settingService.get.mockImplementationOnce(() => read.promise);
    const hook = renderHook(() => [useSettings(), useSettings()], { wrapper: env.wrapper });
    await waitFor(() => expect(env.services.settingService.get).toHaveBeenCalledOnce());
    await act(async () => {
      read.resolve({ ...createSettings("local"), followupSuggestionsEnabled: true });
    });
    await waitFor(() => expect(hook.result.current.every((state) => !state.loading)).toBe(true));
    expect(env.services.settingService.get).toHaveBeenCalledOnce();
    hook.unmount();
  });
});
