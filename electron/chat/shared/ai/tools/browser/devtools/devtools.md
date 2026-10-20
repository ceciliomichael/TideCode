# tools.browser.devtools

Inspect TideCode's built-in Chromium browser via a coordinated Chrome DevTools Protocol connection. Requires tab_id and action.

Actions:
- console: bounded console messages, warnings, JavaScript exceptions, stack information.
- network: bounded response statuses and request failure messages. Headers and response bodies are never collected for this view.
- performance: a bounded set of Chromium performance metrics.
- evaluate: JavaScript expression evaluation, available ONLY after the user explicitly enables Full Developer Mode in the TideCode browser toolbar for that project.
- cdp: advanced CDP domain.method with optional parameters, also requires explicit Full Developer Mode.

Examples:
await tools.browser.devtools({ tab_id: "id", action: "console" })
await tools.browser.devtools({ tab_id: "id", action: "network", limit: 30 })
await tools.browser.devtools({ tab_id: "id", action: "evaluate", expression: "document.title" })

Diagnostics record events while the CDP session is connected, so they may omit events before a visible tab was inspected. Sensitive fields are redacted from standard diagnostic output. Raw CDP and evaluate can run privileged page commands and must remain opt-in. The CDP session is coordinated with Electron DevTools; close the native DevTools window before invoking AI browser commands.
