# Architecture

## Embedded Browser

`BrowserPanel.tsx` owns tab sessions, address drafts, navigation state, and the Electron webview elements. The application window attaches guest behavior and manages native DevTools views. Guest setup runs without synthetic user activation, including when Electron defers script execution until loading stops.

New tabs render the local `BrowserNewTabPage.tsx` with an empty address. No webview, iframe, or remote screencast is started until a nonempty address or search is submitted. URL normalization keeps Google as the search provider, independently of the home view. Home resets the tab to a fresh local new-tab state and releases its page session. Pending remote operation results are discarded after this reset. Remote page sessions do not implicitly navigate when created.

`browserHistory.ts` normalizes completed website visits into at most six distinct HTTP/HTTPS origins and validates saved PNG icons. `useBrowserHistory.ts` owns their React state and local-storage persistence per project, migrating existing URL-only records when read. Credentials and page paths or queries are not saved.

`electron/browser/faviconCache.ts` tracks favicon URLs reported by native and remote page WebContents. It downloads bounded images over HTTP/HTTPS with no credentials, limits and validates redirects, and deduplicates requests (including failures) in a bounded cache. The native preload favicon bridge accepts only a guest ID owned by the requesting application window, not an arbitrary URL. Results are associated with the current page and discarded after navigation or destruction. Remote frames include cached image data. The history hook decodes these local data URLs into 32×32 PNGs; recent-site shortcuts render the persisted bytes without any network request.

Closing the last tab calls the Browser panel's parent close action. `ChatConversationSurface.tsx` removes that project's initialized Browser session, unmounting its guests, and `ChatInterfaceContent.tsx` returns to chat. Remote sessions are explicitly closed. Other projects' Browser sessions and locally saved recent sites remain intact; reopening the closed Browser creates a fresh new tab.

DevTools are initialized on explicit user opening, rather than during guest load. The renderer requests native DevTools creation and visibility through the preload bridge; the main process owns the native views. Page title, favicon, and loading updates retain the existing webview session.
