# Architecture

## Embedded Browser

`BrowserPanel.tsx` owns tab sessions, address drafts, navigation state, and the Electron webview elements. The application window attaches guest behavior and manages native DevTools views. Guest setup runs without synthetic user activation, including when Electron defers script execution until loading stops.

New tabs render the local `BrowserNewTabPage.tsx` with an empty address. No webview or iframe is started until a nonempty address or search is submitted. URL normalization keeps Google as the search provider, independently of the home view. Home resets the tab to a fresh local new-tab state and releases its page session.

`browserHistory.ts` normalizes completed website visits into at most six distinct HTTP/HTTPS origins and validates saved PNG icons. `useBrowserHistory.ts` owns their React state and local-storage persistence per project, migrating existing URL-only records when read. Credentials and page paths or queries are not saved.

`electron/browser/faviconCache.ts` tracks favicon URLs reported by native page WebContents. It downloads bounded images over HTTP/HTTPS with no credentials, limits and validates redirects, and deduplicates requests (including failures) in a bounded cache. The native preload favicon bridge accepts only a guest ID owned by the requesting application window, not an arbitrary URL. Results are associated with the current page and discarded after navigation or destruction. The history hook decodes these local data URLs into 32×32 PNGs; recent-site shortcuts render the persisted bytes without any network request.

Closing the last tab calls the Browser panel's parent close action. `ChatConversationSurface.tsx` removes that project's initialized Browser session, unmounting its guests, and `ChatInterfaceContent.tsx` returns to chat. Other projects' Browser sessions and locally saved recent sites remain intact; reopening the closed Browser creates a fresh new tab.

The embedded Browser is desktop Electron-only. Remote web clients do not render the Browser control, do not expose a Browser RPC namespace, and do not create virtual BrowserWindows or screencast page frames on the host.

DevTools are initialized on explicit user opening, rather than during guest load. The renderer requests native DevTools creation and visibility through the preload bridge; the main process owns the native views. Page title, favicon, and loading updates retain the existing webview session.

## Chat attachments and workspace aliases

Chat file, folder, and image attachments are copied into TideCode-managed per-draft or per-conversation storage under the history area instead of being added to the active workspace. The main process owns attachment persistence, draft adoption, conversation cloning, listing, and cleanup. Folder copies reject symbolic links and apply TideCode workspace ignores plus nested `.gitignore` rules.

The renderer refers to persisted attachments through stable `@attachments/...` aliases and workspace files through `@workspace/...` aliases. Workspace tool path resolution maps those aliases, along with enabled `@skills/...` paths, to their authorized backing locations while retaining the existing sandbox/full-access checks for absolute paths. Conversation identity is part of tool context so `@attachments/...` always resolves within the current chat.

Windows workspace copy/cut writes native file-drop clipboard data in addition to TideCode's internal marker, allowing Explorer and other native applications to receive the selected files while TideCode can still recognize its own clipboard operations.

## Remote project folder selection

Desktop project creation keeps the native Electron directory picker. Remote web clients use an in-app folder picker backed by the desktop host: the renderer requests host roots, directory listings, and folder mutations through the existing `tidecodeHistory` remote bridge, then passes the selected absolute path through the existing project creation flow. Rename, delete, copy/cut, and paste actions execute on the desktop host, while the web client receives directory metadata rather than file contents.
