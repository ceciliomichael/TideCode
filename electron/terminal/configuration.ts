import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node-pty";
import { activateVenvInEnvironment, findVenvPath } from "../python/venv";
import {
  assertWorkspaceDirectory,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from "../workspace/paths";

const TERMINAL_MIN_COLS = 20;
const TERMINAL_MAX_COLS = 400;
const TERMINAL_MIN_ROWS = 6;
const TERMINAL_MAX_ROWS = 200;
export const MAX_TERMINAL_POLLING_MS = 5 * 60 * 1000;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

interface TerminalShellSpec {
  args: string[];
  command: string;
  label: string;
}

export function clampInteger(
  value: number,
  min: number,
  max: number,
  fallback: number,
) {
  if (!Number.isFinite(value)) return fallback;
  const boundedValue = Math.floor(value);
  if (boundedValue < min) return min;
  if (boundedValue > max) return max;
  return boundedValue;
}

export function clampTerminalColumns(value: number, fallback: number) {
  return clampInteger(value, TERMINAL_MIN_COLS, TERMINAL_MAX_COLS, fallback);
}

export function clampTerminalRows(value: number, fallback: number) {
  return clampInteger(value, TERMINAL_MIN_ROWS, TERMINAL_MAX_ROWS, fallback);
}

export function clampTerminalPollingMs(pollingMs: number | undefined) {
  if (pollingMs === undefined) return MAX_TERMINAL_POLLING_MS;
  if (!Number.isFinite(pollingMs)) return 0;
  return Math.min(MAX_TERMINAL_POLLING_MS, Math.max(0, Math.floor(pollingMs)));
}

function assertDirectoryExists(directoryPath: string) {
  if (!existsSync(directoryPath)) {
    throw new Error(`Terminal working directory does not exist: ${directoryPath}`);
  }
  if (!statSync(directoryPath).isDirectory()) {
    throw new Error(`Terminal working directory is not a directory: ${directoryPath}`);
  }
}

export function resolveTerminalWorkspaceRootPath(
  workspaceRootPath: string | null | undefined,
) {
  const normalizedWorkspaceRootPath = workspaceRootPath?.trim() ?? "";
  return normalizedWorkspaceRootPath.length === 0
    ? null
    : normalizeWorkspacePath(normalizedWorkspaceRootPath);
}

export async function assertTerminalWorkspaceDirectory(
  workspaceRootPath: string | null,
) {
  if (workspaceRootPath) await assertWorkspaceDirectory(workspaceRootPath);
}

export function resolveTerminalCwd(
  workspaceRootPath: string | null,
  cwd: string | null | undefined,
) {
  const normalizedCwd = cwd?.trim() ?? "";
  if (workspaceRootPath) {
    try {
      const targetPath = getSafeWorkspaceTargetPath(
        workspaceRootPath,
        normalizedCwd.length > 0 ? normalizedCwd : ".",
      );
      assertDirectoryExists(targetPath.absolutePath);
      return targetPath.absolutePath;
    } catch (error) {
      if (normalizedCwd.length > 0) {
        const resolvedPath = path.resolve(normalizedCwd);
        if (existsSync(resolvedPath) && statSync(resolvedPath).isDirectory()) {
          return resolvedPath;
        }
      }
      throw error;
    }
  }
  if (normalizedCwd.length === 0) return process.cwd();
  const resolvedPath = path.resolve(normalizedCwd);
  assertDirectoryExists(resolvedPath);
  return resolvedPath;
}

function createPowerShellInteractiveArgs() {
  return [
    "-NoLogo",
    "-NoExit",
    "-Command",
    [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "if ($env:VIRTUAL_ENV) { $vName = Split-Path $env:VIRTUAL_ENV -Leaf; function prompt { \"($vName) \" + (Get-Location) + '> ' } }",
      "if (Get-Module -ListAvailable PSReadLine) { Import-Module PSReadLine -ErrorAction SilentlyContinue }",
      "if (Get-Command Set-PSReadLineOption -ErrorAction SilentlyContinue) {",
      "  try { Set-PSReadLineOption -PredictionSource History -PredictionView InlineView -BellStyle None } catch {}",
      "}",
    ].join("; "),
  ];
}

function resolveUnixShellSpecs(): TerminalShellSpec[] {
  const shells = [process.env.SHELL?.trim(), "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return shells.map((shellPath) => ({
    args: ["-l"],
    command: shellPath,
    label: path.basename(shellPath),
  }));
}

function resolveWindowsShellSpecs(): TerminalShellSpec[] {
  const windowsDirectory = process.env.WINDIR?.trim() || "C:\\Windows";
  const programFilesDirectory = process.env.ProgramFiles?.trim() || "C:\\Program Files";
  const comSpec = process.env.ComSpec?.trim();
  const windowsPowerShellPath = path.join(
    windowsDirectory, "System32", "WindowsPowerShell", "v1.0", "powershell.exe",
  );
  const pwshPath = path.join(programFilesDirectory, "PowerShell", "7", "pwsh.exe");
  const args = createPowerShellInteractiveArgs();
  const candidates: TerminalShellSpec[] = [];
  if (existsSync(pwshPath)) candidates.push({ args, command: pwshPath, label: "PowerShell 7" });
  candidates.push({ args, command: "pwsh.exe", label: "PowerShell 7" });
  if (existsSync(windowsPowerShellPath)) {
    candidates.push({ args, command: windowsPowerShellPath, label: "PowerShell" });
  }
  candidates.push({ args, command: "powershell.exe", label: "PowerShell" });
  candidates.push({
    args: [],
    command: comSpec && comSpec.length > 0 ? comSpec : "cmd.exe",
    label: "Command Prompt",
  });
  return candidates;
}

export function createTerminalEnvironment(cwd: string, workspaceRootPath: string | null) {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PYTHONUNBUFFERED: "1",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  const venvPath = findVenvPath(cwd, workspaceRootPath);
  return venvPath ? activateVenvInEnvironment(environment, venvPath) : environment;
}

export function parseExternalTerminalLink(rawUrl: string) {
  const normalizedUrl = rawUrl.trim();
  if (normalizedUrl.length === 0) throw new Error("A URL is required.");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error("Only absolute URLs are supported.");
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsedUrl.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }
  return parsedUrl.toString();
}

export function spawnTerminalFromCandidates(input: {
  cols: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  rows: number;
}) {
  const shellSpecs = process.platform === "win32"
    ? resolveWindowsShellSpecs()
    : resolveUnixShellSpecs();
  const spawnErrors: string[] = [];
  for (const shellSpec of shellSpecs) {
    try {
      return {
        ptyProcess: spawn(shellSpec.command, shellSpec.args, {
          cols: input.cols,
          cwd: input.cwd,
          env: input.env,
          name: "xterm-256color",
          rows: input.rows,
        }),
        shellLabel: shellSpec.label,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spawnErrors.push(`${shellSpec.command}: ${message}`);
    }
  }
  throw new Error(`Failed to start terminal shell. Attempts: ${spawnErrors.join(" | ")}`);
}

export function toWorkspaceKey(cwd: string) {
  const normalized = path.normalize(cwd);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function toWorkspaceSessionKey(workspaceKey: string, sessionKey?: string | null) {
  const normalizedSessionKey = sessionKey?.trim() ?? "";
  return normalizedSessionKey.length > 0
    ? `${workspaceKey}::${normalizedSessionKey}`
    : workspaceKey;
}
