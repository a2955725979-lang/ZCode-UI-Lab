# Explicit application home for an isolated UI development instance

This change is local to the ZCode UI Lab checkout. Normal launches without the new variable retain their existing behavior. This is application configuration isolation, not an operating-system sandbox.

Distribution scope: the application-home resolver, consumers, bundle helper and their tests are in this repository. The machine-specific daily Dock launcher (`run-ui-lab-p0.mjs`), native entry, preview guardian and cutover/rollback tools are outside the repository and are not distributed. References to those launchers below document the local integration; cloning this source does not recreate that machine's Dock installation or data. The existing `packaging/` Portable workflow is separate and was not rebuilt for the 2026-10-22 source update.

## Single contract and ownership

`ZCODE_APPLICATION_HOME` is an opt-in absolute application home. `@zcode/shared/application-home` owns its validation and resolution; Desktop, services and Agent CLI consume that public contract. The root must not be the real OS home or a directory within its `.zcode`, `.agents` or `.claude` trees (including symlink aliases). Invalid input fails before bootstrap; it never silently falls back to production data. Empty/unset input keeps normal behavior.

When present it outranks `ZCODE_DATA_BASE_DIR`, `ZCODE_DESKTOP_HOME_DIR`, saved `dataBaseDir`, and any desktop cache/profile overrides. Application data is `<root>/.zcode`, settings and credentials are `<root>/.zcode/v2`, CLI data is `<root>/.zcode/cli`, global skills/instructions/MCP and compatibility imports resolve under the application home. System identity fields retain OS semantics. The resolver never assigns `HOME`, `USERPROFILE` or `CODEX_HOME`.

```text
launch variable → shared application-home resolver → Main bootstrap / services / Agent CLI
                                                  ├── settings + credentials + DB + logs
                                                  ├── global content + default workspace
                                                  └── Electron userData / sessionData / cache
```

The existing services data-root owner remains authoritative. In isolation it cannot be switched by saved settings, `setDataBaseDir`, or the settings migration RPC; requests to migrate out fail without copying or writing. Desktop bootstrap, hardware acceleration and startup workspace restoration read the same settings file.

## Startup and native integration

- Early Main bootstrap creates the isolated Electron `userData` and `sessionData` directories synchronously before other Main modules load or Electron readiness can occur. This prevents fresh-launch Chromium/DevTools writes from racing directory creation; filesystem errors abort startup.
- Identity is `ZCode UI Lab`; Electron profile/session/cache and macOS dev bundle are derived from the explicit root. The daily Lab home retains `dev.zcode.app.ui-lab`; the local launcher gives each other resolved application home a stable, distinct identifier under `dev.zcode.app.ui-lab.*`. The bundle helper accepts only this isolated identifier family, includes the selected identifier in its cache check, and rebuilds an older cached bundle when its identifier differs. No isolated bundle declares the `zcode` scheme. Main does not register the production protocol handler or Finder workflow in isolation.
- The launcher and early Main bootstrap apply a narrow inherited-environment allowlist (OS process necessities, selected build/runtime values). API credentials, external configuration pointers and test identity overrides do not flow into the app. No `.env` file or login-shell startup file is loaded. Isolated Agent child creation uses explicit application/data roots instead of changing HOME; normal launches retain the existing compatibility branch.
- The isolated UI preview does not start the cron scheduler or automatically restore remote control. These are explicit preview limitations; normal/manual authentication and product authorization remain unchanged. No fake identity, entitlement or model request is introduced.
- Global import/discovery uses only the isolated root; Chrome credential/profile import is unavailable in this preview. No existing credentials, browser data, sessions or plugin state is copied. User-chosen workspace files remain accessible with the account's OS permissions.
- Official automatic updates remain off for this preview. OS temporary files may still use the system temporary directory; this is documented rather than represented as full filesystem confinement.

## Acceptance

Tests must cover invalid/alias roots, precedence over saved/external roots, consistent settings/credentials/global content/CLI data paths, rejected migrations with no copy, unchanged HOME/CODEX_HOME values, sanitized inherited credentials, no login-shell execution, and separate bundle identity without a production URL scheme. Bundle tests also cover unchanged daily and ordinary-dev identifiers, distinct isolated-home identifiers, rejection of arbitrary identifiers, and cache refresh when an old isolated bundle has the wrong identifier. Existing default-path tests must pass.

Before claiming runtime isolation, launch a fresh instance without model messages and verify actual file locations, no restored tasks/remote links, independent single-instance lock and protocol handler, and child-process cleanup. Unit/source checks cannot substitute for those runtime observations. Normal OAuth still requires its real supported callback/polling flow and is not claimed verified by the preview.
