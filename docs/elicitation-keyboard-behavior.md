# Elicitation behavior

## Scope and owners

`ElicitationDialog` owns local question navigation and answer drafts. `V4InteractionDialogs`
projects authoritative `pendingInteractions` and persists drafts through the existing session UI store.
`V4ElicitationDialog` owns renderer-local presentation and response feedback; it does not create a
second accepted queue. The parent supplies `isActive`; document visibility additionally gates focus
and presentation. `taskAttentionNavigation` holds only the latest explicit, non-persistent navigation
intent and consumes it atomically after workspace/session/request identity match.

```text
runtime pending interaction → focused/visible pane → open once → edit local drafts
  ├─ later / Escape → close and retain draft → waiting entry → reopen
  ├─ skip → resolveInteraction(accept, { answers: {} })
  └─ explicit submit → scoped pending overlay → existing command admission → ACK
       ├─ failure → retain draft, show error, allow explicit retry
       └─ accepted → keep response controls locked until authoritative pending clears
```

## Ordinary AskUserQuestion

- A new request automatically opens once in the focused, visible session. A hidden document or
  background pane does not mount a focusable dialog. Deferred requests remain reachable through
  the waiting-answer entry; returning to a pane does not automatically reopen an already shown request.
- Desktop uses the existing modal Dialog primitive; narrow Web uses a bottom-aligned sheet with
  constrained height and internal scrolling. Dialog dismissal restores the prior connected focus target.
- Text `Enter` inserts a newline. `Ctrl+Enter` / `Cmd+Enter` submits actual partial answers explicitly.
  IME composition never navigates or submits, including candidate confirmation with Enter.
- Choice `Space` selects; single-choice `Enter` selects and advances. Multi-choice `Enter` advances.
  On the final question, selection / bare Enter only focuses the explicit submit button.
- `Escape` and Later close without decline or cancel. Explicit Skip sends the existing empty-answer
  continuation protocol. Partial answers omit unanswered keys; no preference is invented.
- Submission feedback and synchronous locks use workspace identity (path fallback), sessionId and
  requestId. Remounting cannot bypass an in-flight or accepted lock. Failed commands retain answers;
  late responses update only their original scoped request. Runtime remains the authority across clients.
- Optional option `preview` is preserved and rendered as escaped, whitespace-preserving text because
  the current protocol defines a string without a Markdown/HTML content type.
- Existing first-interaction auto-resolution pause behavior remains supported, including late arrival
  of its durable event. Ordinary auto-resolution defaults off; an explicit enabled setting is preserved.

## Approval boundaries

Permission requests keep `PermissionDialog` and its explicit options. `ExitPlanMode` stays a plan
approval surface: no ordinary Skip/Later action is exposed, Escape declines, and bare Enter in its
feedback input submits. The primary action with no feedback explicitly chooses `approve`, retaining
its existing approval protocol.

## Regression evidence

The focused tests cover multiline/IME input, multi-question and partial answers, explicit skip/defer,
preview escaping, draft remounting, focused/hidden presentation, one automatic opening, response
locking, failure/retry, stale-session responses and plan approval. These DOM tests are simulated UI
checks; actual application acceptance is recorded separately by the task owner.
