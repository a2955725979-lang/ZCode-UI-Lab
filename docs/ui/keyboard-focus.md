# Keyboard focus visibility

## Scope and ownership

The shared `packages/ui/src/styles.css` owns the minimum visible keyboard focus
indicator for semantic controls and keyboard-reachable elements. Components keep
their existing selection, hover and validation states; no new interaction state,
command or persistence owner is added. Desktop and Web use the same rules.

## Product rules

- Ordinary keyboard buttons and links retain a 2px outline using the semantic input-border-focused token, offset by 1px. The token must contrast at least 3:1 with adjacent theme surfaces. Selection rows with option, menuitem or checkbox roles, and unstructured userInput option buttons marked data-focus-style="row", rely on selected/hover focus backgrounds and are excluded from the global non-layer outline. Attention rows retain their ordinary button outline. Do not clip row focus by forcing a second outer outline.
- Input, Textarea, input-style Select and InputGroup retain only their semantic focused border and input-focused background in ordinary themes. Remove extra inset outlines and ordinary stacked rings. InputGroup owns its shell while nested inputs stay transparent. Invalid fields retain the destructive border/ring; forced-colors explicitly restores a system Highlight outline.
- The Lexical composer has no additional inner/outer dark outline, underline or pseudo-element strip. Keep its existing semantic focused border and surface.
- Attention is an anchored Popover. Escape/close restores its invoking button; navigating to a pending source suppresses restoration across that navigation. Inline interaction collapse/expand retains answer drafts and focuses only when the pane/document permits it.
- Natural Tab/Shift+Tab order, IME safety, explicit free-input aria labels and original permission/plan semantics remain. Do not globally clear shadows or validation rings; menu/dialog elevation is independent of keyboard outlines.

## Regression and acceptance

The scoped DOM regression checks that the free-input name stays associated with
the question after navigation. The stylesheet regression prevents reintroducing
a global focused-element outline or box-shadow reset. The actual component
browser fixture in `audit/p0-acceptance-20261016-193850/focus/rerun.cjs` remains
the visual acceptance scenario: FollowupPreview, all shared Button variants,
inline Work brief fields/actions, shared Input/Textarea/Select/InputGroup
controls (including disabled and invalid states), TaskAttention Popover rows and ElicitationDialog
card/options/free input in active Zai Light and Zai Dark themes; simulated forced
colors; Tab/Shift+Tab and existing Escape controls. Positive screenshot changes
require renewed visual review and must not automatically count as a pass.

Actual VoiceOver, production caller focus restoration and full installed-app
acceptance are separate checks and must be labelled unverified when not run.
