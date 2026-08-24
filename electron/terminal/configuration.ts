import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node-pty";
import { activateVenvInEnvironment, findVenvPath } from "../python/venv";
import {
  assertWorkspaceDirectory,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from "../workspace/paths";
import {
  isExecutableFile,
  resolveWindowsSystemShell,
  type WindowsShellKind,
} from "./windowsShell";
import { refreshWindowsPathEnvironment } from "./windowsEnvironment";

const TERMINAL_MIN_COLS = 20;
const TERMINAL_MAX_COLS = 400;
const TERMINAL_MIN_ROWS = 6;
const TERMINAL_MAX_ROWS = 200;
export const MAX_TERMINAL_POLLING_MS = 5 * 60 * 1000;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

export interface TerminalShellSpec {
  args: string[];
  command: string;
  label: string;
}

interface TerminalShellResolutionOptions {
  env?: NodeJS.ProcessEnv;
  isCommandAvailable?: (command: string, env: NodeJS.ProcessEnv) => boolean;
  platform?: NodeJS.Platform;
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

function readEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  key: string,
  caseInsensitive = false,
) {
  const directValue = environment[key]?.trim();
  if (directValue) return directValue;
  if (!caseInsensitive) return undefined;
  const normalizedKey = key.toLowerCase();
  for (const [environmentKey, value] of Object.entries(environment)) {
    if (environmentKey.toLowerCase() !== normalizedKey) continue;
    const normalizedValue = value?.trim();
    if (normalizedValue) return normalizedValue;
  }
  return undefined;
}

function isTerminalShellCommandAvailable(
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  if (path.isAbsolute(command)) return isExecutableFile(command);
  const isWindows = platform === "win32";
  const searchPath = readEnvironmentValue(environment, "PATH", isWindows);
  if (!searchPath) return false;
  const hasExtension = isWindows && path.extname(command).length > 0;
  const pathExt = readEnvironmentValue(environment, "PATHEXT", isWindows);
  const extensions = isWindows && !hasExtension
    ? (pathExt?.split(';').filter(Boolean) ?? ['.COM', '.EXE', '.BAT', '.CMD'])
    : [''];
  return searchPath.split(path.delimiter).some((directory) =>
    extensions.some((extension) => existsSync(path.join(directory, `${command}${extension}`))),
  );
}

function createPowerShellInteractiveArgs() {
  return [
    "-NoLogo",
    "-NoExit",
    "-Command",
    [
      "function prompt { $esc = [char]27; $vName = if ($env:VIRTUAL_ENV) { '(' + (Split-Path $env:VIRTUAL_ENV -Leaf) + ') ' } else { '' }; \"$esc]133;D;$LASTEXITCODE`a$esc]133;A`a$vName$($executionContext.SessionState.Path.CurrentLocation)> $esc]133;B`a\" }",
    ].join("; "),
  ];
}

function createWindowsInteractiveArgs(kind: WindowsShellKind, profileArgs: string[]) {
  return kind === "powershell"
    ? [...profileArgs, ...createPowerShellInteractiveArgs()]
    : profileArgs;
}

function resolveUnixLoginShell(
  environment: NodeJS.ProcessEnv,
  isAvailable: (command: string, env: NodeJS.ProcessEnv) => boolean,
  platform: "darwin" | "linux",
): TerminalShellSpec {
  const configuredShell = readEnvironmentValue(environment, "TIDECODE_TERMINAL_SHELL");
  const loginShell = readEnvironmentValue(environment, "SHELL");
  const fallbackShells = platform === "darwin"
    ? ["/bin/zsh", "/bin/bash", "/bin/sh"]
    : ["/bin/bash", "/bin/zsh", "/bin/sh"];
  const candidates = [configuredShell, loginShell, ...fallbackShells]
    .filter((candidate): candidate is string => Boolean(candidate));
  const shellPath = candidates.find((candidate, index) =>
    candidates.indexOf(candidate) === index && isAvailable(candidate, environment));
  if (!shellPath) {
    throw new Error(
      "TideCode could not find an interactive system shell. Check SHELL, "
        + "or set TIDECODE_TERMINAL_SHELL to a usable shell executable.",
    );
  }
  return {
    args: ["-l"],
    command: shellPath,
    label: path.basename(shellPath),
  };
}

function resolveWindowsShellSpec(
  environment: NodeJS.ProcessEnv,
  isAvailable: (command: string, env: NodeJS.ProcessEnv) => boolean,
): TerminalShellSpec {
  const { args, command, kind, label } = resolveWindowsSystemShell(environment, isAvailable);
  return {
    args: createWindowsInteractiveArgs(kind, args),
    command,
    label,
  };
}

export function resolveTerminalShellSpec(
  options: TerminalShellResolutionOptions = {},
): TerminalShellSpec {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const isAvailable = options.isCommandAvailable
    ?? ((command: string, env: NodeJS.ProcessEnv) => isTerminalShellCommandAvailable(command, env, platform));

  if (platform === "win32") {
    return resolveWindowsShellSpec(environment, isAvailable);
  }
  if (platform === "darwin" || platform === "linux") {
    return resolveUnixLoginShell(environment, isAvailable, platform);
  }
  throw new Error(`Unsupported terminal platform: ${platform}`);
}

export function resolvePreferredTerminalShell() {
  try {
    return resolveTerminalShellSpec();
  } catch {
    return null;
  }
}

export function createTerminalEnvironment(cwd: string, workspaceRootPath: string | null) {
  const environment = refreshWindowsPathEnvironment({
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    PYTHONUNBUFFERED: "1",
    PAGER: "cat",
    GIT_PAGER: "cat",
    CI: "1",
  });
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

export function spawnResolvedTerminalShell(input: {
  cols: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  rows: number;
}) {
  const shellSpec = resolveTerminalShellSpec({ env: input.env });
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
    throw new Error(`Failed to start ${shellSpec.label} at ${shellSpec.command}: ${message}`);
  }
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
