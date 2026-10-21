import { describe, expect, it } from "vitest";
import { projectIdFromWorkspace } from "../src/index.js";

describe("projectIdFromWorkspace", () => {
  it("uses every byte of long and Chinese workspace paths", () => {
    const prefix = `/workspace/${"a".repeat(100)}`;
    const first = projectIdFromWorkspace({ workspacePath: `${prefix}/中文/甲` });
    const second = projectIdFromWorkspace({ workspacePath: `${prefix}/中文/乙` });

    expect(first).toMatch(/^proj_v2_[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(projectIdFromWorkspace({ workspacePath: `${prefix}/中文/甲` })).toBe(first);
  });

  it("uses the trimmed remote identity rather than a shared remote path", () => {
    const workspacePath = "/workspace/shared";
    const local = projectIdFromWorkspace({ workspacePath });
    const first = projectIdFromWorkspace({ workspaceIdentity: " remote:one ", workspacePath });
    const second = projectIdFromWorkspace({ workspaceIdentity: "remote:two", workspacePath });

    expect(first).toBe(projectIdFromWorkspace({ workspaceIdentity: "remote:one", workspacePath }));
    expect(first).not.toBe(second);
    expect(first).not.toBe(local);
    expect(projectIdFromWorkspace({ workspaceIdentity: "  ", workspacePath })).toBe(local);
  });
});
