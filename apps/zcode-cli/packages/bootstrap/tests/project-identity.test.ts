import { describe, expect, it } from "vitest";
import { projectIdFromWorkspace } from "@zcode/contracts";
import { projectIdFromDirectory } from "../src/app/paths.js";

describe("bootstrap project identity", () => {
  it("shares the full identity algorithm with persisted runtime and migration", () => {
    const path = `/workspace/${"a".repeat(100)}/中文`;
    const remote = "remote:host:repo";
    expect(projectIdFromDirectory(path)).toBe(projectIdFromWorkspace({ workspacePath: path }));
    expect(projectIdFromDirectory(path, remote)).toBe(
      projectIdFromWorkspace({ workspacePath: path, workspaceIdentity: remote }),
    );
    expect(projectIdFromDirectory(path, remote)).not.toBe(projectIdFromDirectory(path));
  });
});
