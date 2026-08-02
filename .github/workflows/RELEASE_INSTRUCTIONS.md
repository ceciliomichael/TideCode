# TideCode release instructions

Use this file when the user explicitly asks to commit and publish a release.

## Release flow

1. Review the work.

   ```powershell
   git status --short --branch
   git diff --stat
   git diff --check
   ```

   Preserve unrelated work. Do not reset, clean, rewrite, or delete existing releases or tags.

2. Run the gates before committing:

   ```powershell
   npm run typecheck
   npm test
   npm run build
   ```

3. Commit the reviewed product changes with one clear conventional message:

   ```powershell
   git add <reviewed-files>
   git diff --cached --check
   git commit -m "feat: <short user-facing summary>"
   git push tidecode main
   ```

4. Prepare the next unused version. Add a specific section at the top of `CHANGELOG.md`:

   ```markdown
   ## 1.0.7 — Short release theme

   One or two sentences describing the user-facing result.

   - List the meaningful changes included in this release.
   ```

5. Bump `package.json` and `package-lock.json`, then create the release commit and tag:

   ```powershell
   node scripts/release-version.mjs --version 1.0.7 --commit
   git push tidecode main
   git push tidecode v1.0.7
   ```

   Use the next unused semantic version. Never move or recreate an existing tag. Do not use `--allow-dirty` for a normal release.

## GitHub workflow

Pushing a `v*` tag starts `.github/workflows/release.yml`. It extracts the matching changelog section, creates a draft release, builds Windows/macOS/Linux artifacts, uploads them, and publishes the release after all builds pass.

On Windows, use the full GitHub CLI path when needed:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" run list --repo ceciliomichael/TideCode
& "C:\Program Files\GitHub CLI\gh.exe" release view v1.0.7 --repo ceciliomichael/TideCode
```

If a workflow fails, inspect it before changing any tag:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" run view <run-id> --repo ceciliomichael/TideCode --log-failed
```

## Update behavior

Packaged TideCode uses `electron-updater` with GitHub Releases. Downloads require user approval unless automatic downloads are enabled. A downloaded update installs silently when the user closes TideCode; Settings also provides an immediate restart option. Test installation with a packaged build, not the development app.
