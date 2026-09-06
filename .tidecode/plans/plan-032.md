---
status: draft
---

# Merge current changes and release v1.3.3

Goal: merge the repository's current changes through a pull request, then prepare and publish TideCode v1.3.3 following .github/workflows/RELEASE_INSTRUCTIONS.md.

Plan:
1. Inspect current Git branch, worktree, diff, remotes, tags, and GitHub CLI authentication.
2. Verify the current changes are coherent and run the smallest relevant validation before committing.
3. Commit current changes on a non-main branch if needed, push it, create a PR to main, wait for required checks, and squash-merge it.
4. Update local main with fast-forward only.
5. Create release/v1.3.3, add the user-facing CHANGELOG section, and run scripts/release-version.mjs --version 1.3.3.
6. Verify only CHANGELOG.md, package.json, and package-lock.json are in the release PR, then commit, push, create the release PR, and squash-merge it.
7. Update main, create annotated tag v1.3.3, push it, monitor release.yml, and verify the published GitHub release plus clean worktree.

Scope: no unrelated cleanup, no force operations, no local installer build, and no gh release create.
