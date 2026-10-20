// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { FollowupPreview } from "@/v4/composer/FollowupPreview.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => (id.endsWith("tabHint") ? "Tab" : "下一步建议"),
    },
  }),
}));

afterEach(cleanup);

const suggestions = [0, 1, 2, 3].map((index) => ({
  label: `建议 ${index + 1}`,
  prompt: `完整下一步 ${index + 1} <script>只作文字</script>`,
}));

function mount(canAccept = true) {
  const onAccept = vi.fn();
  const onPrepareAccept = vi.fn();
  const view = render(
    createElement(
      TooltipProvider,
      null,
      createElement(FollowupPreview, {
        suggestions,
        canAccept,
        onAccept,
        onPrepareAccept,
      }),
    ),
  );
  return { ...view, onAccept, onPrepareAccept };
}

describe("FollowupPreview", () => {
  it("最多三个secondary按钮；标题仅作组标签，只有第一条带Tab键帽", () => {
    const { container } = mount();
    const group = screen.getByRole("group", { name: "下一步建议" });
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(group.textContent).toBe("建议 1Tab建议 2建议 3");
    expect(container.querySelectorAll("kbd")).toHaveLength(1);
    expect(container.querySelector("kbd")?.textContent).toBe("Tab");
    for (const button of buttons) {
      expect(button.dataset.variant).toBe("secondary");
      expect(button.textContent).not.toContain("完整下一步");
    }
    expect(container.querySelector("p")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("不能接受时隐藏整个建议组，不显示已有草稿或复制控件", () => {
    const { container } = mount(false);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("指针先准备守卫，再把完整prompt交给原有接受回调", () => {
    const { onAccept, onPrepareAccept } = mount();
    const button = screen.getAllByRole("button")[1]!;
    fireEvent.pointerDown(button);
    fireEvent.click(button, { detail: 1 });
    expect(onPrepareAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(suggestions[1], false);
    expect(onPrepareAccept.mock.invocationCallOrder[0]).toBeLessThan(
      onAccept.mock.invocationCallOrder[0]!,
    );
    fireEvent.click(button, { detail: 0 });
    expect(onAccept).toHaveBeenLastCalledWith(suggestions[1], true);
  });

  it("聚焦提示按钮时用共享tooltip展示完整prompt且转义内容", async () => {
    mount();
    fireEvent.focus(screen.getAllByRole("button")[0]!);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toBe(suggestions[0]!.prompt);
    expect(tooltip.querySelector("script")).toBeNull();
  });
});
