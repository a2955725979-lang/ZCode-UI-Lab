# Follow-up suggestions v2

## Rules and ownership

- The shared stable guidance teaches the model the supplied English `::next-prompt` grammar and is appended immediately after Inline Code Comments in the Desktop context. Independently hosted Web receives a separate stable `followup_suggestions` context section, without Desktop/Gen UI content. The existing `zcode_desktop` surface gate and workflow-actor/custom-prompt exclusions remain authoritative. The display setting controls UI only and never changes the stable prompt.
- Desktop local Host and desktop-attached remote Host resolve to `desktop`, which the CLI normalizes to `zcode_desktop`. Mobile remote control reuses that Host. The user approved the minimal `--surface web` extension: it normalizes to `zcode_web` and receives only the shared follow-up guidance. Trusted Web composition explicitly supplies `createLocalServices.standaloneWebHost = true` in `packages/server/src/entry-http.ts` and `packages/zcode-server-cli/src/server-core/core.ts`. Desktop host facts take priority; ordinary manual/stdin servers without this fact still fall back to terminal. No browser/user request can set the Host fact. TUI never receives suggestion instructions. The current source has no `--web` switch; these are the actual independently hosted Web entry points.
- `followupSuggestions.ts` projects only a contiguous suffix of top-level `::next-prompt{` candidate lines; blank lines may separate or follow them. Every candidate is hidden from rendering, copy and share even when its parameters or closing syntax are malformed. Only candidates with one complete, valid directive and nonempty `label`/`prompt` become buttons; return at most three buttons while stripping the entire candidate suffix. Directives inside prose, fenced code, quotes, lists or indented examples remain ordinary text. An empty quote/list marker ends its paragraph, so a following unindented directive can start a top-level suffix; a lazy continuation without that boundary stays prose. Each candidate occupies one physical line; both LF and CRLF preserve original UTF-16 offsets.
- During streaming, only a final unfinished top-level prefix of the exact `::next-prompt` name is temporarily hidden. A diverging `::` command or ordinary prose remains visible; an incomplete name without `{` remains visible after completion. This does not hide examples or body-middle directives.
- The existing completed-success snapshot selector owns eligibility. The composer owns its draft, completion-menu state and acceptance guards; pointer/keyboard acceptance fills and focuses the editor without sending. Typing immediately removes suggestions. No second draft, completion or accepted-command owner is introduced.
- `FollowupPreview` keeps `suggestions`, `canAccept`, `onPrepareAccept` and `onAccept`. It renders no content when acceptance is unavailable. Otherwise it shows at most three shared secondary Buttons in one horizontal row, each label with its full prompt in the shared Tooltip. The first button carries a small shared `Tab` keycap only outside mobile text-input viewports and hoverless devices. The group title is an accessible label only; expansion, draft hints and copy controls are removed.

```text
trusted Host facts → existing surface gate → stable system context → assistant suffix
assistant suffix → pure parser → transcript/copy/share text + completed-turn suggestions
completed turn + empty eligible composer + enabled UI setting → suggestion buttons
button / Tab → existing composer acceptance guard → draft text + focus (no send)
```

## Acceptance

- Round 4: the turn navigator strips the shared-parser suffix before truncating or normalizing assistant previews, including streaming previews. Source rows and user previews stay unchanged; quoted/code/list examples retain the parser's existing semantics.

- RED/GREEN parser cases: zero, one, three and more than three suggestions; malformed parameters and incomplete candidate lines that strip without buttons; mixed valid/malformed candidate suffixes; body-middle examples; code/quote/list examples; exact-name partial streaming versus diverging `::` commands; CRLF and UTF-16 offsets; escaped quotes and backslashes. Rendering, clipboard and share reuse the same stripping function and have regression checks at their actual consumption paths.
- Context-builder checks the exact English lines, stable caching, terminal omission and workflow actor omission without model requests.
- Preview checks three-button limit, secondary styling, accessible group label, tooltip text, first-button keycap, no draft-state controls, and existing pointer/keyboard callback semantics.
- Composer integration and desktop/narrow Zai Light/Dark screenshots are checked by the overall task owner. Real generation remains user acceptance through one real conversation; fixture/DOM tests do not prove model compliance.

## D2: terminal replay projection

- The directive and follow-up pure parsers live in two modules behind the existing `@zcode/shared` root entry. UI retains its old parser APIs and completed-success snapshot selector; parser rules, Web suggestions and stored assistant text are unchanged.
- The internal transcript projector/loader accepts `preserveTextParts`, defaulting to false. Only the session facade loader and subagent historical observation opt in. It enriches the existing optional `parts` field with the original ordered text parts, including whitespace, without changing `content`, role, summary/model-only filtering, deduplication, or the old whole-message omission criterion. No protocol/schema/DB field or state owner is added.
- TUI restoration retains those whitespace text parts until display parsing. Only agent body text is concatenated losslessly and parsed once; the resulting UTF-16 prefix boundary is mapped back to the original parts. User/system text, thought/tool parts, stream reducers, final-response comparisons and persistence keep their existing contracts.
- Pure-text replay continues to display its old single `content` block with the original double-newline aggregation. Its original text parts only supply recognition boundaries; stripping removes the mapped suffix from that visible aggregation. Structured messages keep their original part order and hide formerly invisible whitespace text nodes after parsing. Markdown and explicit plain body branches share this projection; input messages are not mutated.

```text
session store owner → existing projector (opt-in original text parts)
  → facade / subagent observation → existing TUI restore → MessageRow display projection
  → shared parser once → UTF-16 prefix mapped to existing visible nodes
```

- Regression gates cover both main and child replay (including child `events=[]`): adjacent parts must not manufacture a line boundary, split directives must strip, split fences must protect examples, and whitespace parts must preserve a valid suffix boundary. Default projector output and exact opted-in parts are checked, including old blank-message omission and unmodified original text.
- Compare pure and structured replay layouts with/without metadata, Markdown/plain, thought/tool order, headless output, streaming partial/closed/continued/completed/interrupted cases and final-response deduplication. A real terminal `/resume` fixture is a separate integration gate; pure parser tests alone do not establish D2 completion.

## D1: standalone Web CLI compatibility

- Authorized compatibility criterion: a controlled bundled source plus an offline confirmation that its CLI accepts `web`. This is not an assertion that Host and CLI have the exact same compilation commit. Version strings, file names and `supportsStorageStartup` alone are insufficient.
- Both standalone compositions inject the existing `createLocalServices.zcodeAgentCommandResolver`. Desktop retains its synchronous resolver and existing surface behavior. A synchronous caller cannot opt an unconfirmed command into Web.
- Explicit `ZCODE_AGENT_SERVER_COMMAND` overrides and deployed native fallbacks are never probed and receive no Host-added Web flag. External command, arguments and cwd are preserved, including user-authored surface options. Without an explicit option the CLI uses its terminal default.
- Core resolves the bundled CLI next to its own ESM entry in the current release, with explicit external overrides taking priority. Supervisor does not relabel this built-in selection as an external command through environment wiring. Missing development siblings keep the existing monorepo resolver chain.
- Only a controlled internal entry runs the fixed offline `app-server --surface web --version --prepare-storage` probe. Version returns after surface validation and before database/session startup; the prepare-storage flag skips entry prewarming. No shell, model, account or network request is part of this check. Time and output are bounded; failures and unknown artifacts receive no appended surface.
- Confirmation caching is scoped to a resolver and to canonical entry path, content SHA-256, runtime identity and trusted command environment. Changed artifacts invalidate confirmation; a successful probe must still match its starting identity. Source-tsx results are not cached because its transitive source graph may change.
- Acceptance covers supported/old/missing/failing/timeout/oversized internal fixtures, external argument preservation without execution, artifact replacement and parallel confirmation, both composition roots, and Desktop regression. Fixture checks and offline CLI probes do not establish real model behavior.
- Desktop stdio 回归夹具在自己的临时 `ZCODE_APPLICATION_HOME` 设置后重新加载服务模块，保留原 Provider 与 Desktop 命令断言；不能在模块已固定外层隔离根后依赖 `HOME` 或旧 data-root setter 改根。包级测试保留系统 HOME；现有 services 路径兼容测试继续使用自身逐例的临时 data-root，避免全局 application root 改变其被测语义。
