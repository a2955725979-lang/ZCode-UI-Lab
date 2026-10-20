// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSessionHistoryModeStore,
  createSessionHistoryModePredicate,
  setSessionHistoryMode,
} from "@/store/sessionHistoryModeStore.js";

const conversation = { workspacePath: "/shared", workspacePurpose: "conversation" as const };
const project = { workspacePath: "/project", workspacePurpose: "project" as const };

beforeEach(() => localStorage.clear());

describe("session history mode owner", () => {
  it("defaults history to each mode and remembers independent All/Chat/Work choices", () => {
    const store = createSessionHistoryModeStore();
    expect(store.getSessionHistoryFilter("chat")).toBe("chat");
    expect(store.getSessionHistoryFilter("work")).toBe("work");
    expect(localStorage.length).toBe(0);
    store.setSessionHistoryFilter("chat", "all");
    store.setSessionHistoryFilter("work", "chat");
    const reopened = createSessionHistoryModeStore();
    expect(reopened.getSessionHistoryFilter("chat")).toBe("all");
    expect(reopened.getSessionHistoryFilter("work")).toBe("chat");
    expect(store.getExplicitSessionHistoryMode(conversation, "old")).toBeUndefined();
    expect(localStorage.length).toBe(2);
  });

  it("keeps a filter choice locally when preference storage is unavailable", () => {
    const store = createSessionHistoryModeStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(() => store.setSessionHistoryFilter("chat", "all")).not.toThrow();
    expect(store.getSessionHistoryFilter("chat")).toBe("all");
    expect(store.getSessionHistoryFilter("work")).toBe("work");
  });

  it("keeps legacy classification implicit and never writes while reading", () => {
    const store = createSessionHistoryModeStore();
    expect(store.getSessionHistoryMode(conversation, "old", "conversation")).toBe("chat");
    expect(store.getSessionHistoryMode(project, "old", "project")).toBe("work");
    expect(store.getSessionHistoryMode(project, undefined)).toBe("work");
    expect(store.getExplicitSessionHistoryMode(conversation, "old")).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });

  it("persists each session independently and reloads manual moves in both directions", () => {
    const firstWindow = createSessionHistoryModeStore();
    const secondWindow = createSessionHistoryModeStore();
    firstWindow.setSessionHistoryMode(conversation, "a", "work");
    secondWindow.setSessionHistoryMode(project, "b", "chat");
    expect(localStorage.length).toBe(2);
    const reopened = createSessionHistoryModeStore();
    expect(reopened.getSessionHistoryMode(conversation, "a", "conversation")).toBe("work");
    expect(reopened.getSessionHistoryMode(project, "b", "project")).toBe("chat");
    reopened.setSessionHistoryMode(conversation, "a", "chat");
    expect(firstWindow.getSessionHistoryMode(conversation, "a")).toBe("chat");
  });

  it("isolates identical session IDs across workspace identities and delimiter-like paths", () => {
    const store = createSessionHistoryModeStore();
    const remoteA = { workspacePath: "/same", workspaceIdentity: "remote:a:/same" };
    const remoteB = { workspacePath: "/same", workspaceIdentity: "remote:b:/same" };
    store.setSessionHistoryMode(remoteA, "same-id", "chat");
    store.setSessionHistoryMode(remoteB, "same-id", "work");
    store.setSessionHistoryMode({ workspacePath: "/a::b" }, "c", "chat");
    store.setSessionHistoryMode({ workspacePath: "/a" }, "b::c", "work");
    expect(store.getSessionHistoryMode(remoteA, "same-id")).toBe("chat");
    expect(store.getSessionHistoryMode(remoteB, "same-id")).toBe("work");
    expect(store.getSessionHistoryMode({ workspacePath: "/a::b" }, "c")).toBe("chat");
    expect(localStorage.length).toBe(4);
  });

  it("late automatic claims never undo an explicit move", () => {
    const store = createSessionHistoryModeStore();
    expect(store.claimSessionHistoryMode(conversation, "new", "work")).toEqual({
      mode: "work",
      persisted: true,
    });
    store.setSessionHistoryMode(conversation, "new", "chat");
    expect(store.claimSessionHistoryMode(conversation, "new", "work")).toEqual({
      mode: "chat",
      persisted: true,
    });
  });

  it("notifies local and external changes without rewriting external storage", () => {
    const store = createSessionHistoryModeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeSessionHistoryModes(listener);
    store.setSessionHistoryMode(conversation, "a", "chat");
    expect(listener).toHaveBeenCalledTimes(1);
    const key = localStorage.key(0)!;
    localStorage.setItem(key, "work");
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: "work" }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSessionHistoryMode(conversation, "a")).toBe("work");
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(2);
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("ignores corrupt values and reports writes that did not persist", () => {
    const storage = {
      getItem: vi.fn(() => "broken"),
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    const store = createSessionHistoryModeStore(storage);
    expect(store.getSessionHistoryMode(conversation, "old", "conversation")).toBe("chat");
    expect(() => store.setSessionHistoryMode(conversation, "old", "work")).toThrow("quota");
    expect(store.claimSessionHistoryMode(conversation, "new", "work")).toEqual({
      mode: "work",
      persisted: false,
    });
    expect(store.getExplicitSessionHistoryMode(conversation, "new")).toBe("work");
    expect(store.hasUnpersistedSessionHistoryMode(conversation, "new")).toBe(true);
  });

  it("uses the same predicate for explicit project and non-project moves", () => {
    setSessionHistoryMode(conversation, "work-no-project", "work");
    setSessionHistoryMode(project, "chat-in-project", "chat");
    const chat = createSessionHistoryModePredicate("chat", [conversation, project]);
    const work = createSessionHistoryModePredicate("work", [conversation, project]);
    const all = createSessionHistoryModePredicate("all", [conversation, project]);
    const items = [
      { ...conversation, taskId: "work-no-project" },
      { ...project, taskId: "chat-in-project" },
      { ...conversation, taskId: "legacy-chat" },
      { ...project, taskId: "legacy-work" },
    ];
    expect(items.filter(all)).toEqual(items);
    expect(items.filter(chat).map((item) => item.taskId)).toEqual([
      "chat-in-project",
      "legacy-chat",
    ]);
    expect(items.filter(work).map((item) => item.taskId)).toEqual([
      "work-no-project",
      "legacy-work",
    ]);
    setSessionHistoryMode(project, "chat-in-project", "work");
    // 确认期间归属变化不得改动已捕获的批量选择；新 predicate 才采用新版本。
    expect(chat(items[1]!)).toBe(true);
    expect(createSessionHistoryModePredicate("chat", [conversation, project])(items[1]!)).toBe(
      false,
    );
  });
});
