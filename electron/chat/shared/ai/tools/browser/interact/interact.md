# tools.browser.interact

Act only in **AI-owned** tabs. User-owned browser tabs can be read but cannot be clicked, typed into, scrolled, dragged, navigated, reloaded or otherwise changed by AI browser tools. Use browser.tabs to determine ownership before acting. Chromium receives CDP input, not the Windows system pointer.

Pointing actions `click`, `hover`, `double_click`, and `drag` accept an element_ref, or viewport x/y coordinates plus the latest observation_id. Drag also needs to_x/to_y. The AI can fill a labeled field using element_ref and text, type in a focused field, press a key, scroll. Use browser.navigate for navigation, history, reloading and stopping loads. Coordinate positions refer to the AI Chromium viewport, not the scaled TideCode preview.

Batch 1–32 input/read/wait operations with `steps`. Direct navigation actions are not accepted in sequences. Additional `wait`, `wait_for` and `read` steps permit inspection during brief animations. Waits total at most five seconds. Successful tool output contains structured plain-text action reports including resolved coordinates and targeting methods; sequences include completed steps and failure details. Input values are not echoed: text length is reported instead. A dispatched click is not proof that the application completed the intended operation. Never blindly replay failed clicks or submissions.

The preview receives cursor positions live while the browser action executes. A short CSS animation follows movement without blocking input or delaying the AI's result. CSS cursor state is observed from the page and rendered with safe visual fallbacks. Example: `await tools.browser.interact({tab_id:"id",action:"click",x:640,y:360,observation_id:"latest-id"})`.
