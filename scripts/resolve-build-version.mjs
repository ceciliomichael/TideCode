#!/usr/bin/env node

import fs from "node:fs";

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeTagToVersion(rawTag) {
  const cleaned = String(rawTag || "")
    .trim()
    .replace(/^refs\/tags\//i, "")
    .replace(/\^\{\}$/, "")
    .replace(/^v/i, "");
  return cleaned;
}

function main() {
  const pkgPath = "package.json";
  if (!fs.existsSync(pkgPath)) {
    fail("package.json not found");
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const input = String(process.env.WORKFLOW_INPUT_VERSION || "").trim();
  const refType = String(process.env.GITHUB_REF_TYPE || "").trim();
  const refName = String(process.env.GITHUB_REF_NAME || "").trim();
  const refFull = String(process.env.GITHUB_REF || "").trim();

  let resolved;

  if (input) {
    const normalizedInput = normalizeTagToVersion(input);
    if (!SEMVER_REGEX.test(normalizedInput)) {
      fail(`Invalid workflow_dispatch version input: ${input}`);
    }
    resolved = normalizedInput;
  } else if (refType.toLowerCase() === "tag" || refFull.startsWith("refs/tags/")) {
    const rawTag = refName || refFull;
    const fromTag = normalizeTagToVersion(rawTag);
    if (!SEMVER_REGEX.test(fromTag)) {
      fail(`Invalid tag for versioning: ${rawTag}`);
    }
    resolved = fromTag;
  } else {
    resolved = String(pkg.version || "").trim();
  }

  if (!SEMVER_REGEX.test(resolved)) {
    fail(`Resolved version is invalid: ${resolved}`);
  }

  if (pkg.version !== resolved) {
    pkg.version = resolved;
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }

  console.log(`Resolved build version: ${resolved}`);
}

main();
