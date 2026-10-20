import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./stage-portable.mjs", import.meta.url));
for (const scenario of ["work-inside-source", "output-inside-source", "symlink-into-source", "existing-output"]) {
  test(`staging rejects ${scenario} before creating or copying`, () => {
    const root = mkdtempSync(join(tmpdir(), "zcode-portable-staging-test-"));
    try {
      const source = join(root, "source");
      mkdirSync(source);
      let work = join(root, "work");
      let output = join(root, "output");
      if (scenario === "work-inside-source") work = join(source, "work");
      if (scenario === "output-inside-source") output = join(source, "output");
      if (scenario === "symlink-into-source") {
        const alias = join(root, "alias");
        symlinkSync(source, alias, "dir");
        work = join(alias, "work");
      }
      if (scenario === "existing-output") mkdirSync(output);
      const result = spawnSync(process.execPath,
        [script, `--source=${source}`, `--work=${work}`, `--output=${output}`], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /outside the input source|existing output/);
      assert.equal(existsSync(work), false);
      assert.equal(existsSync(join(source, "work")), false);
      assert.equal(existsSync(join(source, "output")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
