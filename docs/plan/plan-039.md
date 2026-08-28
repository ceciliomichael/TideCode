# Settings Lock Recovery

## Goal
Prevent context-estimation and other concurrent settings reads from timing out on a stale or unnecessarily contended settings lock.

## Changes
- Serialize settings-lock operations within one process.
- Record the owning process ID in the lock file.
- Reclaim locks whose recorded owner has exited, while retaining locks owned by live processes.
- Keep a short legacy stale-lock fallback for old empty lock files.

## Verification
- Test concurrent settings reads and recovery from an exited-owner lock.
- Run the settings suite, affected context tests, type checking, linting, and diff validation.

## Scope
- Preserve atomic settings writes and cross-process exclusion; do not change settings values or lock ownership semantics for live processes.
