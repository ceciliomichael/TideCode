# Plan 061: Prevent duplicate TideCode PATH entries

## Goal
Make the Windows setup installer safe to run repeatedly without appending the same TideCode `resources\\bin` directory to PATH again.

## Changes
- Add one NSIS helper macro in `installer/installer.nsh` that checks PATH entry-by-entry before writing.
- Treat PATH comparisons case-insensitively and ignore one trailing backslash when checking for the TideCode bin entry.
- Use the same helper for per-user and per-machine installation modes.
- Preserve unrelated PATH entries exactly as they are and keep existing updater/firewall behavior unchanged.
- Add focused regression coverage for the installer PATH contract.

## Verification
- Run the focused installer PATH test.
- Run TypeScript type checking and targeted lint for the test file.
- Run `git diff --check` on the touched files.
- Do not build or publish an installer locally.
