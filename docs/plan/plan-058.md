# Uniform clickable skill cards and editing

## Goal

Make every skill card use the same compact, clickable layout as the default-model configuration card, with an edit dialog for the existing skill.

## Changes

- Match the configuration card dimensions, spacing, hover behavior, and right-side action label.
- Reuse the skill dialog for both adding and editing, without showing a focus ring on its fields.
- Load the selected skill's instructions and save name, description, and content back to the same SKILL.md location.
- Add the renderer, preload, IPC, and service wiring needed for loading and updating skills.

## Verification

Run the TypeScript typecheck, targeted skill/settings lint or tests, and git diff --check.
