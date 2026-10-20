# Keyboard focus visibility

## Scope and ownership

The shared `packages/ui/src/styles.css` owns the minimum visible keyboard focus
indicator for semantic controls and keyboard-reachable elements. Components keep
their existing selection, hover and validation states; no new interaction state,
command or persistence owner is added. Desktop and Web use the same rules.

## Product rules

- A `:focus-visible` control has a clearly visible outline using the existing
  secondary foreground theme token and an offset separating it from its surface. This
  baseline covers native buttons, links, unstyled editable controls, focusable composite
  roles and nonnegative tabindex elements even when a component suppresses the
  browser outline.
- Shared Input, Textarea and input-style Select use one 1px inset outline in
  `foreground-subtle`, aligned with the existing field border. Their semantic
  input background/border remains; do not stack an ordinary focus ring on it.
  InputGroup owns the same single outline on its shell, not its nested control.
  Invalid fields retain their destructive border/ring and use a destructive
  outline. Buttons inside groups keep their own keyboard indicator.
- The Lexical composer does not draw an inner or outer dark outline. Its existing semantic focused input border and surface remain. Do not add a focus underline, pseudo-element strip, or replacement dark frame around the composer. Forced colors use the system Highlight outline. Ordinary buttons retain the baseline indicator.
- Attention dialog Escape/close restores its invoking button. Selecting a pending item navigates to the source before opening its interaction and must not restore focus back across that navigation.
- Pointer focus alone on an ordinary button does not add the keyboard outline.
  Text fields follow browser `:focus-visible` semantics, which may also match
  pointer focus when text input is expected.
- Scroll containers around full-width controls keep enough internal focus space
  so the external outline is not clipped at their edges.
- Do not globally clear focus box-shadow: dialogs and menus retain their normal
  elevation, and validation rings remain visible. Programmatic focus on a
  `tabindex=-1` dialog container does not gain an interactive-control outline.
- In forced-colors mode the baseline outline uses the system `Highlight` color.
  Shared fields and InputGroup explicitly restore the 2px external Highlight
  outline in this mode. Browser forced-colors emulation is a simulation, not actual OS acceptance.
- Elicitation free input has an explicit accessible name from the current
  question, independent of placeholder fallback, in ordinary and plan modes.
- Existing Tab/Shift+Tab order, roving selection, dialog trapping, Escape, IME
  behavior and submission/permission rules remain unchanged.

## Regression and acceptance

The scoped DOM regression checks that the free-input name stays associated with
the question after navigation. The stylesheet regression prevents reintroducing
a global focused-element outline or box-shadow reset. The actual component
browser fixture in `audit/p0-acceptance-20261016-193850/focus/rerun.cjs` remains
the visual acceptance scenario: FollowupPreview, all shared Button variants,
WorkTaskStartDialog fields/actions, shared Input/Textarea/Select/InputGroup
controls (including disabled and invalid states), TaskAttentionDialog rows and ElicitationDialog
card/options/free input in active Zai Light and Zai Dark themes; simulated forced
colors; Tab/Shift+Tab and existing Escape controls. Positive screenshot changes
require renewed visual review and must not automatically count as a pass.

Actual VoiceOver, production caller focus restoration and full installed-app
acceptance are separate checks and must be labelled unverified when not run.
