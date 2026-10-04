import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { WorkspaceClipboardEntry } from "../../components/workspaceExplorer/workspaceClipboardTypes";
import { getPathBasename } from "../../lib/pathPresentation";
import {
  createWorkspaceClipboardEntry,
  resolveWorkspaceClipboardPasteInputs,
} from "./chatWorkspaceClipboard";

interface WorkspaceTabsControlInput {
  closeWorkspaceTabsByPathPrefix: (targetPath: string) => void;
  clearWorkspaceClipboardByPathPrefix: (targetPath: string) => void;
}

interface WorkspaceEntryHandlersInput extends WorkspaceTabsControlInput {
  activeWorkspacePathRef: MutableRefObject<string | null>;
  setWorkspaceClipboard: Dispatch<
    SetStateAction<WorkspaceClipboardEntry | null>
  >;
  workspaceClipboard: WorkspaceClipboardEntry | null;
}

function uniqueRelativePaths(relativePaths: readonly string[]) {
  return Array.from(new Set(relativePaths.filter((relativePath) => relativePath.trim().length > 0)))
}

export function createWorkspaceEntryHandlers({
  activeWorkspacePathRef,
  clearWorkspaceClipboardByPathPrefix,
  closeWorkspaceTabsByPathPrefix,
  setWorkspaceClipboard,
  workspaceClipboard,
}: WorkspaceEntryHandlersInput) {
  const handleCreateWorkspaceEntry = async (
    relativePath: string,
    isDirectory: boolean,
  ) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }

    await window.tidecodeWorkspace.createEntry({
      isDirectory,
      relativePath,
      workspaceRootPath,
    });
  };

  const handleRenameWorkspaceEntry = async (
    relativePath: string,
    nextRelativePath: string,
  ) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }

    await window.tidecodeWorkspace.renameEntry({
      nextRelativePath,
      relativePath,
      workspaceRootPath,
    });
    clearWorkspaceClipboardByPathPrefix(relativePath);
    closeWorkspaceTabsByPathPrefix(relativePath);
  };

  const handleDeleteWorkspaceEntry = async (relativePaths: string[]) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }

    const normalizedRelativePaths = uniqueRelativePaths(relativePaths);
    await Promise.all(
      normalizedRelativePaths.map(async (relativePath) => {
        await window.tidecodeWorkspace.deleteEntry({
          relativePath,
          workspaceRootPath,
        });
        clearWorkspaceClipboardByPathPrefix(relativePath);
        closeWorkspaceTabsByPathPrefix(relativePath);
      })
    );
  };

  const handleImportWorkspaceEntry = async (
    sourcePath: string,
    targetDirectoryRelativePath: string,
  ) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }

    await window.tidecodeWorkspace.importEntry({
      sourcePath,
      targetDirectoryRelativePath,
      workspaceRootPath,
    });
  };

  const handleCopyWorkspaceEntry = async (relativePaths: string[]) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }

    const uniquePaths = uniqueRelativePaths(relativePaths);
    setWorkspaceClipboard({
      ...createWorkspaceClipboardEntry({
        mode: "copy",
        relativePaths: uniquePaths,
        sourceWorkspaceRootPath: workspaceRootPath,
      }),
    });
    if (typeof window !== "undefined" && window.tidecodeClipboard) {
      await window.tidecodeClipboard.writeWorkspaceFiles({
        mode: "copy",
        relativePaths: uniquePaths,
        workspaceRootPath,
      }).catch(async () => {
        await window.tidecodeClipboard.clear().catch(() => undefined);
      });
    }
  };

  const handleCutWorkspaceEntry = async (relativePaths: string[]) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }

    const uniquePaths = uniqueRelativePaths(relativePaths);
    setWorkspaceClipboard({
      ...createWorkspaceClipboardEntry({
        mode: "cut",
        relativePaths: uniquePaths,
        sourceWorkspaceRootPath: workspaceRootPath,
      }),
    });
    if (typeof window !== "undefined" && window.tidecodeClipboard) {
      await window.tidecodeClipboard.writeWorkspaceFiles({
        mode: "cut",
        relativePaths: uniquePaths,
        workspaceRootPath,
      }).catch(async () => {
        await window.tidecodeClipboard.clear().catch(() => undefined);
      });
    }
  };

  const handlePasteWorkspaceEntry = async (
    targetDirectoryRelativePath: string,
  ) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }
    if (!workspaceClipboard) {
      throw new Error("Nothing to paste.");
    }

    const pasteInputs = resolveWorkspaceClipboardPasteInputs({
      clipboard: workspaceClipboard,
      targetDirectoryRelativePath,
      workspaceRootPath,
    });

    const runPasteInput = async (pasteInput: (typeof pasteInputs)[number]) => {
      if (pasteInput.kind === "transfer") {
        const result = await window.tidecodeWorkspace.transferEntry(pasteInput.input);
        if (result.mode === "move" && result.targetRelativePath !== result.relativePath) {
          clearWorkspaceClipboardByPathPrefix(result.relativePath);
          closeWorkspaceTabsByPathPrefix(result.relativePath);
        }
        return;
      }

      await window.tidecodeWorkspace.importEntry(pasteInput.input);
    };

    const copyBasenames = pasteInputs.map((pasteInput) =>
      pasteInput.kind === "transfer" ? getPathBasename(pasteInput.input.relativePath).toLowerCase() : "",
    );
    const canCopyInParallel =
      pasteInputs.length > 1 &&
      pasteInputs.every((pasteInput) => pasteInput.kind === "transfer" && pasteInput.input.mode === "copy") &&
      new Set(copyBasenames).size === copyBasenames.length;

    if (canCopyInParallel) {
      await Promise.all(pasteInputs.map(runPasteInput));
      return;
    }

    for (const pasteInput of pasteInputs) {
      await runPasteInput(pasteInput);
    }
  };

  const handleMoveWorkspaceEntry = async (
    relativePath: string,
    targetDirectoryRelativePath: string,
  ) => {
    const workspaceRootPath = activeWorkspacePathRef.current;
    if (!workspaceRootPath) {
      throw new Error("Select a workspace folder first.");
    }

    const result = await window.tidecodeWorkspace.transferEntry({
      mode: "move",
      relativePath,
      targetDirectoryRelativePath,
      workspaceRootPath,
    });

    if (result.targetRelativePath !== result.relativePath) {
      clearWorkspaceClipboardByPathPrefix(result.relativePath);
      closeWorkspaceTabsByPathPrefix(result.relativePath);
    }
  };

  return {
    handleCopyWorkspaceEntry,
    handleCreateWorkspaceEntry,
    handleCutWorkspaceEntry,
    handleDeleteWorkspaceEntry,
    handleImportWorkspaceEntry,
    handleMoveWorkspaceEntry,
    handlePasteWorkspaceEntry,
    handleRenameWorkspaceEntry,
  };
}
