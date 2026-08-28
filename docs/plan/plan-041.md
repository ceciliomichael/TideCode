# Merge and Release 1.2.26

## Goal

Merge the completed `feat/plan-runtime-contract` work through a squash pull request, then publish the next stable TideCode release from updated `main` using the repository release workflow.

## Changes

- Verify the current branch with focused/full automated checks, TypeScript, lint, build, and diff validation as appropriate.
- Commit all intentional current branch changes, including plans 032-041, push the branch, open a PR, and squash-merge it into `main`.
- From clean updated `main`, prepare release `1.2.26` with only `CHANGELOG.md`, `package.json`, and `package-lock.json` changed on the release branch.
- Build the changelog from every commit after `v1.2.25`, including the tray behavior change and the merged Plan/Code Mode runtime work.
- Open and squash-merge the release PR, tag the resulting `main` commit as `v1.2.26`, and let the existing release workflow publish the GitHub release.

## Verification

- Confirm branch PR checks pass before merge.
- Confirm release metadata version and changelog heading match `1.2.26` and `git diff --check` is clean.
- Monitor the tag-triggered release workflow and verify the published release, assets, release notes, tag, and final clean worktree.

## Scope

Do not discard or rewrite unrelated work, force-push, replace tags, build installers locally, or create the GitHub release manually.
