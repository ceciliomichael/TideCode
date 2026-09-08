---
status: draft
---

# Ship accumulated changes before v1.4.1

Goal: commit every current modified and untracked product-work file and open one PR, while obeying RELEASE_INSTRUCTIONS.md.

Constraints: the eventual release/v1.4.1 PR must contain only CHANGELOG.md, package.json, and package-lock.json, so the current product changes must land separately first. Do not discard or clean any local changes.

Steps: verify main vs tidecode/main; run focused validation for the touched areas plus typecheck; create a product branch from current main; stage all current changes; commit once; push to tidecode; open a PR to main. Do not create/tag v1.4.1 until this product PR is merged because release instructions require release metadata to start from updated main.
