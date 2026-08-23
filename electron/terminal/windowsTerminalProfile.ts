import { readFileSync } from "node:fs";
import path from "node:path";

export interface WindowsTerminalProfileResolution {
  args: string[];
  command: string;
  label: string;
}

interface WindowsTerminalProfile {
  commandline?: unknown;
  guid?: unknown;
  hidden?: unknown;
  name?: unknown;
  source?: unknown;
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

function stripJsonComments(source: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      index += 1;
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      index += 1;
      while (index + 1 < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          index += 1;
          break;
        }
        if (source[index] === "\n") result += "\n";
        index += 1;
      }
      continue;
    }
    result += character;
  }
  return result;
}

function stripTrailingCommas(source: string) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ",") {
      let lookahead = index + 1;
      while (/\s/u.test(source[lookahead] ?? "")) lookahead += 1;
      if (source[lookahead] === "}" || source[lookahead] === "]") continue;
    }
    result += character;
  }
  return result;
}

function parseJsonWithComments(source: string): unknown {
  return JSON.parse(stripTrailingCommas(stripJsonComments(source)));
}

function expandEnvironmentVariables(value: string, environment: NodeJS.ProcessEnv) {
  return value.replace(/%([^%]+)%/gu, (match, key: string) =>
    readEnvironmentValue(environment, key) ?? match);
}

export function splitWindowsCommandLine(commandLine: string) {
  const tokens: string[] = [];
  let token = "";
  let inQuotes = false;
  let tokenStarted = false;

  for (let index = 0; index < commandLine.length;) {
    const character = commandLine[index];
    if (/\s/u.test(character) && !inQuotes) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      index += 1;
      continue;
    }

    if (character === "\\") {
      let backslashCount = 0;
      while (commandLine[index + backslashCount] === "\\") backslashCount += 1;
      const followedByQuote = commandLine[index + backslashCount] === '"';
      if (!followedByQuote) {
        token += "\\".repeat(backslashCount);
        tokenStarted = true;
        index += backslashCount;
        continue;
      }
      token += "\\".repeat(Math.floor(backslashCount / 2));
      tokenStarted = true;
      if (backslashCount % 2 === 0) inQuotes = !inQuotes;
      else token += '"';
      index += backslashCount + 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      tokenStarted = true;
      index += 1;
      continue;
    }
    token += character;
    tokenStarted = true;
    index += 1;
  }
  if (tokenStarted) tokens.push(token);
  return tokens;
}

function resolveGeneratedProfileCommand(profile: WindowsTerminalProfile) {
  const source = typeof profile.source === "string" ? profile.source.toLowerCase() : "";
  const name = typeof profile.name === "string" ? profile.name.trim() : "";
  if (source === "windows.terminal.powershellcore") {
    return { args: [], command: "pwsh.exe" };
  }
  if (source === "microsoft.wsl" && name) {
    return { args: ["-d", name], command: "wsl.exe" };
  }
  return null;
}

export function parseWindowsTerminalDefaultProfile(
  source: string,
  environment: NodeJS.ProcessEnv,
): WindowsTerminalProfileResolution | null {
  try {
    const settings = parseJsonWithComments(source);
    if (!settings || typeof settings !== "object") return null;
    const record = settings as Record<string, unknown>;
    const defaultProfile = typeof record.defaultProfile === "string"
      ? record.defaultProfile.trim().toLowerCase()
      : "";
    const profiles = record.profiles;
    if (!defaultProfile || !profiles || typeof profiles !== "object") return null;
    const profileList = (profiles as Record<string, unknown>).list;
    if (!Array.isArray(profileList)) return null;
    const profile = profileList.find((candidate): candidate is WindowsTerminalProfile => {
      if (!candidate || typeof candidate !== "object") return false;
      const guid = (candidate as WindowsTerminalProfile).guid;
      return typeof guid === "string" && guid.trim().toLowerCase() === defaultProfile;
    });
    if (!profile || profile.hidden === true) return null;

    const label = typeof profile.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : "Windows Terminal profile";
    const commandLine = typeof profile.commandline === "string"
      ? expandEnvironmentVariables(profile.commandline.trim(), environment)
      : "";
    const tokens = commandLine ? splitWindowsCommandLine(commandLine) : [];
    const generatedCommand = tokens.length === 0 ? resolveGeneratedProfileCommand(profile) : null;
    const command = tokens[0] ?? generatedCommand?.command;
    if (!command) return null;
    return {
      args: tokens.length > 0 ? tokens.slice(1) : generatedCommand?.args ?? [],
      command,
      label,
    };
  } catch {
    return null;
  }
}

export function resolveWindowsTerminalDefaultProfile(
  environment: NodeJS.ProcessEnv,
): WindowsTerminalProfileResolution | null {
  const localAppData = readEnvironmentValue(environment, "LOCALAPPDATA");
  if (!localAppData) return null;
  const settingsPaths = [
    path.win32.join(
      localAppData,
      "Packages",
      "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
      "LocalState",
      "settings.json",
    ),
    path.win32.join(localAppData, "Microsoft", "Windows Terminal", "settings.json"),
    path.win32.join(
      localAppData,
      "Packages",
      "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe",
      "LocalState",
      "settings.json",
    ),
  ];
  for (const settingsPath of settingsPaths) {
    try {
      const resolution = parseWindowsTerminalDefaultProfile(
        readFileSync(settingsPath, "utf8"),
        environment,
      );
      if (resolution) return resolution;
    } catch {
      // Missing, locked, or malformed settings files do not prevent fallback to
      // ComSpec and built-in shells.
    }
  }
  return null;
}
