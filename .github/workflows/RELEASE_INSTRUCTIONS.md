# TideCode release workflow

Use this guide only after the user asks to commit and publish a release.

## 1. Review and test

```powershell
git status --short --branch
git diff --stat
git diff --check
npm run typecheck
npm test
npm run build
```

Review the full diff. Preserve unrelated work. Never reset, clean, rewrite, or delete existing releases or tags.

## 2. Commit the product changes

Use one clear conventional commit, then push `main`:

```powershell
git add <reviewed-files>
git diff --cached --check
git commit -m "feat: <short user-facing summary>"
git push tidecode main
```

## 3. Prepare and publish the release

Choose the next unused `x.y.z` version. Add its user-facing notes to the top of `CHANGELOG.md`, then bump `package.json` and `package-lock.json`:

```powershell
node scripts/release-version.mjs --version <version>
git add CHANGELOG.md package.json package-lock.json
git diff --cached --check
git commit -m "chore(release): v<version>"
git tag -a v<version> -m "TideCode v<version>"
git push tidecode main
git push tidecode v<version>
```

Do not reuse an existing tag or use `--allow-dirty` for a normal release. The tag must contain the matching changelog section.

## 4. Verify GitHub

Pushing `v*` starts `.github/workflows/release.yml`. It creates the release notes, builds Windows/macOS/Linux installers, uploads updater metadata and artifacts, and publishes the release after all builds pass.

On Windows, use:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" run list --repo ceciliomichael/TideCode
& "C:\Program Files\GitHub CLI\gh.exe" release view v<version> --repo ceciliomichael/TideCode
```

Packaged TideCode downloads updates only after user approval unless automatic downloads are enabled. A downloaded update installs silently when the app closes; Settings also has an immediate restart option. Test installation with a packaged build, not the development app.
