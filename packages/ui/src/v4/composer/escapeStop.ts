// composer parity：Esc → stop 的忽略判定（纯函数，无宿主依赖）。
export function shouldIgnoreEscapeForStopGeneration(
  event: KeyboardEvent,
  interactionBoundary: EventTarget | null = null,
): boolean {
  if (event.defaultPrevented) {
    return true;
  }

  const path = event.composedPath();
  // 权限选项的 Esc 没有本地动作，也不会 preventDefault；必须由所属 pane 的既有
  // 卡片边界阻断全局 stop，不能把所有 role=option 或其它 pane 一并豁免。
  if (interactionBoundary && path.includes(interactionBoundary)) return true;
  return path.some((target) => {
    if (!target || typeof target !== "object") {
      return false;
    }

    const maybeElement = target as {
      dataset?: { slot?: string };
      getAttribute?: (name: string) => string | null;
    };
    return (
      // Cmd/Ctrl+P 文件选择弹窗用 Escape 关闭时，同一事件会继续
      // 冒泡到窗口；识别 Radix/Dialog 事件路径并跳过停止任务，避免「关闭弹窗」误停生成。
      maybeElement.dataset?.slot === "dialog-content" ||
      maybeElement.getAttribute?.("role") === "dialog"
    );
  });
}
