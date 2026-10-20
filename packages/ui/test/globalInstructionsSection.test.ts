// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  create: vi.fn(),
  getEditors: vi.fn(),
  open: vi.fn(),
}));
const services = {
  settingsSyncService: {
    getGlobalAgentsFileStatus: mocks.getStatus,
    createGlobalAgentsFile: mocks.create,
  },
};
vi.mock("@/hooks/useServices.js", () => ({ useServices: () => services }));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => platform }));
const platform = { getInstalledEditors: mocks.getEditors, openInEditor: mocks.open };
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));
import { GlobalInstructionsSection } from "../src/settings/GlobalInstructionsSection.js";

const path = "/isolated-profile/.zcode/AGENTS.md";
const editor = { id: "vscode", name: "VS Code", iconDataUrl: "" };
beforeEach(() => {
  mocks.getStatus.mockResolvedValue({ path, exists: false });
  mocks.create.mockResolvedValue({ path, exists: true });
  mocks.getEditors.mockResolvedValue([editor]);
  mocks.open.mockResolvedValue({ success: true });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  localStorage.clear();
});
const name = (value: string) => `settings.globalInstructions.${value}`;

describe("GlobalInstructionsSection", () => {
  it("shows a missing real path, creates only on click, then opens the verified path", async () => {
    render(createElement(GlobalInstructionsSection, { available: true }));
    expect((await screen.findByTestId("settings-global-instructions-path")).textContent).toBe(path);
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.getStatus.mockResolvedValue({ path, exists: true });
    fireEvent.click(screen.getByRole("button", { name: name("create") }));
    const open = await screen.findByRole("button", { name: name("open") });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.open).not.toHaveBeenCalled();
    fireEvent.click(open);
    await waitFor(() => expect(mocks.open).toHaveBeenCalledWith("vscode", path));
  });

  it("shows create failure without an open button and can recover by refresh", async () => {
    mocks.create.mockRejectedValue(new Error("Permission denied"));
    render(createElement(GlobalInstructionsSection, { available: true }));
    fireEvent.click(await screen.findByRole("button", { name: name("create") }));
    expect(await screen.findByText("Permission denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: name("open") })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: name("refresh") }));
    expect(await screen.findByRole("button", { name: name("create") })).toBeTruthy();
  });

  it("keeps a removed file from reaching the editor", async () => {
    mocks.getStatus
      .mockResolvedValueOnce({ path, exists: true })
      .mockResolvedValue({ path, exists: false });
    render(createElement(GlobalInstructionsSection, { available: true }));
    fireEvent.click(await screen.findByRole("button", { name: name("open") }));
    expect(await screen.findByRole("button", { name: name("create") })).toBeTruthy();
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("surfaces editor failures instead of reporting saved", async () => {
    mocks.getStatus.mockResolvedValue({ path, exists: true });
    mocks.open.mockResolvedValue({ success: false, error: "Editor launch failed" });
    render(createElement(GlobalInstructionsSection, { available: true }));
    fireEvent.click(await screen.findByRole("button", { name: name("open") }));
    expect(await screen.findByText("Editor launch failed")).toBeTruthy();
  });

  it("does not advertise a file manager or terminal as an editor", async () => {
    mocks.getStatus.mockResolvedValue({ path, exists: true });
    mocks.getEditors.mockResolvedValue([
      { ...editor, id: "finder" },
      { ...editor, id: "terminal" },
    ]);
    render(createElement(GlobalInstructionsSection, { available: true }));
    expect(await screen.findByText(name("noEditor"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: name("open") })).toBeNull();
  });

  it("Web and mobile never read or create local files or enumerate editors", () => {
    render(createElement(GlobalInstructionsSection, { available: false }));
    expect(screen.getByText(name("localOnly"))).toBeTruthy();
    expect(mocks.getStatus).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.getEditors).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
