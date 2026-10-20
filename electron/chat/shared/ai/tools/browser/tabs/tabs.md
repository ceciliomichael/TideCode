# tools.browser.tabs

List browser tabs owned by the active project, including hidden AI tabs and visible non-incognito tabs. Each page returns at most 10 entries with tab_id, title, kind, URL, loading status, total and has_more.

Example: await tools.browser.tabs({ page: 1 })

Page numbers are 1-based. Continue only when has_more is true. Incognito tabs are excluded. Tab IDs are opaque and scoped to the current TideCode process and project.
