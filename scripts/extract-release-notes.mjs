#!/usr/bin/env node

import fs from 'node:fs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeVersion(rawTag) {
  const normalized = String(rawTag ?? '')
    .trim()
    .replace(/^refs\/tags\//iu, '')
    .replace(/^v/iu, '');

  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(normalized)) {
    fail(`Release tag must contain a semantic version: ${rawTag}`);
  }

  return normalized;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function extractReleaseNotes(changelog, version) {
  const escapedVersion = escapeRegExp(version);
  const headingPattern = new RegExp(`^##\\s+(?:\\[)?${escapedVersion}(?:\\])?(?:\\s|$).*?$`, 'imu');
  const headingMatch = headingPattern.exec(changelog);

  if (!headingMatch || headingMatch.index === undefined) {
    fail(`CHANGELOG.md does not contain a level-two heading for version ${version}.`);
  }

  const sectionStart = headingMatch.index;
  const sectionBodyStart = sectionStart + headingMatch[0].length;
  const sectionEnd = changelog.slice(sectionBodyStart).search(/^##\s+/imu);
  const section = sectionEnd === -1
    ? changelog.slice(sectionStart)
    : changelog.slice(sectionStart, sectionStart + headingMatch[0].length + sectionEnd);
  const normalizedSection = section.trim();

  if (normalizedSection.split(/\r?\n/u).length < 2) {
    fail(`The CHANGELOG.md section for version ${version} is empty.`);
  }

  return normalizedSection;
}

const tag = process.argv[2];
if (!tag) {
  fail('Usage: node scripts/extract-release-notes.mjs <tag>');
}

const changelogPath = new URL('../CHANGELOG.md', import.meta.url);
if (!fs.existsSync(changelogPath)) {
  fail('CHANGELOG.md is required for a release.');
}

const version = normalizeVersion(tag);
const changelog = fs.readFileSync(changelogPath, 'utf8');
const releaseNotes = extractReleaseNotes(changelog, version);

process.stdout.write(`${releaseNotes}\n`);
