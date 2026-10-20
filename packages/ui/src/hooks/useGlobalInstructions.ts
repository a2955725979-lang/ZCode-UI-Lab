import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorInfo } from "@zcode/shared";
import type { GlobalAgentsFileStatus } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { isFileManagerOpenTarget } from "@/lib/openWithEditors.js";
import { readLastSelectedEditorId, persistLastSelectedEditorId } from "@/lib/editorPreference.js";

interface GlobalInstructionsState {
  status: GlobalAgentsFileStatus | null;
  busy: boolean;
  error: string | null;
  editors: EditorInfo[];
  editorsLoading: boolean;
  editorError: string | null;
  selectedEditor: EditorInfo | undefined;
  refresh: () => Promise<void>;
  create: () => Promise<void>;
  open: () => Promise<void>;
  selectEditor: (id: string) => void;
}
const TERMINAL_IDS = new Set(["terminal", "iterm2", "ghostty", "warp"]);

export function useGlobalInstructions(available: boolean): GlobalInstructionsState {
  const { settingsSyncService } = useServices();
  const platform = usePlatform();
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<GlobalAgentsFileStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editors, setEditors] = useState<EditorInfo[]>([]);
  const [editorsLoading, setEditorsLoading] = useState(available);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [selectedEditorId, setSelectedEditorId] = useState<string | null>(readLastSelectedEditorId);
  const selectedEditor = editors.find((editor) => editor.id === selectedEditorId) ?? editors[0];

  const loadStatus = useCallback(
    async (create = false) => {
      if (!available) return;
      const requestId = ++requestIdRef.current;
      setBusy(true);
      setError(null);
      try {
        if (create) await settingsSyncService.createGlobalAgentsFile();
        const next = await settingsSyncService.getGlobalAgentsFileStatus();
        if (requestIdRef.current === requestId) setStatus(next);
      } catch (loadError) {
        if (requestIdRef.current !== requestId) return;
        setStatus(null);
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (requestIdRef.current === requestId) setBusy(false);
      }
    },
    [available, settingsSyncService],
  );

  useEffect(() => {
    if (!available) {
      setStatus(null);
      setBusy(false);
      return;
    }
    void loadStatus();
    return () => {
      requestIdRef.current += 1;
    };
  }, [available, loadStatus]);

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    setEditorsLoading(true);
    setEditorError(null);
    void platform
      .getInstalledEditors()
      .then((installed) => {
        if (!disposed) {
          // Workspace 打开方式包含终端和文件管理器；编辑指令不能把这些目标当文本编辑器。
          setEditors(
            installed.filter(
              (editor) => !isFileManagerOpenTarget(editor) && !TERMINAL_IDS.has(editor.id),
            ),
          );
        }
      })
      .catch((loadError) => {
        if (!disposed)
          setEditorError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!disposed) setEditorsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [available, platform]);

  const open = useCallback(async () => {
    if (!available || !selectedEditor || !status?.exists || busy) return;
    const requestId = ++requestIdRef.current;
    setBusy(true);
    setError(null);
    try {
      // 外部编辑器可能已删除/替换文件，打开前重新核验真实固定目标。
      const latest = await settingsSyncService.getGlobalAgentsFileStatus();
      if (requestIdRef.current !== requestId) return;
      setStatus(latest);
      if (!latest.exists) return;
      const result = await platform.openInEditor(selectedEditor.id, latest.path);
      if (!result.success) throw new Error(result.error || "Failed to open editor");
    } catch (openError) {
      if (requestIdRef.current === requestId) {
        setStatus(null);
        setError(openError instanceof Error ? openError.message : String(openError));
      }
    } finally {
      if (requestIdRef.current === requestId) setBusy(false);
    }
  }, [available, busy, platform, selectedEditor, settingsSyncService, status?.exists]);

  return {
    status,
    busy,
    error,
    editors,
    editorsLoading,
    editorError,
    selectedEditor,
    refresh: () => loadStatus(),
    create: () => loadStatus(true),
    open,
    selectEditor: (id: string) => {
      if (!editors.some((editor) => editor.id === id)) return;
      setSelectedEditorId(id);
      persistLastSelectedEditorId(id);
    },
  };
}
