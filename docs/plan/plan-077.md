# Merge develop and release v1.4.0

## Goal
Merge the rebased Code Mode V2 work from develop into main without losing the new commit, then publish TideCode v1.4.0 by following .github/workflows/release_instructions.md.

## Implementation
- Confirm develop is clean and based on the current main commit plus the rebased Code Mode V2 commit.
- Fast-forward main to develop and push main to the tidecode remote without force-pushing.
- Create release/v1.4.0 from updated main.
- Add a concise user-facing v1.4.0 changelog section for the owned Code Mode V2 runtime and reliability improvements.
- Run scripts/release-version.mjs --version 1.4.0 so package.json and package-lock.json match the release version.
- Commit only CHANGELOG.md, package.json, and package-lock.json on the release branch, push it, open the release PR, and squash-merge it using the normal repository flow.
- Update local main, create and push annotated tag v1.4.0, then monitor the tag-driven release workflow and verify the published GitHub release.

## Verification
- Keep the worktree clean before each branch/release transition.
- Confirm v1.4.0 is unused and newer than v1.3.4.
- Review the metadata-only release diff, run npm pkg get version and git diff --check.
- Confirm main contains the Code Mode V2 commit before release metadata is prepared.
- Confirm the release workflow succeeds and the published release has the expected notes/assets.

## Scope
- In scope: develop-to-main merge, v1.4.0 release metadata, release PR, tag, workflow monitoring, and final release verification.
- Out of scope: unrelated source changes, force-pushing, replacing existing tags, or local installer builds.
