# Chat / Work workspace

## Rules and ownership

- The existing `interfaceMode` store remains the sole owner: `office` presents Chat (聊天), `coding` presents Work (工作). Existing localStorage values and broadcast semantics remain compatible. Mode does not change model, reasoning, permissions, Plan, submitted commands, or session identity.
- Chat gives direct access to a conversation-workspace draft, conversation history, archived history, and the existing Command Center. Search covers all active sessions in currently open workspaces and labels each result Chat/Work; archived and unopened workspaces remain outside that scope. History has an All/Chat/Work filter, defaulting to the current presentation mode and remembered separately for each mode in the existing local classification owner.
- Chat uses a centered `max-w-3xl` reading column and the same bottom composer for drafts and sessions. Markdown, code, math, attachments, IME, streaming, stop/error/approval controls and virtualized scroll ownership are unchanged. Welcome content is lightweight.
- Chat temporarily hides engineering side tabs (Git, terminal, tree map, model trajectory, developer tools) and the bottom terminal. Browser, file/document previews, workflow and other content/details remain usable. It hides engineering panels, without closing tabs, destroying mounted content/PTYs or changing `useAppPanels` state. The existing animated panel owner remembers expanded dimensions; temporary Chat geometry is not persisted to Work panel preferences. Returning to Work restores tabs, open state and dimensions. Hidden content cannot receive focus. Mobile uses the same derived visibility.
- Generic desktop New Task / Cmd+N in Chat uses the same conversation-workspace creation command. Explicit project/provider/workflow requests and mobile remote target routing retain their existing semantics.
- Work retains existing project navigation, file/editor/Diff/terminal controls and layout. Mode switching is shown in the sidebar while expanded, and in the header while the sidebar is collapsed. A plain Chat conversation draft hides the project picker; explicitly selected project contexts and Work retain it.
- Existing thought/tool disclosures remain expandable. The status summary defaults to compact in Chat; explicit user expansion remains available. Permission requests and errors remain visible in the conversation.
- The visible history menu reuses the same task action content and mutation callbacks as the context menu. It does not load per-row service metadata until opened. The selected/active history row publishes its indexed metadata into the existing task metadata cache used by the header; historical sessions do not need an active runtime just to show their title. Successful timeline metadata mutations refresh the existing Controller list query, including when a historical session cannot emit a live session update.
- Regenerate is exposed only when the authoritative row supplies `canRetry` (through the existing `onRetry` capability). Confirmation explains that the current session is rewound to the answer and subsequent content is discarded; this is not version preservation. Cancel does nothing. Revoked capability removes the action, including an open confirmation. The existing revision/logEpoch command admission remains authoritative.

```text
mode click -> existing interfaceMode setter -> persisted/broadcast display preference
                                               |
                                               +-> Chat visibility and reading layout
useAppPanels -> tab/open state -> mounted panels + existing size memory
                                   |
                                   +-> Chat hides geometry; no close command or Work layout write
canRetry -> confirm current-session rewind -> existing retryTurn -> authority/CAS admission
```

## Acceptance

- Switch Work -> Chat -> Work with terminal, side tabs and non-default sizes: same tabs and PTY remain, Work sizes return, draft/model/permissions stay unchanged. Resize in Chat must not collapse the hidden Work owner state.
- New Chat targets the existing non-project conversation workspace. History opens the real session; rename/archive/unarchive use existing service commands. Search uses all modes with a compact category label.
- Draft and long session composer remain at the bottom; text/code/math retain their native renderer and internal overflow at desktop/narrow widths, Zai Light and Dark.
- Retry button is absent without authority, opens a confirmation with authority, does not dispatch on cancel, and dispatches the same row/entity target only after confirmation.
- Preserve existing timeline scroll, composer draft and panel owner regressions. Execute relevant unit tests and shared static checks; record synthetic screenshots separately from real model validation.

## Session history partition

- `interfaceMode` still owns presentation. `sessionHistoryModeStore` owns only local UI classification (`chat` / `work`), keyed by `[workspaceIdentity?.trim() || workspacePath, sessionId]`. One localStorage entry per session avoids unrelated cross-window writes replacing each other. Storage events refresh the same owner; no session transcript, permission or accepted command is stored here. Classification persists on this installation/browser origin; it is not server memory or cross-device synchronization.
- Legacy sessions with no classification fall back to workspace purpose: conversation → Chat, project/unknown → Work. Never infer category from transcript/title. Manual “Move to Chat / Move to Work” sets an explicit classification, retaining session ID, messages, project/cwd, model and permissions. Both modes can create without a project using the existing non-project workspace.
- First submission freezes the selected interface mode before asynchronous creation. All draft creation paths (prewarm promotion, ordinary create, slash command, recovery) record that mode; later sends and ordinary navigation never overwrite an existing session classification. Forks inherit the source classification.
- Mode switching changes visible history and presentation, retaining the open session/draft and running work. It does not move the current session. Only its more/context menu exposes explicit Move to Chat/Work; remove the header category tag and categoryHint. Do not add a second session/navigation/draft owner.
- Timeline, pinned, archived, project lists, grouped view, remote list projections and adjacent-conversation shortcuts use the same classifier with the selected history filter. Search/recent results use all classifications and carry a compact mode label. Chat queries all open workspace scopes so project sessions moved to Chat remain reachable. Explicit navigation/back/forward may open a session from the other category without changing that session's classification.
- Filter full metadata before deriving total and collapsed page length. `useGlobalTaskList` uses an unlimited Controller query when a predicate is present, then derives `filter → total → slice`; classification changes reuse cached source metadata. Existing Host source reads already collect complete lists. Remote branches apply the predicate before their own limit. Archive bulk deletion snapshots only the classified selection shown for the current mode, never all modes in those workspaces.

```text
first submit -> freeze interface mode -> existing creation/admission -> created session ID
                                                                  |
                                                                  v
manual move ------------------------------------------------> sessionHistoryModeStore
                                                              | per-identity/session storage
                                                              v
full Controller / remote metadata -> classify -> count -> page -> history/search
mode switch -> interfaceMode display preference; selected session/draft retains existing owner
```

### History partition acceptance

- Same non-project workspace can contain explicit Chat and Work sessions; creation/recovery/fork unit tests verify stable classification without paid model calls.
- Old project and non-project records can move both ways; messages, ID, file context and permission state remain unchanged. Reopening/restarting restores classification.
- Both modes expose pinned and archived entries. History filters apply to grouped/project/remote projections, including records beyond the first source page and identical IDs under different workspace identities. Search/recent results span both categories and show a compact classification label.
- Bulk archived deletion never includes the opposite mode. Verify selection with fixtures; do not delete user history for acceptance.
- Actual isolated desktop checks cover mode switch, moving an existing fixture, search, pin/archive/restore and reload, plus theme and narrow layout. No model request is sent. Backend live creation/streaming evidence from the prior release does not claim to validate this new classification logic.

- Existing pending-command recovery does not journal fork/selection-side creation. Parent classification is inherited on accepted/duplicate ACK, but an ACK lost before that UI claim may leave the child using the legacy fallback. This change does not add a second recovery protocol.

## v2 sidebar and local filters

The expanded sidebar order is h-8 segmented mode control, New, Search, then history with All/Chat/Work filter. Mode is presentation, classification is local metadata, and history filter is a per-presentation-mode preference in the existing history owner. Selecting All never rewrites classification. A selected session from either classification remains open. Attention uses only existing cached metadata and an anchored Popover when nonempty, retaining navigation and focus restoration; it does not add a task query owner.

- The All/Chat/Work history choice is stored per presentation mode (`chat` and `work`) in `sessionHistoryModeStore`, using independent preference keys. With no saved choice, each mode defaults to its matching classification. A storage failure retains the choice in the current window; changing this display preference never writes session classifications. Timeline, pinned, archived, grouped, project and remote history projections read the same choice. The filter remains visible in Work alongside the existing project toolbar.
- Attention reads the existing Controller task metadata snapshot; before that snapshot arrives it may use the existing task metadata cache. It never issues an always-on `listTaskList` query. The zero state has no trigger. The count and rows share the same cached projection, scoped by `workspaceIdentity?.trim() || workspacePath` to currently open workspaces. Explicit live zero-pending summaries supersede stale pending metadata.
- Attention uses a non-modal, row-anchored Popover. Escape/trigger dismissal restores the trigger focus; outside dismissal keeps normal non-modal focus behavior. Selecting a row closes the Popover, navigates to the real session, then emits the existing question-open intent; dismissal must not reclaim focus from the destination. Permission/error rows only navigate and never resolve interactions.
- Acceptance: choose All in Chat, switch to Work and choose Chat, switch back and reload: each mode retains its own selection. Search still returns both categories even when history is narrowed. Attention reacts to cached Controller snapshot/deltas without any `listTaskList` calls, hides at zero, restores focus on dismissal, and preserves destination focus on selection.
