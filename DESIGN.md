# Design

## Browser interaction

Browser startup, new tabs, and Home show a local TideCode page with a search/URL field. The address starts empty and receives focus when the new tab becomes active. Searches from either field use Google; URLs open directly. Empty submissions do nothing. The idle view has no loading indicator or page DevTools, and Reload is disabled until navigation. Home starts a fresh page session and resets navigation history.

The text-only `tidecode-word.svg` serves as a large new-tab heading, using the theme-aware brand color without the symbol or a square background. It scales down to fit narrow panels and sits close above the search field. The group sits above the panel's vertical midpoint, with twice as much remaining space below as above. The center search field is compact, uses a neutral “Search” hint, rounder corners, and no focus outline or changing border. Enter submits the field; there is no arrow button. Search-provider branding and explanatory hints are omitted. Up to six recently visited websites appear below it, most recent first, saved locally per project. Shortcuts show the website's favicon captured during browsing, cached locally across restarts; missing or failed icons use the site's initial. Opening a new tab never performs favicon lookups. Existing visits acquire icons when revisited. Shortcuts open the site's home origin rather than a previously visited private path or query.

Closing the last Browser tab closes the Browser panel and returns to chat, without closing TideCode. It does not create a replacement tab. Reopening Browser starts a fresh new tab while preserving recently visited websites.

Users can edit the address while the current page loads. Background load completion and metadata updates must preserve their text and keyboard focus. Page setup does not simulate user interaction, and address editing does not use repeated focus restoration or remove the page from keyboard navigation.

Clicking the webpage transfers focus normally. DevTools initialize when opened through the toolbar or keyboard shortcut; choosing a dock position alone does not open them. The first opening therefore includes DevTools initialization.
