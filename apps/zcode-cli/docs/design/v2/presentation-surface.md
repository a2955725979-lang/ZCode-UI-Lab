# Presentation surface

The user approved adding `web` to the existing `--surface` CLI values. `terminal` (the default), `desktop` and `web` normalize to `terminal`, `zcode_desktop` and `zcode_web`. The option remains limited to headless prompts/targets and protocol app-server/agent-server; TUI rejects the explicit surface option.

`zcode_desktop` keeps its Desktop context and appends the shared stable follow-up suggestions prompt. `zcode_web` receives only that same follow-up prompt in a stable `followup_suggestions` section; it does not enable Gen UI, code comments or Desktop file-rendering claims. Workflow actors and custom-system-prompt paths continue to omit user-facing guidance. UI preference changes do not alter either stable prompt.

Services derives `desktop` from trusted Desktop local/attached-remote Host facts, preserving mobile shared-Host behavior and the existing Desktop context gate. Otherwise it derives `web` only when the composition root explicitly supplies `standaloneWebHost: true`. The standalone HTTP Web entry and standalone server Core supply this fact; a generic/manual stdio app-server and ordinary service callers do not. The process command resolver overwrites stale/orphan `--surface` arguments with the trusted derived surface without consuming adjacent options. No runtime interaction, ownership, queue or request/response protocol is changed.

```text
Desktop Host / desktop-attached remote → desktop → --surface desktop → zcode_desktop
explicit standalone Web composition → web → --surface web → zcode_web
manual/TUI/no trusted host fact → no injected option → terminal
```

Regression checks cover CLI normalization and unsupported invocations, protocol-to-runtime propagation, trusted resolver precedence and generic-server fallback, process arguments, stable shared prompt identity, Web omission of Desktop capability claims, and terminal/workflow/custom prompt omission. Tests use injected fake prompt/runtime dependencies and never call a model.
