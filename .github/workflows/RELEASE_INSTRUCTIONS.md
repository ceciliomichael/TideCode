# TideCode release instructions

This is the release procedure for TideCode maintainers, humans, and AI agents. Use it only after the user explicitly asks for a release. The commands are intentionally platform-neutral: use the normal git, npm, node, and gh commands available in the current terminal. Do not substitute an absolute path to a CLI executable.

## Release rules

- Inspect the worktree before changing anything. Include only changes that belong to the requested release; preserve unrelated user work.
- Use the next unused stable x.y.z version. Do not reuse an existing tag or release.
- Product changes and release metadata land through pull requests; do not push release work directly to main.
- The release tag must point to the merged release commit and must contain the matching CHANGELOG.md section.
- Release notes must describe user-visible behavior and group related changes semantically. Do not publish raw automated commit messages as release notes.
- Never use git reset --hard, git clean, force-push, tag replacement, or --allow-dirty for a normal release.
- Do not manually commit generated installers or updater metadata. The release workflow builds and uploads those artifacts.

## 1. Confirm access and repository state

Run these commands from the repository root. If the repository uses a remote or branch name other than the examples, use the values shown by the inspection commands.

~~~text
git status --short --branch
git remote -v
git branch --show-current
git tag --list "v*" --sort=-version:refname
gh auth status
gh repo view --json nameWithOwner,defaultBranchRef
gh release list --limit 20
~~~

Confirm that:

1. The intended branch is checked out.
2. The configured GitHub account can push and publish releases.
3. The requested version is greater than every existing v* tag and release.
4. Any existing worktree changes are understood before staging files.

## 2. Review and validate the product changes

Review the complete diff, not only the file summary:

~~~text
git diff --stat
git diff --check
git diff
~~~

Run the repository checks that apply to the release:

~~~text
npm run typecheck
npm test
npm run build
~~~

If a check fails, fix the code or report the failure. Do not publish a release that has not been reviewed. A successful build may still print bundle-size or chunking warnings; distinguish warnings from errors and record anything meaningful in the handoff.

## 3. Land product changes through a pull request

Product work belongs on a feature or fix branch. If the requested changes are still uncommitted on main, create the branch before staging them. Keep package.json, package-lock.json, and CHANGELOG.md out of the product PR unless they are part of the user-facing product change itself.

~~~text
git switch -c <type>/<short-description>
git add <reviewed-product-files>
git diff --cached --stat
git diff --cached --check
git commit -m "<type>: <clear user-facing summary>" -m "<Detailed body describing the user-visible behavior, implementation scope, and validation>"
git push --set-upstream <remote> <branch>
gh pr create --base main --head <branch> --title "<type>: <clear user-facing summary>" --body-file <pull-request-description>
gh pr checks <pull-request-number> --watch
gh pr merge <pull-request-number> --squash --delete-branch
~~~

Use a conventional subject such as fix: show release notes while updates download or feat: preserve long-running terminal output. Keep the subject short, specific, and free of issue-tracker or AI-generated filler. The PR description must explain the user-visible behavior, important compatibility details, and validation. Merge only after the required checks pass. Refresh main after the squash merge:

~~~text
git switch main
git pull --ff-only <remote> main
~~~

CI validates every product pull request. Metadata-only pushes to main are intentionally ignored because the release pull request has already validated those files and the tag-driven workflow validates packaged output.

## 4. Prepare the release pull request

Create a release branch from the current main commit. The release branch contains only the version metadata and changelog for this release:

~~~text
git switch main
git pull --ff-only <remote> main
git switch -c release/v<version>
~~~

Choose a semantic title and write the release section at the top of CHANGELOG.md beneath # Changelog:

~~~markdown
## 1.0.8 — Short user-facing theme

One paragraph explaining the result of the release for TideCode users.

- Grouped user-visible improvement.
- Important fix or behavior change.
- Validation, compatibility, or packaging note when useful.
~~~

Use the actual version and changes; do not copy this example verbatim. Keep notes readable in both GitHub and TideCode’s Markdown release-details view. Mention breaking changes, migration steps, or known limitations when they exist.

Bump both package manifests with the repository’s version script:

~~~text
node scripts/release-version.mjs --version <version>
~~~

This updates package.json and package-lock.json without creating a commit or tag. Add the changelog section, then confirm the result and ensure the heading matches exactly:

~~~text
npm pkg get version
git diff -- CHANGELOG.md package.json package-lock.json
git diff --check
~~~

## 5. Merge the release pull request and tag the merged commit

Commit the release metadata on the release branch and open a pull request. Do not tag the branch before it is merged:

~~~text
git add CHANGELOG.md package.json package-lock.json
git diff --cached --stat
git diff --cached --check
git commit -m "chore(release): prepare v<version>"
git push --set-upstream <remote> release/v<version>
gh pr create --base main --head release/v<version> --title "chore(release): prepare v<version>" --body-file <release-description>
gh pr checks <pull-request-number> --watch
~~~

Merge the release pull request with squash merge after its checks pass, then tag the resulting main commit:

~~~text
gh pr merge <pull-request-number> --squash --delete-branch
git switch main
git pull --ff-only <remote> main
git tag -a v<version> -m "TideCode v<version>"
git push <remote> v<version>
~~~

Before pushing the tag, verify that it points to the merged release commit and that the release section is present in the tagged content:

~~~text
git show --no-patch --decorate v<version>
git show v<version>:CHANGELOG.md
git status --short --branch
~~~

Pushing the v* tag starts .github/workflows/release.yml. Do not run gh release create in the normal flow because the workflow owns release creation, semantic release-note extraction, artifact publishing, and final publication.

## 6. Monitor and verify the GitHub release

Find the workflow run and inspect it with the GitHub CLI:

~~~text
gh run list --workflow release.yml --limit 5
gh run view <run-id>
gh run watch <run-id>
~~~

The workflow performs these jobs:

- Extracts the matching section from CHANGELOG.md.
- Creates a draft release for the tag with those notes.
- Builds and publishes Windows, macOS, and Linux packages on their native GitHub-hosted runners.
- Uploads installer artifacts and the updater metadata required by electron-updater.
- Publishes the release only after every platform build succeeds.

After the workflow completes, verify the release and assets:

~~~text
gh release view v<version>
gh release download v<version> --dir <temporary-download-directory>
~~~

Check that the release title, notes, tag, installers, and platform updater metadata are present. The generated latest*.yml files are expected release assets; they are not source files to commit.

## 7. Post-release checks and handoff

Confirm the repository is clean and the remote points at the release commit:

~~~text
git status --short --branch
git log -3 --oneline --decorate
git ls-remote --tags <remote> v<version>
~~~

Report the release version, GitHub release URL, workflow result, and any warnings. If the workflow fails, inspect the failed job before taking action:

~~~text
gh run view <run-id> --log-failed
~~~

Fix the underlying issue in a new normal commit, rerun the workflow when the existing tagged commit is valid, or request explicit maintainer direction before changing a tag or release. Never silently delete or replace a published tag.

## Update behavior to test in a packaged app

TideCode checks GitHub at app launch when Check for updates at launch is enabled. Opening Updates reuses that launch result instead of issuing a duplicate check; when launch checking is disabled, opening Updates performs a fresh check. The Check again action always performs an explicit fresh check. With automatic downloads enabled, the release notes appear immediately while the download runs and progress updates in the same view. With automatic downloads disabled, discovering a release does not download it without user approval. A downloaded update installs when TideCode closes, and Settings can offer an immediate restart when the user chooses it. Test this with a packaged installer, not the development server.
