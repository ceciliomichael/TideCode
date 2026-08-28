# Development Settings Snapshot

## Goal

Prevent `npm run dev` from contending with the production app's settings lock by giving the development Electron process an isolated copy of application settings.

## Findings

- Chromium already uses a separate development profile.
- The settings store still defaults to `%USERPROFILE%\\.tidecode\\config`, so production and development share `settings.lock`.
- The single-instance check must happen before refreshing the development copy so a second dev launch cannot overwrite a running dev process's files.

## Changes

- After acquiring the development single-instance lock, copy application settings JSON files into a dev-only settings home.
- Exclude lock files, temporary files, and backups from the snapshot.
- Set `TIDECODE_SETTINGS_HOME` for the dev process before any settings reads occur.
- Keep provider credentials outside this snapshot so secrets are not duplicated.

## Reliability and scope

- Refresh the snapshot once per new dev launch; do not continuously synchronize it, which would reintroduce concurrent writes and overwrite dev changes.
- Preserve production settings and the existing settings-lock recovery behavior.

## Verification

- Add focused tests for the snapshot file selection/copy behavior.
- Run the settings tests, context-usage tests, typecheck, lint, and diff checks for affected files.
