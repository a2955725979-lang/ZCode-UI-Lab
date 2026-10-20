import { describe, expect, it } from "vitest";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";
import { formatWorkTaskBriefPrompt } from "@/v4/composer/WorkTaskBrief.js";

const fields = { outcome: "  可复核  ", deliverable: "报告", constraints: "保留原件" };
const labels = (messages: Record<string, string>) => ({
  outcome: messages["chat.workBrief.outcome.prefix"]!,
  deliverable: messages["chat.workBrief.deliverable.prefix"]!,
  constraints: messages["chat.workBrief.constraints.prefix"]!,
});
describe("optional Work brief", () => {
  it("uses Chinese interface labels in the same original message", () => {
    expect(formatWorkTaskBriefPrompt("整理资料", fields, labels(zhCN))).toBe(
      "整理资料\n\n预期结果：可复核\n交付形式：报告\n约束与边界：保留原件",
    );
  });
  it("uses English interface labels without a separate dispatch", () => {
    expect(formatWorkTaskBriefPrompt("Review", fields, labels(enUS))).toBe(
      "Review\n\nExpected outcome: 可复核\nDeliverable: 报告\nConstraints: 保留原件",
    );
  });
  it("omits blank fields and leaves a plain task unchanged", () => {
    expect(formatWorkTaskBriefPrompt("Task", undefined, labels(zhCN))).toBe("Task");
    expect(
      formatWorkTaskBriefPrompt(
        "Task",
        { outcome: "  ", deliverable: "", constraints: "" },
        labels(zhCN),
      ),
    ).toBe("Task");
    expect(
      formatWorkTaskBriefPrompt(
        "Task",
        { outcome: "", deliverable: "", constraints: "  范围A  " },
        labels(zhCN),
      ),
    ).toBe("Task\n\n约束与边界：范围A");
  });
});
