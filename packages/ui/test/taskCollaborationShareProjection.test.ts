import { it, expect } from "vitest";
import { normalizeConversationShareMarkdown } from "../src/v4/conversationShareMarkdown.js";
import { stripFollowupSuggestionDirectives } from "../src/v4/followupSuggestions.js";
it("timeline/copy/share strip valid and malformed next-step metadata but preserve examples", () => {
  const directive = '::next-prompt{label="Verify" prompt="Check the result"}';
  const text = "Answer\n\n" + directive;
  expect(stripFollowupSuggestionDirectives(text)).toBe("Answer");
  expect(normalizeConversationShareMarkdown(text)).toBe("Answer");
  const sample = "```text\n" + directive + "\n```";
  expect(normalizeConversationShareMarkdown(sample)).toBe(sample);
  expect(stripFollowupSuggestionDirectives('Answer\n::next-prompt{label="unfinished"')).toBe(
    "Answer",
  );
  expect(normalizeConversationShareMarkdown('Answer\n::next-prompt{label="unfinished"')).toBe(
    "Answer",
  );
  expect(
    stripFollowupSuggestionDirectives('Answer\n::next-prompt{label="unfinished"', {
      streaming: true,
    }),
  ).toBe("Answer");
});
