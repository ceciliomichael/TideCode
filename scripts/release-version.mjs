#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { stdin as input, stdout as output } from "node:process";

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)$/;
const VALID_BUMPS = new Set(["patch", "minor", "major"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }
  return result.stdout.trim();
}

function parseSemver(version) {
  const match = version.match(SEMVER_REGEX);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpVersion(current, bumpType) {
  const parsed = parseSemver(current);
  if (!parsed) {
    fail(`Current package version is not simple semver (x.y.z): ${current}`);
  }

  if (bumpType === "patch") {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
  if (bumpType === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  if (bumpType === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  fail(`Unsupported bump type: ${bumpType}`);
}

function parseArgs(argv) {
  const options = {
    bump: null,
    version: null,
    commit: false,
    push: false,
    allowDirty: false,
    dryRun: false,
    remote: "tidecode",
    interactive: false,
  };

  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--bump") {
      options.bump = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--version") {
      options.version = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--commit") {
      options.commit = true;
      continue;
    }
    if (token === "--push") {
      options.push = true;
      options.commit = true;
      continue;
    }
    if (token === "--allow-dirty") {
      options.allowDirty = true;
      continue;
    }
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--remote") {
      options.remote = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (token === "--interactive" || token === "-i") {
      options.interactive = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelpAndExit(0);
    }
    positional.push(token);
  }

  if (!options.bump && !options.version && positional.length > 0) {
    const first = positional[0];
    if (VALID_BUMPS.has(first)) {
      options.bump = first;
    } else {
      options.version = first;
    }
  }

  if (options.bump && options.version) {
    fail("Use only one of --bump or --version.");
  }

  if (options.bump && !VALID_BUMPS.has(options.bump)) {
    fail("Invalid bump value. Use patch, minor, or major.");
  }

  if (options.version && !parseSemver(options.version)) {
    fail("Invalid version format. Expected x.y.z");
  }

  if (!options.remote) {
    fail("--remote requires a non-empty value.");
  }

  return options;
}

function printHelpAndExit(code) {
  console.log(`Usage:
  node scripts/release-version.mjs [patch|minor|major|x.y.z] [options]

Options:
  --bump <patch|minor|major>  Choose version bump type
  --version <x.y.z>           Set explicit version
  --interactive, -i           Interactive prompt mode
  --commit                    Commit package version files and create git tag
  --push                      Push branch and tag to remote (implies --commit)
  --remote <name>             Git remote name for push (default: tidecode)
  --allow-dirty               Allow running with a dirty git working tree
  --dry-run                   Print actions without writing files
  --help                      Show this help
`);
  process.exit(code);
}

function ensureCleanWorkingTree(allowDirty) {
  if (allowDirty) {
    return;
  }
  const status = runCapture("git", ["status", "--porcelain"]);
  if (status) {
    fail("Git working tree is not clean. Commit/stash changes or pass --allow-dirty.");
  }
}

function ensureTagDoesNotExist(tagName) {
  const local = runCapture("git", ["tag", "--list", tagName]);
  if (local === tagName) {
    fail(`Tag already exists locally: ${tagName}`);
  }
}

function parseYesNo(value, defaultValue) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (normalized === "y" || normalized === "yes") {
    return true;
  }
  if (normalized === "n" || normalized === "no") {
    return false;
  }
  fail("Please answer with y/yes or n/no.");
}

async function promptInteractive(options, currentVersion) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(`Current version: ${currentVersion}`);
    console.log("Release type:");
    console.log("  1) patch");
    console.log("  2) minor");
    console.log("  3) major");
    console.log("  4) custom version");

    const choice = (await rl.question("Select [1-4] (default 1): ")).trim() || "1";
    if (choice === "1") {
      options.bump = "patch";
      options.version = null;
    } else if (choice === "2") {
      options.bump = "minor";
      options.version = null;
    } else if (choice === "3") {
      options.bump = "major";
      options.version = null;
    } else if (choice === "4") {
      const explicit = (await rl.question("Enter version (x.y.z): ")).trim();
      if (!parseSemver(explicit)) {
        fail("Invalid custom version format. Expected x.y.z");
      }
      options.version = explicit;
      options.bump = null;
    } else {
      fail("Invalid selection.");
    }

    options.commit = parseYesNo(await rl.question("Create commit + tag? [Y/n]: "), true);
    if (options.commit) {
      options.push = parseYesNo(await rl.question("Push branch + tag? [Y/n]: "), true);
    } else {
      options.push = false;
    }

    if (options.push) {
      const remote = (await rl.question(`Remote name (default ${options.remote}): `)).trim();
      if (remote) {
        options.remote = remote;
      }
    }

    options.allowDirty = parseYesNo(await rl.question("Allow dirty working tree? [y/N]: "), false);
    options.dryRun = parseYesNo(await rl.question("Dry run only? [y/N]: "), false);
  } finally {
    rl.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const packagePath = path.join(repoRoot, "package.json");
  const lockPath = path.join(repoRoot, "package-lock.json");

  if (!fs.existsSync(packagePath)) {
    fail(`package.json not found at ${packagePath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const currentVersion = String(packageJson.version ?? "");
  if (!parseSemver(currentVersion)) {
    fail(`package.json version must be x.y.z. Found: ${currentVersion}`);
  }

  if (options.interactive || (!options.bump && !options.version && process.stdin.isTTY === true)) {
    await promptInteractive(options, currentVersion);
  }

  if (!options.bump && !options.version) {
    options.bump = "patch";
  }

  if (options.commit) {
    ensureCleanWorkingTree(options.allowDirty);
  }

  const nextVersion = options.version || bumpVersion(currentVersion, options.bump);
  const nextTag = `v${nextVersion}`;

  console.log(`Current version: ${currentVersion}`);
  console.log(`Next version:    ${nextVersion}`);
  console.log(`Git tag:         ${nextTag}`);

  if (options.dryRun) {
    console.log("Dry run enabled. No files or git state were changed.");
    return;
  }

  packageJson.version = nextVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  if (fs.existsSync(lockPath)) {
    const lockJson = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (typeof lockJson.version === "string") {
      lockJson.version = nextVersion;
    }
    if (lockJson.packages && lockJson.packages[""] && typeof lockJson.packages[""] === "object") {
      lockJson.packages[""].version = nextVersion;
    }
    fs.writeFileSync(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`, "utf8");
  }

  console.log("Updated package version files.");

  if (!options.commit) {
    console.log("Skipping git commit/tag (pass --commit to create release commit and tag).");
    return;
  }

  ensureTagDoesNotExist(nextTag);

  const filesToAdd = ["package.json"];
  if (fs.existsSync(lockPath)) {
    filesToAdd.push("package-lock.json");
  }

  run("git", ["add", ...filesToAdd]);
  run("git", ["commit", "-m", `chore(release): ${nextTag}`]);
  run("git", ["tag", "-a", nextTag, "-m", nextTag]);

  console.log("Created release commit and annotated tag.");

  if (options.push) {
    run("git", ["push", options.remote, "HEAD"]);
    run("git", ["push", options.remote, nextTag]);
    console.log("Pushed branch and tag.");
  } else {
    console.log("Skipping push (pass --push to push branch and tag).");
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
