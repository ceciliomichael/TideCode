# Design

## Browser interaction

Browser startup, new tabs, and Home show a local TideCode page with a search/URL field. The address starts empty and receives focus when the new tab becomes active. Searches from either field use Google; URLs open directly. Empty submissions do nothing. The idle view has no loading indicator or page DevTools, and Reload is disabled until navigation. Home starts a fresh page session and resets navigation history.

The text-only `tidecode-word.svg` serves as a large new-tab heading, using the theme-aware brand color without the symbol or a square background. It scales down to fit narrow panels and sits close above the search field. The group sits above the panel's vertical midpoint, with twice as much remaining space below as above. The center search field is compact, uses a neutral “Search” hint, rounder corners, and no focus outline or changing border. Enter submits the field; there is no arrow button. Search-provider branding and explanatory hints are omitted. Up to six recently visited websites appear below it, most recent first, saved locally per project. Shortcuts show the website's favicon captured during browsing, cached locally across restarts; missing or failed icons use the site's initial. Opening a new tab never performs favicon lookups. Existing visits acquire icons when revisited. Shortcuts open the site's home origin rather than a previously visited private path or query.

Closing the last Browser tab closes the Browser panel and returns to chat, without closing TideCode. It does not create a replacement tab. Reopening Browser starts a fresh new tab while preserving recently visited websites.

Users can edit the address while the current page loads. Background load completion and metadata updates must preserve their text and keyboard focus. Page setup does not simulate user interaction, and address editing does not use repeated focus restoration or remove the page from keyboard navigation.

Clicking the webpage transfers focus normally. DevTools initialize when opened through the toolbar or keyboard shortcut; choosing a dock position alone does not open them. The first opening therefore includes DevTools initialization.

The Browser control is available only in the desktop Electron app. Remote web clients do not show or open the Browser surface, and there is no remote page virtualization or screencast interaction path.

## Chat mentions

Chat mentions keep compact labels in the composer and rendered messages while resolving to their canonical paths on hover. Path-backed image attachments show only an image preview on hover. Non-image mentions remain path-only. Image previews use the attachment data already held by the chat model rather than reading from the workspace or hard-coding filename extensions.

## Chat attachments

Attaching a file, folder, or image inserts a compact mention directly into the composer instead of adding a separate attachment-pill row. Attachment mentions participate in normal mention editing, queued-message editing, and message history. Image mentions show their preview on hover with even padding around the preview.

The attachment picker and drag/drop flow accept workspace items and external files without placing copies into the user's workspace. Stored attachments remain scoped to the draft or conversation, and removing the corresponding mention removes the attachment from the message state. Folder attachments omit ignored workspace content and symbolic links.

Remote browser paste, file selection, and drag/drop persist arbitrary browser files through the desktop host instead of limiting attachments to browser-readable text and images. PDFs and other binary files therefore behave like desktop file attachments. Browser-exposed directory drops or clipboard entries are uploaded as one folder attachment with their nested relative paths. When the browser does not expose pasted folder contents, the composer reports that limitation explicitly instead of labeling the folder as an unsupported file type.

## Remote project folder picker

The sidebar Add Folder action keeps the native operating-system folder dialog on desktop. In remote web, it opens a TideCode-rendered Explorer-style dialog for the desktop host filesystem. The dialog provides quick locations and drives, breadcrumb navigation, back/forward/up controls, directory search, explicit refresh, and context-menu folder actions using the same visual treatment as the workspace explorer. Folder context actions include new folder, paste, delete, rename, cut, copy, copy path, and copy relative path; the main workspace explorer context menu also exposes Refresh. Quick-access navigation avoids reloading when the requested location is already open. The bottom Folder field shows only the selected folder name, remains editable, and offers typo-tolerant suggestions from the current directory only. Windows system folders are suppressed while ordinary user-hidden folders remain visible. Narrow remote viewports use the same picker full-screen rather than opening a second mobile-specific implementation.
