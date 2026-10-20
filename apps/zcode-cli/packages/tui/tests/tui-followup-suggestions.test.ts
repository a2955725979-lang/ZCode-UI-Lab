import assert from "node:assert/strict";
import test from "node:test";
import type { MessageWithParts, SessionStorePort } from "@zcode/contracts";
import { stripFollowupSuggestionDirectives } from "@zcode/shared";
import { projectSessionTranscript } from "../../bootstrap/src/session-transcript.js";
import { createSubagentObservation } from "../../bootstrap/src/app/subagent-observation.js";
import { appendAgentResult } from "../src/app-submit.js";
import { hydrateSubagentTranscript } from "../src/app-subagent-transcript.js";
import { MessageRow } from "../src/app-transcript-components.js";
import { MarkdownText } from "../src/app-markdown.js";
import { ThoughtTranscriptPartView } from "../src/app-thought-components.js";
import { ToolTranscriptPartView } from "../src/app-tool-components.js";
import {
  appendStreamingTextDelta,
  markStreamingMessageComplete,
} from "../src/app-transcript-stream.js";
import type { Message } from "../src/app-model.js";

const directive = '::next-prompt{label="检查" prompt="检查结果"}';
const cases = [
  {
    name: "adjacent prose does not manufacture a directive",
    texts: ["正文", directive],
    expected: `正文\n\n${directive}`,
  },
  {
    name: "split directive strips across text parts",
    texts: ["正文😀\n::next-", 'prompt{label="检查" prompt="检查结果"}'],
    expected: "正文😀",
  },
  {
    name: "split fence protects an example",
    texts: ["``", `\`text\n${directive}`],
    expected: `\`\`\n\n\`text\n${directive}`,
  },
  {
    name: "whitespace parts preserve the real suffix boundary",
    texts: ["正文", "\r\n \r\n", directive],
    expected: "正文",
  },
];

function persisted(texts: string[]): MessageWithParts[] {
  return [
    {
      info: { id: "answer", role: "assistant" },
      parts: texts.map((text, index) => ({ id: `text-${index}`, text, type: "text" })),
    },
  ] as unknown as MessageWithParts[];
}

function bodyNodes(message: Message): Array<{ content: string; kind: unknown }> {
  const row = MessageRow({ index: 0, message });
  const nodes: ReturnType<typeof bodyNodes> = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(visit);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const element = node as { type: unknown; props: { children?: unknown; content?: string } };
    if (element.type === MarkdownText || element.type === "text") {
      nodes.push({
        content: element.props.content ?? String(element.props.children ?? ""),
        kind: element.type,
      });
    } else if (
      element.type === ThoughtTranscriptPartView ||
      element.type === ToolTranscriptPartView
    ) {
      nodes.push({ content: "", kind: element.type });
    } else visit(element.props.children);
  };
  visit(row);
  return nodes;
}

for (const fixture of cases) {
  test(`main replay: ${fixture.name}`, () => {
    const original = persisted(fixture.texts);
    const before = structuredClone(original);
    const restoredMessages = projectSessionTranscript(original, { preserveTextParts: true });
    const message = appendAgentResult([], { response: "", restoredMessages })[0]!;
    assert.deepEqual(
      message.parts,
      fixture.texts.map((text) => ({ text, type: "text" })),
    );
    assert.equal(message.content, fixture.texts.join("\n\n"));
    assert.deepEqual(bodyNodes(message), [{ content: fixture.expected, kind: MarkdownText }]);
    assert.deepEqual(original, before);
    assert.equal(
      stripFollowupSuggestionDirectives(fixture.texts.join("")),
      fixture.expected === "正文" || fixture.expected === "正文😀"
        ? fixture.expected
        : fixture.texts.join(""),
    );
  });

  test(`child events=[] replay: ${fixture.name}`, async () => {
    const original = persisted(fixture.texts);
    const before = structuredClone(original);
    const app = createSubagentObservation({
      runtime: { getSessionEventStore: () => ({ getEvents: async () => [] }) } as never,
      sessionId: "parent" as never,
      sessionStore: {
        getSession: async () => ({ id: "child", parentID: "parent", taskType: "subagent_child" }),
        messages: async () => original,
      } as unknown as SessionStorePort,
    });
    const snapshot = await app.readSubagentTranscript("child");
    assert.deepEqual(snapshot.events, []);
    assert.deepEqual(snapshot.replayMessageIds, []);
    assert.equal(snapshot.sequenceNumber, 0);
    assert.deepEqual(
      snapshot.messages[0]!.parts,
      fixture.texts.map((text) => ({ text, type: "text" })),
    );
    const message = hydrateSubagentTranscript(snapshot).messages[0]!;
    assert.deepEqual(bodyNodes(message), [{ content: fixture.expected, kind: MarkdownText }]);
    assert.deepEqual(original, before);
  });
}

test("pure replay keeps one old aggregate block with and without metadata", () => {
  for (const texts of [
    ["first", "second"],
    ["first", `second\n${directive}`],
    ["first", "\n", "second"],
  ]) {
    const message = appendAgentResult([], {
      response: "",
      restoredMessages: projectSessionTranscript(persisted(texts), { preserveTextParts: true }),
    })[0]!;
    const expected = texts.join("\n\n").replace(`\n${directive}`, "");
    assert.deepEqual(bodyNodes(message), [{ content: expected, kind: MarkdownText }]);
  }
});

test("structured Markdown/plain body strips once and preserves thought/tool order without blank blocks", () => {
  for (const format of [undefined, "plain"] as const) {
    const message: Message = {
      content: `正文😀\n\n${directive}`,
      role: "agent",
      parts: [
        { type: "thought", status: "thought", contentCharCount: directive.length, text: directive },
        { type: "text", format, text: "正文😀" },
        { type: "text", format, text: "\n\n" },
        {
          type: "tool",
          status: "completed",
          detailLines: [],
          toolCallId: "tool",
          toolName: "Read",
          output: directive,
        },
        { type: "text", format, text: directive.slice(0, 9) },
        { type: "text", format, text: directive.slice(9) },
      ],
    };
    const original = structuredClone(message);
    assert.deepEqual(bodyNodes(message), [
      { content: "", kind: ThoughtTranscriptPartView },
      { content: "正文😀", kind: format === "plain" ? "text" : MarkdownText },
      { content: "", kind: ToolTranscriptPartView },
    ]);
    assert.deepEqual(message, original);
  }
});

test("user/system and example text stay visible; metadata-only body adds no empty node", () => {
  for (const role of ["user", "system"] as const) {
    assert.deepEqual(bodyNodes({ content: directive, role }), [
      { content: directive, kind: "text" },
    ]);
  }
  for (const content of [
    `body\n${directive}\nmore`,
    `> body\n${directive}`,
    `- body\n${directive}`,
    `    ${directive}`,
  ]) {
    assert.deepEqual(bodyNodes({ content, role: "agent" }), [{ content, kind: MarkdownText }]);
  }
  assert.deepEqual(bodyNodes({ content: directive, role: "agent" }), []);
  assert.deepEqual(
    bodyNodes({
      content: "",
      role: "agent",
      parts: [{ type: "text", format: "plain", text: directive }],
    }),
    [],
  );
});

test("streaming projection hides a partial suffix, restores later prose, and keeps raw final dedupe", () => {
  const states = [
    { delta: "正文😀\n::next-", expected: "正文😀" },
    { delta: 'prompt{label="检查" prompt="检查结果"}', expected: "正文😀" },
    { delta: "\n追加正文", expected: `正文😀\n${directive}\n追加正文` },
  ];
  let messages: Message[] = [];
  let raw = "";
  for (const state of states) {
    raw += state.delta;
    messages = appendStreamingTextDelta(messages, "stream", state.delta);
    const before = structuredClone(messages);
    assert.deepEqual(bodyNodes(messages[0]!), [{ content: state.expected, kind: MarkdownText }]);
    assert.deepEqual(messages, before);
  }
  const complete = appendAgentResult(messages, { response: raw });
  assert.equal(complete.length, 1);
  assert.equal(complete[0]!.streaming, false);
  assert.equal(complete[0]!.parts?.[0]?.type === "text" && complete[0]!.parts[0].text, raw);
  assert.deepEqual(bodyNodes(complete[0]!), [{ content: raw, kind: MarkdownText }]);
  const partial = appendStreamingTextDelta([], "partial", '正文\n::next-prompt{label="');
  const interrupted = markStreamingMessageComplete(partial, "partial");
  assert.deepEqual(bodyNodes(interrupted[0]!), [
    { content: '正文\n::next-prompt{label="', kind: MarkdownText },
  ]);
  const closed = appendStreamingTextDelta([], "closed", `正文\n${directive}`);
  const finalized = appendAgentResult(closed, { response: `正文\n${directive}` });
  assert.equal(finalized.length, 1);
  assert.deepEqual(bodyNodes(finalized[0]!), [{ content: "正文", kind: MarkdownText }]);
});
