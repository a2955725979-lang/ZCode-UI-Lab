# Follow-up suggestions v2

## Rules and ownership

- The shared stable guidance teaches the model the supplied English `::next-prompt` grammar and is appended immediately after Inline Code Comments in the Desktop context. Independently hosted Web receives a separate stable `followup_suggestions` context section, without Desktop/Gen UI content. The existing `zcode_desktop` surface gate and workflow-actor/custom-prompt exclusions remain authoritative. The display setting controls UI only and never changes the stable prompt.
- Desktop local Host and desktop-attached remote Host resolve to `desktop`, which the CLI normalizes to `zcode_desktop`. Mobile remote control reuses that Host. The user approved the minimal `--surface web` extension: it normalizes to `zcode_web` and receives only the shared follow-up guidance. Trusted Web composition explicitly supplies `createLocalServices.standaloneWebHost = true` in `packages/server/src/entry-http.ts` and `packages/zcode-server-cli/src/server-core/core.ts`. Desktop host facts take priority; ordinary manual/stdin servers without this fact still fall back to terminal. No browser/user request can set the Host fact. TUI never receives suggestion instructions. The current source has no `--web` switch; these are the actual independently hosted Web entry points.
- `followupSuggestions.ts` projects only a contiguous suffix of complete, valid, top-level directive lines; blank lines may separate or follow them. Directives inside prose, fenced code, quotes, lists or indented examples remain ordinary text. An empty quote/list marker ends its paragraph, so a following unindented directive can start a top-level suffix; a lazy continuation without that boundary stays prose. Each directive occupies one physical line; both LF and CRLF are supported without offset remapping. Return at most three suggestions while stripping the full valid suffix from rendering, copy and share.
- Malformed directives remain visible. During streaming, only the final unfinished top-level line beginning with `::` is temporarily hidden. This does not hide examples or complete malformed directives.
- The existing completed-success snapshot selector owns eligibility. The composer owns its draft, completion-menu state and acceptance guards; pointer/keyboard acceptance fills and focuses the editor without sending. Typing immediately removes suggestions. No second draft, completion or accepted-command owner is introduced.
- `FollowupPreview` keeps `suggestions`, `canAccept`, `onPrepareAccept` and `onAccept`. It renders no content when acceptance is unavailable. Otherwise it shows at most three shared secondary Buttons in one horizontal row, each label with its full prompt in the shared Tooltip. The first button carries a small shared `Tab` keycap. The group title is an accessible label only; expansion, draft hints and copy controls are removed.

```text
trusted Host facts → existing surface gate → stable system context → assistant suffix
assistant suffix → pure parser → transcript/copy/share text + completed-turn suggestions
completed turn + empty eligible composer + enabled UI setting → suggestion buttons
button / Tab → existing composer acceptance guard → draft text + focus (no send)
```

## Acceptance

- RED/GREEN parser cases: zero, one, three and more than three suggestions; malformed parameters; body-middle examples; code/quote/list examples; partial streaming; CRLF; escaped quotes and backslashes. Rendering, clipboard and share reuse the same stripping function.
- Context-builder checks the exact English lines, stable caching, terminal omission and workflow actor omission without model requests.
- Preview checks three-button limit, secondary styling, accessible group label, tooltip text, first-button keycap, no draft-state controls, and existing pointer/keyboard callback semantics.
- Composer integration and desktop/narrow Zai Light/Dark screenshots are checked by the overall task owner. Real generation remains user acceptance through one real conversation; fixture/DOM tests do not prove model compliance.
