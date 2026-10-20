# Task collaboration workspace

## Product contract

Implement the approved UI Lab P0/P1 loop: direct send with optional Work brief → inline runtime questions → real results → optional next prompts. Chat/Work history classification remains unchanged. Chat sends directly. No extra inference request generates questions or next prompts; new model calls are not authorized for acceptance.

## Owners and event order

```text
composer draft (text + optional taskStart brief; attachments transient)
  → direct send once → existing submission + commandId → CommandInbox / runtime
  → pendingInteractions → inline card in every pane → resolveInteraction
  → successful TodoWrite → sessionStore → snapshot.plan → ConversationStatusPanel
  → completed assistant text tail → next-prompt parser → up to three compact suggestions
  → explicit accept, same scope/revision, still empty → existing editor replace → user sends
```

- Focus remains renderer-local: own composer/card focus → pending card → final authoritative
  clear → visible editable composer. `SessionPane` supplies its card boundary to the composer;
  outside navigation, scope changes or inactive/hidden state cancel the return intent. Consecutive
  pending requests and failed responses retain card focus. See `../elicitation-keyboard-behavior.md`.

- The current composer draft owner persists optional Work brief outcome/deliverable/constraints alongside text. Work draft toolbar exposes a default-on brief button; its three optional single-line inputs expand inside the composer shell. Sending never opens a startup modal or requires a confirmation signature. Append nonempty brief fields to the same original submission only when the brief setting is enabled, using current locale labels; attachments/context identity, pending lock, prewarm and revision-safe restore are unchanged. Disabling the setting hides the brief and excludes its fields from submission without deleting stored fields. A filled brief has a dot and a localized filled title on its existing toggle, including when collapsed. The existing editor has no body-to-toolbar content slot, so the brief remains in topContent.
- In Work mode, history classification filtering belongs to the existing task-view options menu on the existing toolbar row. Do not render a second history title/filter row; Chat retains its existing history heading and inline filter. This reuses the current history filter owner and keys in desktop and Web remote control.

```text
window A → own settingService.update (durable success)
         → platform.syncAppSettings → Main SettingsChanged → A/B window own service.get
                                                       → service-scoped snapshot only
in-flight get + SettingsChanged → invalidate result → next get → latest snapshot (no write/broadcast)
```

- Timeline/grouped archive and archived-list/Web remote unarchive failures use the existing localized error feedback. Keep the item in its original list, release the pending lock for retry, and handle the rejected promise. A failed RPC is never a successful archive.
- Attention uses existing indexed/snapshot facts from opened workspaces: questions, approvals, errors; select navigates to exact source identity before opening the interaction. No second task database.
- History claim storage failure must be visible and retain an in-memory classification so the newly created session stays findable for this runtime. Explicit local-only storage boundary is shown. Fork/selection-side commands add query-only pending records (original commandId, parent, classification), never replay mutation. ACK/query resolves child identity; unknown remains visible pending confirmation with refresh-history action, without auto-fork.

## Compatibility and acceptance

Old messages/drafts/settings remain readable. Draft per-scope persistence, consumed event IDs and the pre-restore edit barrier are specified in `../ui/task-scoped-composer-drafts.md`; Lab preview ownership/relaunch is specified in `ui-lab-launch-lifecycle.md`. No transcript migration, credential/account mutation, new dependencies, official-app replacement or Git commit/push. P2 profile/bookmark/export and cross-device classification, durable scheduling, unlimited continuation are outside this increment. Runtime attachments are transient; restart restores text/startup fields only and asks users to add files again.

Preserve Todo clear/failure/duplicate and delayed composer restore regressions. Cover direct first send/brief/repeat/ACK timeout, partial/skip/collapse/error/IME/multiwindow questions, plan success/error/cancel/empty/cold replay/subagents, safe suggestion parsing and clipboard/share, draft/race/Tab gates, history quota errors and fork lost ACK query. Required project checks: typecheck, lint, architecture, focused tests, desktop/Web/Agent builds. Actual app screenshots distinguish real existing-session UI from mock interaction fixtures; no paid/live inference is implied. Close temporary debugging ports before final handoff.

The composer region establishes its own positioned stacking context above the queue decoration. Suggestions remain readable and clickable even when the queue extends behind the editor shell.
