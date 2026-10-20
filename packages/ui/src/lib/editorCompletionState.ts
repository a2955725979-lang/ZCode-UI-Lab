import { createCommand, type LexicalEditor } from "lexical";

/** 直接询问同一编辑器中已挂载的补全插件，不从全局 DOM 猜测其他输入框的菜单。 */
export const QUERY_COMPLETION_MENU_COMMAND = createCommand<{ open: boolean }>(
  "QUERY_COMPLETION_MENU_COMMAND",
);

export function isEditorCompletionMenuOpen(editor: LexicalEditor): boolean {
  const query = { open: false };
  editor.dispatchCommand(QUERY_COMPLETION_MENU_COMMAND, query);
  return query.open;
}
