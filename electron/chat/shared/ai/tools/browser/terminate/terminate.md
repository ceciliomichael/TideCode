# tools.browser.terminate

Close an **AI-owned** Chromium browser tab by tab_id. User-owned tabs cannot be closed by AI. Check ownership using browser.tabs. Example: `await tools.browser.terminate({tab_id:"id"})`. Status `closed` means the isolated window was destroyed.
