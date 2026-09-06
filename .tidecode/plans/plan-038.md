---
status: draft
---

# Merge develop and publish release

Goal: merge the completed develop work into main, publish a new stable release using .github/workflows/RELEASE_INSTRUCTIONS.md, and return to develop.

Steps:
- Verify clean worktree, remote develop/main state, latest stable tag, package version, and GitHub CLI auth.
- Update main from remote, merge develop into main, and push main.
- Choose the next stable patch version above the latest tag, create release/v<version>, update only CHANGELOG.md/package.json/package-lock.json, commit, push, open and squash-merge the release PR.
- Pull updated main, create and push the annotated version tag, monitor release.yml until completion, and verify the published GitHub release/assets.
- Switch back to develop for continued work.

Verification: clean status at release boundaries, release metadata diff limited to the required three files, successful workflow, published release, final branch develop.
