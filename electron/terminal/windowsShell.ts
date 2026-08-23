import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  resolveWindowsTerminalDefaultProfile,
  type WindowsTerminalProfileResolution,
} from "./windowsTerminalProfile";
import { resolveWindowsAppPathExecutable } from "./windowsAppPath";

const POWERSHELL_STORE_PACKAGE_PATTERN =
  /^Microsoft\.PowerShell_(\d+(?:\.\d+){3})_(x64|arm64|x86)__8wekyb3d8bbwe$/iu;

export type ShellCommandAvailability = (
  command: string,
  environment: NodeJS.ProcessEnv,
) => boolean;

export type WindowsShellKind = "command-prompt" | "powershell" | "other";

export interface WindowsShellResolution {
  args: string[];
  command: string;
  kind: WindowsShellKind;
  label: string;
  source: "configured" | "terminal-profile" | "system-default" | "fallback";
}

function readEnvironmentValue(environment: NodeJS.ProcessEnv, key: string) {
  const normalizedKey = key.toLowerCase();
  for (const [environmentKey, value] of Object.entries(environment)) {
    if (environmentKey.toLowerCase() !== normalizedKey) continue;
    const normalizedValue = value?.trim();
    if (normalizedValue) return normalizedValue;
  }
  return undefined;
}

function uniqueWindowsPaths(candidates: readonly string[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalizedCandidate = path.win32.normalize(candidate).toLowerCase();
    if (seen.has(normalizedCandidate)) return false;
    seen.add(normalizedCandidate);
    return true;
  });
}

function compareVersionedStorePackages(left: string, right: string) {
  const leftMatch = POWERSHELL_STORE_PACKAGE_PATTERN.exec(left);
  const rightMatch = POWERSHELL_STORE_PACKAGE_PATTERN.exec(right);
  if (!leftMatch || !rightMatch) return right.localeCompare(left);

  const leftVersion = leftMatch[1].split(".").map(Number);
  const rightVersion = rightMatch[1].split(".").map(Number);
  for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index += 1) {
    const difference = (rightVersion[index] ?? 0) - (leftVersion[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return right.localeCompare(left);
}

export function discoverPowerShellStorePackageDirectories(windowsAppsRoot: string) {
  try {
    return readdirSync(windowsAppsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && POWERSHELL_STORE_PACKAGE_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersionedStorePackages);
  } catch {
    // WindowsApps may be unreadable under enterprise policy. The system shell and
    // other fallback locations remain available without treating this as fatal.
    return [];
  }
}

export function classifyWindowsShell(command: string): Pick<WindowsShellResolution, "kind" | "label"> {
  const executableName = path.win32.basename(command).toLowerCase();
  if (executableName === "cmd" || executableName === "cmd.exe") {
    return { kind: "command-prompt", label: "Command Prompt" };
  }
  if (executableName === "pwsh" || executableName === "pwsh.exe") {
    return { kind: "powershell", label: "PowerShell 7" };
  }
  if (executableName === "powershell" || executableName === "powershell.exe") {
    return { kind: "powershell", label: "Windows PowerShell" };
  }
  return {
    kind: "other",
    label: path.win32.basename(command, path.win32.extname(command)) || "System shell",
  };
}

export function createWindowsShellCandidates(
  environment: NodeJS.ProcessEnv,
  options: {
    storePackageDirectories?: readonly string[];
    windowsAppPathPowerShell?: string | null;
    windowsTerminalProfile?: WindowsTerminalProfileResolution | null;
  } = {},
) {
  const configuredShell = readEnvironmentValue(environment, "TIDECODE_TERMINAL_SHELL");
  const windowsTerminalProfile = options.windowsTerminalProfile === undefined
    ? resolveWindowsTerminalDefaultProfile(environment)
    : options.windowsTerminalProfile;
  const windowsAppPathPowerShell = options.windowsAppPathPowerShell === undefined
    ? resolveWindowsAppPathExecutable("pwsh.exe", environment)
    : options.windowsAppPathPowerShell;
  const systemDefaultShell = readEnvironmentValue(environment, "ComSpec");
  const localAppData = readEnvironmentValue(environment, "LOCALAPPDATA");
  const userProfile = readEnvironmentValue(environment, "USERPROFILE");
  const systemRoot = readEnvironmentValue(environment, "SystemRoot")
    ?? readEnvironmentValue(environment, "WinDir");
  const programFilesRoots = uniqueWindowsPaths([
    readEnvironmentValue(environment, "ProgramW6432") ?? "",
    readEnvironmentValue(environment, "ProgramFiles") ?? "",
    readEnvironmentValue(environment, "ProgramFiles(x86)") ?? "",
  ].filter(Boolean));
  const userAliasRoots = uniqueWindowsPaths([
    localAppData ? path.win32.join(localAppData, "Microsoft", "WindowsApps") : "",
    userProfile
      ? path.win32.join(userProfile, "AppData", "Local", "Microsoft", "WindowsApps")
      : "",
  ].filter(Boolean));
  const windowsAppsRoots = programFilesRoots.map((root) => path.win32.join(root, "WindowsApps"));
  const storeCommands = windowsAppsRoots.flatMap((windowsAppsRoot) => {
    const directoryNames = [
      ...(options.storePackageDirectories
        ?? discoverPowerShellStorePackageDirectories(windowsAppsRoot)),
    ]
      .filter((directoryName) => POWERSHELL_STORE_PACKAGE_PATTERN.test(directoryName))
      .sort(compareVersionedStorePackages);
    return directoryNames.map((directoryName) =>
      path.win32.join(windowsAppsRoot, directoryName, "pwsh.exe"));
  });
  const standardPowerShellCommands = programFilesRoots.map((root) =>
    path.win32.join(root, "PowerShell", "7", "pwsh.exe"));
  const aliasPowerShellCommands = userAliasRoots.flatMap((aliasRoot) => [
    path.win32.join(
      aliasRoot,
      "Microsoft.PowerShell_8wekyb3d8bbwe",
      "pwsh.exe",
    ),
    path.win32.join(aliasRoot, "pwsh.exe"),
  ]);
  const isPowerShell7Profile = windowsTerminalProfile
    ? path.win32.basename(windowsTerminalProfile.command).toLowerCase() === "pwsh.exe"
      || path.win32.basename(windowsTerminalProfile.command).toLowerCase() === "pwsh"
    : false;
  const powerShellArgs = isPowerShell7Profile ? windowsTerminalProfile!.args : [];
  const powerShellLabel = isPowerShell7Profile ? windowsTerminalProfile!.label : "PowerShell 7";
  const powerShellSource = isPowerShell7Profile ? "terminal-profile" as const : "fallback" as const;
  const powerShellCandidates = uniqueWindowsPaths([
    "pwsh.exe",
    ...(windowsAppPathPowerShell ? [windowsAppPathPowerShell] : []),
    ...standardPowerShellCommands,
    ...storeCommands,
    ...aliasPowerShellCommands,
  ]).map((command) => ({
    args: powerShellArgs,
    command,
    label: powerShellLabel,
    source: powerShellSource,
  }));

  const candidates: Array<Pick<WindowsShellResolution, "args" | "command" | "label" | "source">> = [
    ...(configuredShell
      ? [{ args: [], command: configuredShell, label: "", source: "configured" as const }]
      : []),
    ...(isPowerShell7Profile && windowsTerminalProfile
      ? [{ ...windowsTerminalProfile, source: "terminal-profile" as const }]
      : []),
    ...powerShellCandidates,
    ...(systemDefaultShell
      ? [{ args: [], command: systemDefaultShell, label: "", source: "system-default" as const }]
      : []),
    ...(systemRoot
      ? [
        {
          command: path.win32.join(
            systemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          args: [],
          label: "",
          source: "fallback" as const,
        },
        {
          command: path.win32.join(systemRoot, "System32", "cmd.exe"),
          args: [],
          label: "",
          source: "fallback" as const,
        },
      ]
      : []),
    { args: [], command: "powershell.exe", label: "", source: "fallback" },
    { args: [], command: "cmd.exe", label: "", source: "fallback" },
  ];

  const uniqueCommands = uniqueWindowsPaths(candidates.map(({ command }) => command));
  return uniqueCommands.map((command): WindowsShellResolution => {
    const normalizedCommand = path.win32.normalize(command).toLowerCase();
    const candidate = candidates.find(
      (item) => path.win32.normalize(item.command).toLowerCase() === normalizedCommand,
    )!;
    const classification = classifyWindowsShell(command);
    return {
      ...candidate,
      ...classification,
      label: candidate.label || classification.label,
    };
  });
}

export function resolveWindowsSystemShell(
  environment: NodeJS.ProcessEnv,
  isAvailable: ShellCommandAvailability,
): WindowsShellResolution {
  const resolution = createWindowsShellCandidates(environment)
    .find(({ command }) => isAvailable(command, environment));
  if (resolution) return resolution;

  throw new Error(
    "TideCode could not find the Windows system shell. Check that ComSpec points to cmd.exe, "
      + "or set TIDECODE_TERMINAL_SHELL to an interactive shell executable.",
  );
}

export function isExecutableFile(command: string) {
  try {
    return existsSync(command) && statSync(command).isFile();
  } catch {
    return false;
  }
}
