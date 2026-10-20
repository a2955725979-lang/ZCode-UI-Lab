import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolvePortableApplicationHome } from "./portable-home.mjs";

test("default root is dedicated Application Support, without creating it", () => {
  const base = mkdtempSync(join(tmpdir(), "portable-home-unit-"));
  try {
    const target = resolvePortableApplicationHome({ homeDir: base });
    assert.equal(target, join(base, "Library/Application Support/ZCode-UI-Lab-Portable"));
    assert.equal(existsSync(target), false);
  } finally { rmSync(base, { recursive: true }); }
});
test("dedicated direct temporary scope is accepted", () => {
  const target = mkdtempSync(join(tmpdir(), "zcode-ui-lab-portable-test-"));
  try { assert.equal(resolvePortableApplicationHome({ testHome: target }), realpathSync(target)); }
  finally { rmSync(target, { recursive: true }); }
});
test("relative paths fail without creation", () => {
  assert.throws(() => resolvePortableApplicationHome({ testHome: "zcode-ui-lab-portable-test-relative" }), /absolute/);
});
test("ordinary temporary directory fails", () => {
  const target = join(tmpdir(), `portable-wrong-${process.pid}`);
  assert.throws(() => resolvePortableApplicationHome({ testHome: target }), /dedicated/);
  assert.equal(existsSync(target), false);
});
test("outside path fails before mkdir", () => {
  const base = mkdtempSync(join(tmpdir(), "portable-home-unit-"));
  const target = join(base, "outside", "zcode-ui-lab-portable-test-outside");
  try {
    assert.throws(() => resolvePortableApplicationHome({ testHome: target }), /dedicated/);
    assert.equal(existsSync(join(base, "outside")), false);
  } finally { rmSync(base, { recursive: true }); }
});
test("dedicated-name symbolic link cannot escape", () => {
  const outside = mkdtempSync(join(tmpdir(), "portable-home-unit-"));
  const target = join(tmpdir(), `zcode-ui-lab-portable-test-link-${process.pid}`);
  let linkCreated = false;
  try {
    symlinkSync(outside, target);
    linkCreated = true;
    assert.throws(() => resolvePortableApplicationHome({ testHome: target }), /symbolic link/);
  } finally {
    // Node 24.12 的 rmSync 会拒绝指向目录的链接；只 unlink 本测试创建的链接。
    if (linkCreated) unlinkSync(target);
    rmSync(outside, { recursive: true });
  }
});
