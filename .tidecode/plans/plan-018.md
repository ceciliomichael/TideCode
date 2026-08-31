---
status: draft
---

# Generalize Code Mode payload repair

Goal: recover malformed long template-literal payload bindings such as const plan = `...` when Markdown backticks prematurely close the JavaScript string, but only when the binding is later passed into a tools.* argument. Changes: generalize the binding matcher in electron/chat/shared/codeMode/validation.ts, keep existing tool-usage and syntax-validation guards, and add a regression covering tools.plan_create({ content: plan }). Verification: run the focused reliability tests, full Code Mode tests, and TypeScript typecheck. Scope: no provider-facing tool changes and no broad JavaScript autocorrection.
