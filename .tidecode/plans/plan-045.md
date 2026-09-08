---
status: draft
---

# Replace installer app-running check

Goal: eliminate the mid-install TideCode cannot be closed failure.

Findings: electron-builder runs CHECK_APP_RUNNING at the start of the install section, before uninstall/file replacement. The previous customInstall hook runs after files are installed, so it cannot fix that built-in failure. electron-builder already bundles nsProcess for native process control.

Implementation: define customCheckAppRunning so electron-builder invokes TideCode's own install-stage check, use nsProcess to find/kill TideCode.exe, retry/verify disappearance, and remove the redundant late customInstall close. Do not terminate the detached run service/CLI by process tree.

Verification: installer source regression tests, a Windows NSIS package build to prove the custom macro/plugin compiles, and TypeScript check.
