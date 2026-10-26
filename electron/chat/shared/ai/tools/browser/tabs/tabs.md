# tools.browser.tabs

List project browser tabs (up to ten per page), with IDs, titles, URLs, and explicit ownership labels: **AI-owned** or **User-owned**. AI-owned tabs can be read and controlled; user-owned tabs can be read only. They are always observed at the user's current resolution. Example: `await tools.browser.tabs({page:1})`. Continue when has_more is true. Incognito tabs are not listed.
