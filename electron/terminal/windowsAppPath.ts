import { spawnSync } from "node:child_process";
import path from "node:path";

function readEnvironmentValue(environment: NodeJS.ProcessEnv, key: string) {
  const normalizedKey = key.toLowerCase();
  for (const [environmentKey, value] of Object.entries(environment)) {
    if (environmentKey.toLowerCase() !== normalizedKey) continue;
    const normalizedValue = value?.trim();
    if (normalizedValue) return normalizedValue;
  }
  return undefined;
}

function expandEnvironmentVariables(value: string, environment: NodeJS.ProcessEnv) {
  return value.replace(/%([^%]+)%/gu, (match, key: string) =>
    readEnvironmentValue(environment, key) ?? match);
}

export function parseWindowsAppPathRegistryOutput(
  output: string,
  environment: NodeJS.ProcessEnv,
) {
  const valueMatch = /^\s*(?:\(Default\)|[^\r\n]*?)\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/imu.exec(output);
  const executablePath = valueMatch?.[1]?.trim();
  return executablePath
    ? expandEnvironmentVariables(executablePath, environment)
    : null;
}

export function resolveWindowsAppPathExecutable(
  executableName: "pwsh.exe",
  environment: NodeJS.ProcessEnv,
) {
  const systemRoot = readEnvironmentValue(environment, "SystemRoot")
    ?? readEnvironmentValue(environment, "WinDir");
  const registryCommand = systemRoot
    ? path.win32.join(systemRoot, "System32", "reg.exe")
    : "reg.exe";
  const registryKeys = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
  ];

  for (const registryKey of registryKeys) {
    const result = spawnSync(registryCommand, ["query", registryKey, "/ve"], {
      encoding: "utf8",
      env: environment,
      timeout: 1_000,
      windowsHide: true,
    });
    if (result.status !== 0 || typeof result.stdout !== "string") continue;
    const executablePath = parseWindowsAppPathRegistryOutput(result.stdout, environment);
    if (executablePath) return executablePath;
  }
  return null;
}
