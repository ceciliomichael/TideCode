# TideCode release instructions

This is the release procedure for TideCode maintainers, humans, and AI agents. Use it only after the user explicitly asks for a release. The commands are intentionally platform-neutral: use the normal git, npm, node, and gh commands available in the current terminal. Do not substitute an absolute path to a CLI executable.

## Release rules

- Inspect the worktree before changing anything. Include only changes that belong to the requested release; preserve unrelated user work.
- Use the next unused stable x.y.z version. Do not reuse an existing tag or release.
- The release has two commits in this order: one normal conventional commit for the product changes, then one chore(release) commit for the changelog and version metadata.
- The release tag must point to the release metadata commit and must contain the matching CHANGELOG.md section.
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

## 3. Create the normal product commit first

Stage only the reviewed product files and tests. Do not stage package.json, package-lock.json, or CHANGELOG.md yet; those belong to the release metadata commit.

~~~text
git add <reviewed-product-files>
git diff --cached --stat
git diff --cached --check
git commit -m "<type>: <clear user-facing summary>"
~~~

Use a conventional subject such as fix: show release notes while updates download or feat: preserve long-running terminal output. Keep it short, specific, and free of issue-tracker or AI-generated filler. Verify the commit before pushing:

~~~text
git show --stat --oneline HEAD
git status --short --branch
git push <remote> <branch>
~~~

The normal product commit must be pushed before preparing the release metadata. If the worktree was already dirty before this task, do not push unrelated commits or changes.

## 4. Prepare the changelog and version metadata

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

This updates package.json and package-lock.json without creating a commit or tag. Confirm the result and ensure the changelog heading matches exactly:

~~~text
npm pkg get version
git diff -- CHANGELOG.md package.json package-lock.json
git diff --check
~~~

## 5. Create the release metadata commit and tag

Stage only the release metadata, then create the second, dedicated release commit:

~~~text
git add CHANGELOG.md package.json package-lock.json
git diff --cached --check
git commit -m "chore(release): v<version>"
git tag -a v<version> -m "TideCode v<version>"
git show --stat --oneline HEAD
git show --no-patch --decorate v<version>
~~~

Before pushing, verify that the tag is on the release commit and that the release section is present in the tagged content:

~~~text
git show v<version>:CHANGELOG.md
git status --short --branch
~~~

Then push the branch and tag:

~~~text
git push <remote> <branch>
git push <remote> v<version>
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

TideCode checks GitHub from Settings when the user requests a check. With automatic downloads enabled, the release notes appear immediately while the download runs and progress updates in the same view. With automatic downloads disabled, discovering a release does not download it without user approval. A downloaded update installs when TideCode closes, and Settings can offer an immediate restart when the user chooses it. Test this with a packaged installer, not the development server.
