# TideCode release instructions

Use this procedure only when a maintainer explicitly asks for a release. Assume product work has already been reviewed and validated through the normal development process. This document covers release metadata, the release tag, and the existing GitHub Actions workflow.

## Release contract

- Use a new stable semantic version: `x.y.z`.
- The version must be higher than the latest `v*` tag.
- Release only from the current `main` branch.
- The release pull request contains only `CHANGELOG.md`, `package.json`, and `package-lock.json`.
- Never replace or delete a published tag. Never use force-push, `git reset --hard`, `git clean`, or `--allow-dirty`.
- Do not build installers locally or run `gh release create`. The tag-driven workflow does that.

## 1. Start from current main

Run from the repository root:

```text
git status --short --branch
git switch main
git pull --ff-only <remote> main
git tag --list "v*" --sort=-version:refname
gh auth status
```

Continue when the worktree is understood, GitHub access is available, and the chosen version is unused and newer than the latest stable tag. Do not discard unrelated local changes; stop and resolve them first.

## 2. Prepare the release metadata

Create a release branch from the updated `main`:

```text
git switch -c release/v<version>
```

Add a short, user-facing section at the top of `CHANGELOG.md`, below `# Changelog`:

```markdown
## <version> — Short release theme

A concise explanation of what users get in this release.

- Important user-visible improvement or fix.
- Breaking change, migration step, or known limitation, if applicable.
```

Use the real version and changes; do not copy the example text. Then update both package manifests with the repository script:

```text
node scripts/release-version.mjs --version <version>
```

Review only the release metadata:

```text
npm pkg get version
git diff --check
git diff -- CHANGELOG.md package.json package-lock.json
```

The package version and changelog heading must both match `<version>`.

## 3. Open and merge the release pull request

```text
git add CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): prepare v<version>"
git push --set-upstream <remote> release/v<version>
gh pr create --base main --head release/v<version> --title "chore(release): prepare v<version>" --body "Prepare TideCode v<version>."
```

Merge the pull request using the repository’s normal squash-merge process. The release PR does not need a second product review or a local product test pass; the product was assumed ready before this procedure and repository CI remains the source of truth for required checks.

After it is merged:

```text
git switch main
git pull --ff-only <remote> main
```

## 4. Tag the merged release commit

Create and push an annotated tag from the updated `main`:

```text
git tag -a v<version> -m "TideCode v<version>"
git push <remote> v<version>
```

The tag must be created after the release PR is merged. Pushing it starts `.github/workflows/release.yml`.

## 5. Let the workflow publish the release

The workflow automatically:

1. Reads the matching `CHANGELOG.md` section.
2. Creates a draft GitHub release.
3. Builds and uploads Windows, macOS, and Linux packages plus updater metadata.
4. Publishes the release only after all platform builds succeed.

Monitor the run:

```text
gh run list --workflow release.yml --limit 1
gh run watch <run-id>
```

When it succeeds, perform the one final check:

```text
gh release view v<version>
git status --short --branch
```

Confirm that the release is published, the notes are correct, the expected platform assets are present, and the worktree is clean. Report the version, release URL, workflow result, and any meaningful warning.

## If the workflow fails

First inspect the failed job:

```text
gh run view <run-id> --log-failed
```

If the tagged commit is correct, rerun the workflow for the existing tag instead of creating another tag:

```text
gh workflow run release.yml -f release_tag=v<version>
```

Fix code or release metadata in a new commit when necessary. Never silently delete, replace, or force-update a published tag.

## Optional packaged-app smoke test

For update behavior, test the published installer rather than the development server. Verify that the release notes appear, downloads follow the user’s automatic-download setting, and the downloaded update installs when TideCode closes or when the user chooses an immediate restart.
