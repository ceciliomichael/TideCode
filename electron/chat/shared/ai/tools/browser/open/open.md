# tools.browser.open

Open an absolute HTTP(S) URL as a tab in TideCode's existing browser. The browser panel stays closed if the user has not opened it; the live AI tab is available when they open the panel manually. Returns a stable tab_id for subsequent read/interact/devtools/tabs/terminate calls. Opening a URL already in an AI-created tab reuses it without navigating, resetting form state, or refreshing the page. Use new_tab: true only when a separate tab at that URL is explicitly needed. Reuse the returned tab_id for all subsequent operations. Read, click, fill, type, scroll, and DevTools operations do not need the URL and must not navigate or reload the page.

Example: await tools.browser.open({ url: "http://localhost:3000/" })

Open once and retain tab_id. For an existing tab, use browser.tabs to recover its identifier instead of opening its URL again. After the page navigates or redirects, continue reading/interacting with that same tab_id. Navigation does not require opening a replacement tab.

The AI and user control the same live webview, including its cookies, scroll position, page state, and navigation. Creating an AI tab never automatically opens the browser panel or replaces another side panel. HTTP(S) is required, and privileged URL schemes are rejected. Use browser.read with tab_id to inspect its current state without reloading.
