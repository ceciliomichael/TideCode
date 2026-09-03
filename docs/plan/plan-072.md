# Plan 072: Balance project filter icon spacing

## Goal
Increase the left inset of the folder icon in the sidebar's project filter while leaving the chevron's right inset unchanged.

## Changes
- Update the project filter button padding in `ProjectThreadSelector.tsx` from uniform horizontal padding to a larger left padding and the existing right padding.

## Verification
- Run the repository's relevant typecheck/build validation.
- Confirm the change is limited to the sidebar filter control.
