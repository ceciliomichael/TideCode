# Design

## Light and dark color system

Source Control retains the existing Commit split button, Staged/Unstaged sections, file rows, history graph, and accent palette. File status indicators use the established Git semantic colors; conflicted paths are identified explicitly. Destructive discard actions require user confirmation. When no changes are staged, quick and advanced commits use the same TideCode-styled confirmation dialog before staging all current changes; operation notices distinguish complete success, partial success (local commit followed by failed remote action), and errors without clearing an unsuccessful commit message.

Advanced commit opens as a modal over the existing Source Control panel without closing it. Its remote-only choices remain disabled when no remote is configured; completing a local commit without finishing a remote push/PR step is clearly labeled as partial success. The composer branch selector keeps its popup open after a failed checkout so the Git error is visible, and closes after successful checkout. Creation and checkout preserve local changes on failure; no auto-pull is triggered by a branch switch.

TideCode uses one semantic color hierarchy for all app-owned UI. Light mode starts from a light canvas and distinguishes controls and nested surfaces with progressively darker muted, hover, and pressed surfaces. Dark mode mirrors that relationship from the existing near-black canvas: panels, fields, raised menus, hover states, and pressed states become progressively lighter so controls remain visibly separated instead of blending into the black base.

`src/index.css` owns the renderer palette. Components should use semantic roles such as `background`, `surface`, `surface-muted`, `surface-raised`, `surface-hover`, `foreground`, `muted-foreground`, `border`, `action`, `brand-soft`, and the success/warning/danger/info families rather than local light/dark color pairs. Primary actions use `action` with `action-foreground`; soft brand selections use `brand-soft` with `brand-soft-foreground`. Git additions, removals, modifications, and renames use their semantic Git roles consistently across chat, Explorer, commits, and Source Control.

Settings follows the same hierarchy even when a page owns its controls directly rather than using a shared component. Dialog backdrops use the shared overlay role, fields use muted surfaces, popup/raised content uses raised surfaces, and selected navigation/cards use the shared brand-soft treatment. Semantic status colors remain distinct from selected-state colors.

Primary actions and checked switches use the same soft green selected surface as active conversation-history and Settings navigation items, not the neutral sidebar background: `#d9e9e6` in light mode and `#223630` in dark mode. Primary action text and checked switch thumbs use dark green (`#315f59`) in light mode and white (`#ffffff`) in dark mode; selected history-item labels retain the softer brand-soft foreground. Hover surfaces follow `accent-hover`, and light-mode primary controls use the same subtle active-item border as selections. Unchecked switches remain neutral and distinct.

Only light mode draws an accent outline around soft-green selected items and actions. In dark mode, the active-item border and brand border resolve to transparent so the green surface itself defines the selected state without a visible rim. This applies to conversation history, Settings navigation, primary buttons, checked switches, active account cards/badges, and selected options. Preserve layout-sized transparent borders and ordinary structural, input, focus, and error borders. The Source Control Commit split action retains exactly one divider between its actions in both themes, even though its outer outline blends away in dark mode.

Literal colors remain appropriate where the color is part of the content or another established visual language: user images, PDF/DOCX paper, actual websites, file-type icons, syntax highlighting, terminal ANSI colors, Git graph lane colors, and third-party brand marks. These exceptions must still remain readable against both TideCode themes.

## Browser interaction

Browser startup, new tabs, and Home show a local TideCode page with a search/URL field. The address starts empty and receives focus when the new tab becomes active. Searches from either field use Google; URLs open directly. Empty submissions do nothing. The idle view has no loading indicator or page DevTools, and Reload is disabled until navigation. Home starts a fresh page session and resets navigation history.

The text-only `tidecode-word.svg` serves as a large new-tab heading, using the theme-aware brand color without the symbol or a square background. It scales down to fit narrow panels and sits close above the search field. The group sits above the panel's vertical midpoint, with twice as much remaining space below as above. The center search field is compact, uses a neutral “Search” hint, rounder corners, and no focus outline or changing border. Enter submits the field; there is no arrow button. Search-provider branding and explanatory hints are omitted. Up to six recently visited websites appear below it, most recent first, saved locally per project. Shortcuts show the website's favicon captured during browsing, cached locally across restarts; missing or failed icons use the site's initial. Opening a new tab never performs favicon lookups. Existing visits acquire icons when revisited. Shortcuts open the site's home origin rather than a previously visited private path or query.

Closing the last Browser tab closes the Browser panel and returns to chat, without closing TideCode. It does not create a replacement tab. Reopening Browser starts a fresh new tab while preserving recently visited websites.

Browser page state is preserved for the two most recently active projects. Opening Browser in a third project evicts the least-recent inactive project session and releases its guest pages; that project's saved recent websites remain available when Browser is opened again.

Users can edit the address while the current page loads. Background load completion and metadata updates must preserve their text and keyboard focus. Page setup does not simulate user interaction, and address editing does not use repeated focus restoration or remove the page from keyboard navigation.

Clicking the webpage transfers focus normally. DevTools initialize when opened through the toolbar or keyboard shortcut; choosing a dock position alone does not open them. The first opening therefore includes DevTools initialization.

Closing DevTools releases its native view. Opening it again initializes a fresh view; changing dock position preserves the transition behavior.

The Browser control is available only in the desktop Electron app. Remote web clients do not show or open the Browser surface, and there is no remote page virtualization or screencast interaction path.

## Resource retention and previews

The selected chat and ongoing background runs stay available. Three recent inactive transcripts may be reused within a memory budget; other chats reload from saved history when selected. Retention never deletes conversations or their attachments.

Compaction markers load with the opened conversation. Starting on an empty draft does not load markers for saved chats; switching chats loads that chat's markers, and completed compactions refresh the visible markers.

PDF previews preserve page positions, page count, scrolling, panning, and zoom while rendering pages near the viewport. Offscreen pages keep their layout and recreate their canvas when approached. Very large pages or high zoom levels use a capped raster resolution while retaining their displayed dimensions.

## Chat mentions

Chat mentions keep compact labels in the composer and rendered messages while resolving to their canonical paths on hover. Path-backed image attachments show only an image preview on hover. Non-image mentions remain path-only. Image previews use the attachment data already held by the chat model rather than reading from the workspace or hard-coding filename extensions.

## Chat attachments

Attaching a file, folder, or image inserts a compact mention directly into the composer instead of adding a separate attachment-pill row. Attachment mentions participate in normal mention editing, queued-message editing, and message history. Image mentions show their preview on hover with even padding around the preview.

The attachment picker and drag/drop flow accept workspace items and external files without placing copies into the user's workspace. Stored attachments remain scoped to the draft or conversation, and removing the corresponding mention removes the attachment from the message state. Folder attachments omit ignored workspace content and symbolic links.

Remote browser paste, file selection, and drag/drop persist arbitrary browser files through the desktop host instead of limiting attachments to browser-readable text and images. PDFs and other binary files therefore behave like desktop file attachments. Browser-exposed directory drops or clipboard entries are uploaded as one folder attachment with their nested relative paths. When the browser does not expose pasted folder contents, the composer reports that limitation explicitly instead of labeling the folder as an unsupported file type.

## Remote project folder picker

The sidebar Add Folder action keeps the native operating-system folder dialog on desktop. In remote web, it opens a TideCode-rendered Explorer-style dialog for the desktop host filesystem. The dialog provides quick locations and drives, breadcrumb navigation, back/forward/up controls, directory search, explicit refresh, and context-menu folder actions using the same visual treatment as the workspace explorer. Folder context actions include new folder, paste, delete, rename, cut, copy, copy path, and copy relative path; the main workspace explorer context menu also exposes Refresh. Quick-access navigation avoids reloading when the requested location is already open. The bottom Folder field shows only the selected folder name, remains editable, and offers typo-tolerant suggestions from the current directory only. Windows system folders are suppressed while ordinary user-hidden folders remain visible. Narrow remote viewports use the same picker full-screen rather than opening a second mobile-specific implementation.

## Windows tray menu

The TideCode notification-area menu retains its custom colors, sizing, layout, and labels. Closing retains the original Git sequence: disable mouse input before setting opacity to zero rather than hiding or destroying the native window. The preloaded popup takes focus when opened so clicking elsewhere can dismiss it through focus loss without depending solely on the global mouse hook. One right-click opens the popup; a second right-click closes it and returns without reopening. Only the tray callback toggles on an icon click. Outside-click and focus-loss handlers ignore the icon's effective hit area, which includes the opening click plus a 10-pixel margin even when Windows reports an empty or incomplete tray rectangle. Other outside clicks, right-clicks inside the popup, Escape, and either menu action close the popup. Left-clicking the icon closes it and shows the main window.
