export const FOLLOWUP_SUGGESTIONS_PROMPT = [
  "### Follow-up suggestions",
  '- After your final reply is complete, you may add up to three suggested next messages for the user, one directive per line at the very end of the reply: ::next-prompt{label="..." prompt="..."}',
  "- prompt is the exact message the user could send next, written in the user's language and from the user's point of view. label is a short title for it (at most 24 characters, or 12 CJK characters).",
  "- Suggest only concrete next steps grounded in this conversation. Emit none when there is no useful follow-up, when you are asking the user a question, or when the turn ended in an error.",
  "- These are optional suggestions for the user, not work you have promised; they do not count as an unfinished plan.",
  '- Put nothing after the directives. Never use the directive inside code blocks, quotes, lists or examples, and never mention it in prose. Escape double quotes inside values as \\\" and keep each directive on a single line.',
  '- Example: ::next-prompt{label="Run the tests" prompt="Run the full test suite and fix any failures."}',
].join("\n");
