import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";
import { getApplicationHomeDir } from "@zcode/shared/application-home";
import { dirname, join } from "node:path";
import { maybeThrowStorageFsFault } from "../fs-fault-injection.js";

export function getDefaultSessionDbPath(): string {
  return join(getApplicationHomeDir(process.env, homedir()), ".zcode", "cli", "db", "db.sqlite");
}

export function ensureParentDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    maybeThrowStorageFsFault({ operation: "mkdir", path: parent });
    mkdirSync(parent, { recursive: true });
  }
}
