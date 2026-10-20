# Elicitation behavior

## Scope and owners

`ElicitationDialog` owns local question navigation, expansion and answer drafts.
`V4InteractionDialogs` projects authoritative `pendingInteractions` and persists drafts through the
existing session UI store. `V4ElicitationDialog` owns renderer-local response feedback; it does not
create a second accepted queue. Every pane renders its first pending interaction. `isActive` and
document visibility gate automatic focus only. `taskAttentionNavigation` holds the latest explicit,
non-persistent navigation intent and consumes it after workspace/session/request identity match.
`ConversationComposer` owns local focus return intent; `SessionPane` supplies the DOM boundary of
its own interaction card, never a global selector. This intent is scoped to workspace/session and
does not change the authoritative request queue, response locks or answer drafts.

```text
runtime pending interaction → inline dock card → edit local drafts
  ├─ Escape / collapse → collapsed summary → expand → retain draft
  ├─ attention target → expand existing card → scroll into view → focus
  ├─ skip → resolveInteraction(accept, { answers: {} })
  └─ next / final confirm / explicit partial submit → scoped pending overlay → admission → ACK
       ├─ failure → retain draft, show error, allow retry
       └─ accepted → keep controls locked until authoritative pending clears
```

- Focus that was in this pane's composer or current interaction card returns to the retained
  composer only after the final authoritative pending interaction clears and the composer is
  editable and visible. An initially pending card can acquire this ownership when focused.
  Consecutive requests keep focus in the cards, including the frame between their DOM updates;
  an accepted response alone never focuses the still-hidden composer.
- Focus or pointer navigation elsewhere, an inactive/hidden pane or hidden document cancels
  return intent, including an already queued animation frame. Becoming active/visible again does
  not replay it. Every queued focus rechecks scope, visibility and blocking state before running.
  A failed response retains the question, answers and focus; ordinary mobile autofocus remains off.

## Ordinary AskUserQuestion

- Ordinary questions render inline in the same dock position as plan approvals, without a modal,
  waiting-answer entry or Later action. The existing numbered option rows, checkboxes, preview,
  primary action and question pager retain their visual language.
- Single-choice click or Enter selects and advances; the final question submits immediately.
  Multi-choice Space toggles an option; Enter advances or submits.
- Free text Enter advances or submits; Shift+Enter inserts a newline, matching the composer.
  Ctrl+Enter / Cmd+Enter anywhere submits the actual partial answers. IME composition never
  navigates or submits, including Enter candidate confirmation. Tab keeps browser natural order.
- Escape toggles expansion without responding. The header collapse control works at every width.
  The card container is programmatically focusable, without becoming an extra Tab stop or acquiring
  the ordinary button outline. A collapsed card has one full-width button containing the question
  summary, question count and expand icon. Question-text expansion and card expansion have distinct
  accessible labels. Collapse and expansion report first interaction as navigation, pausing automatic
  continuation. Drafts survive. Keyboard hints are hidden in mobile text-input viewports and on
  devices without hover.
- The footer has Skip (ghost) and Continue / Submit (brand). Skip sends the existing empty-answer
  continuation protocol. Partial answers omit unanswered keys; no preference is invented.
- Submission disables all controls and shows Submitting. A failure shows one error line and retains
  answers for retry. Scoped locks use workspace identity (path fallback), sessionId and requestId;
  remounting cannot bypass them. Late responses affect only their original scoped request.
- Optional option `preview` is escaped, whitespace-preserving text because the protocol defines a
  string without a Markdown/HTML content type. Free input retains its question aria-label.
- Auto-resolution defaults off. First interaction still pauses it, including late durable event arrival.
- Unstructured userInput uses the same inline popover card; sensitive inputs remain password fields.
  Its existing V4InteractionDialogs owner admits one response at a time per workspace/session/
  interaction scope. Pending submissions disable its inputs and buttons and show Submitting; a
  rejected ACK or transport failure retains the input and permits an explicit retry. A late response
  cannot change feedback for another scope. This does not change permission response handling or
  the resolveInteraction answer/ACK protocol.

## Approval boundaries

The focused SessionPane owns the global Escape-to-stop listener. It ignores events whose composed
path includes its existing interactionFocusBoundaryRef, in addition to already prevented and dialog
events. Permission option rows need not acquire a new Escape action merely to avoid the global
shortcut. Card-local handlers still run normally (including ExitPlanMode decline); a composer outside
that exact boundary still stops generation. A row role or another pane's boundary alone is not an
exemption. No interaction answer, pending order or permission protocol changes.

Permission requests retain `PermissionDialog` options, freeText and workflow Refine. ExitPlanMode
retains approval semantics: no ordinary Skip action, Escape declines, bare Enter in feedback submits,
and the primary action without feedback explicitly chooses approve. Inactive or hidden panes render
these cards without automatically moving focus.

## Regression evidence

Focused tests cover text advance / Shift+Enter / IME, final single and multi-choice submission,
partial answers and skip, expansion without response, preview escaping, draft remounting, inactive
and hidden pane rendering, explicit attention reveal, scoped response locks, failure/retry, stale
responses, sensitive input and plan approval. DOM checks are simulated UI evidence; actual application
acceptance is recorded separately by the task owner.
Composer/card integration also covers final response focus return, initial pending and consecutive
requests, failure retention, outside focus/pointer cancellation, scope changes and active/document
visibility changes both before clearing and before an already queued focus frame.
