import type {
  SettingsSyncDiscoveryResult,
  SettingsSyncClaudeAgentsFileCopyResult,
  SettingsSyncClaudeAgentsFileMigrationStatus,
  SettingsSyncFirstRunPromptState,
  SettingsSyncImportResult,
  SettingsSyncProgressEvent,
  SettingsSyncSelection,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface GlobalAgentsFileStatus {
  path: string;
  exists: boolean;
}

export interface ISettingsSyncService {
  /** 当前应用 profile 的全局指令；不读取外部迁移源。 */
  getGlobalAgentsFileStatus(): Promise<GlobalAgentsFileStatus>;
  /** 只创建固定目标的空文件；已存在时不覆盖，拒绝软链和非普通文件。 */
  createGlobalAgentsFile(): Promise<GlobalAgentsFileStatus>;
  getClaudeAgentsFileMigrationStatus(request: {
    workspacePath?: string;
    workspaceIdentity?: string;
  }): Promise<SettingsSyncClaudeAgentsFileMigrationStatus>;
  copyClaudeAgentsFileToZcodeAgentsFile(request?: {
    workspacePath?: string;
    workspaceIdentity?: string;
    overwrite?: boolean;
  }): Promise<SettingsSyncClaudeAgentsFileCopyResult>;
  detect(request: {
    workspacePath?: string;
    workspaceIdentity?: string;
    categories?: SettingsSyncSelection["category"][];
    intent?: "firstRun" | "manualImport";
  }): Promise<SettingsSyncDiscoveryResult>;
  importSelected(request: {
    workspacePath?: string;
    workspaceIdentity?: string;
    selections: SettingsSyncSelection[];
    onProgress?: (event: SettingsSyncProgressEvent) => void;
  }): Promise<SettingsSyncImportResult>;
  getFirstRunPromptState(): Promise<SettingsSyncFirstRunPromptState>;
  markFirstRunPromptHandled(): Promise<void>;
}

export const ISettingsSyncService = createServiceDescriptor<ISettingsSyncService>(
  ServiceChannels.SettingsSync,
);
