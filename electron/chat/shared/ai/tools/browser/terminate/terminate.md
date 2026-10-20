# tools.browser.terminate

Close one browser tab by tab_id. AI-created hidden tabs close immediately and release Chromium resources. Visible TideCode tabs receive a close request, allowing the renderer to unmount the tab.

Example: await tools.browser.terminate({ tab_id: "id-from-browser-tabs" })

The returned status distinguishes closed from close_requested. Do not assume the entire TideCode browser or project was closed.
