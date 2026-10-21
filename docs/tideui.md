# TideUI language and rendering contract

TideUI is TideCode's first-party, AI-generated interface language. It uses existing chat text transport and native React components, with no OpenUI dependency.

## When to use

Choose the presentation that makes the answer easiest to understand and use, respecting the user's requested format. Prefer native TideUI for structured comparisons, meaningful options, timelines, metrics, progress, and useful interactions without requiring an explicit visual request. Use Markdown for explanations, code, commands, and short answers. Mix prose and UI naturally without presenting the same information twice, and keep interfaces proportional to the answer rather than adding decorative dashboards or controls to routine replies.

Prefer native components for supported presentations. Use custom HTML when its layout or local interaction capabilities materially improve the response beyond native components. Controls must have working, supported behavior, and follow-up buttons must clearly describe the intended action. Use supported facts and evidence; never invent chart values, completion states, or capabilities. The native grammar is deterministic and contains no JavaScript or arbitrary HTML.

## Syntax

Inside a fenced `tideui` Markdown block:

- Each line is `component "label" [arguments] [key=value ...]`.
- Indentation uses **two spaces per level**, with maximum nesting depth 12.
- Quote strings containing spaces; use `\"` and `\\` to escape quotes and slashes.
- Attributes are written `key=value` or `key="text with spaces"`.
- Start a raw-text continuation line with `|`, indented one level under its parent.
- Component and property names are case-sensitive. Unknown presentation components become escaped text and retain their children. Entry-like declarations take their meaning from the parent: chart/sparkline entries are points, timeline entries are events, table entries are rows, list/comparison entries are items, select entries are options, and tabs entries are tabs. Standalone items render as text entries. Unsafe/invalid behavioral declarations are excluded without discarding valid siblings, including after streaming completes. Unrecognized optional properties are ignored.
- Optional-property diagnostics are internal and not displayed in the chat UI. For checkbox and toggle defaults, use `checked=true` or `checked=false` (or `default=true` and `default=false`).
- Inputs and textareas support `placeholder="Short example"` for in-field hint text and `hint="Persistent guidance"` for helper text below the control. Selects also support `hint`.
- `tone` is a semantic status attribute. Use `badge "Ready" tone=positive`, `badge "Caution" tone=warning`, or `badge "Error" tone=danger`. Positional values such as `badge "Ready" success` remain supported. The renderer maps tones to TideCode's existing theme colors.
- Maximum 250 nodes and 40 KB per native block.
- `id` is a unique, simple identifier used for action targets.
- Explicit native styling attributes override TideCode defaults property by property. Supported properties: `background`, `color`, `border-color`, `radius`, `padding`, `gap`, `font-size`, `hover-background`, `hover-color`, and `hover-border-color`. Omit them to inherit TideCode styles. Colors must be valid literals; arbitrary CSS/URLs are not allowed.
- Native modals use `modal "Title" id=details size=md` with normal nested TideUI nodes. Open via `button "Details" action=modal.open target=details`, close via `button "Close" action=modal.close`. Available sizes: sm/md/lg/xl/full. The modal is a host-managed accessible overlay. Custom HTML can implement sandboxed HTML/CSS/JavaScript modals within its iframe. `action=modal.confirm` records only a local confirmation and closes the modal; it does not save files, submit externally, or claim a host-side action occurred.
- A native modal may embed custom HTML/CSS/JavaScript through an `html` child with indented raw `| <div>...</div>` lines. Custom markup runs in an isolated iframe, not the TideCode host DOM.
- All literal strings are rendered as text, not executed as expressions.

### Example: dashboard with follow-up actions

```tideui
panel "Repository overview"
  heading "This week"
  grid 3
    metric "Commits" 142
    metric "Files changed" 38
    metric "Tests passed" 128
  chart line "Daily activity"
    point "Mon" 10
    point "Tue" 15
    point "Wed" 22
  progress "Coverage" 92%
  badge "On track" tone=positive
  button "Investigate regressions" action=send message="Check recent regressions and report actionable findings."
  button "Copy summary" action=copy value="128 tests passed"
```

### Example: tabs, forms, copy and toggled content

```tideui
panel "Tools"
  input "Search term" id=search placeholder="Filter"
  select "Priority" id=priority default=medium
    option low "Low"
    option medium "Medium"
    option high "High"
  checkbox "Include tests" id=tests default=true
  slider "Limit" id=limit min=1 max=100 default=20
  tabs "View" id=views
    tab "Summary"
      text "Overview"
    tab "Details"
      text "Detailed findings"
  code id=install lang=bash
    | npm install
  button "Copy command" action=copy target=install
  button "Show notes" action=toggle target=notes
  section "Notes" id=notes mode=hidden
    text "Extra information"
  button "Copy config" action=copy target=search
  button "Reset controls" action=reset
```

## Native components

| Category | Components |
| --- | --- |
| Layout | `panel`, `card`, `row`, `column`, `grid`, `section`, `divider` |
| Content | `heading`, `text`, `label`, `caption`, `code`, `image`, `gallery` |
| Status | `badge` (success/warning/danger/info), `alert`, `progress`, `metric` |
| Data | `table` with `row` children; `list` and `comparison` with `item "Entry" "Optional detail"` children |
| Charts | `chart line/bar/bars/pie` or `sparkline` with `point "label" number` or `point "label" value=number` children; numbers must be finite and nonempty |
| Diagrams | `timeline` with textual event entries (`event`, `row`, `point`, or `item`); `flow` with `node` and `edge` |
| Inputs | `input`, `textarea`, `select` with `option`, `checkbox`, `toggle`, `slider`; select uses TideCode's shared `DropdownField` |
| Interactive | `button`, `copy`, `tabs` with `tab`, `expand`, `link` |
| Time | `timer` with a required `id` and a 1–240 minute `duration` |

Tables can be sorted by clicking the header. Larger tables have a text filter. Multiple components can be nested and combined.

## Actions

Buttons may have `action=copy|draft|send|open|toggle|select|filter|sort|reset|timer.start|timer.pause|timer.resume|timer.reset|timer.end`.

- `copy`: `value="literal"` or `target=existingComponentId`. Code blocks automatically show Copy controls.
- `draft`: `message="..."` appends text to the existing unsent chat draft. Does not automatically send.
- `send`: `message="..."` immediately sends that text as a normal user turn **after a user click**. Existing unsent composer text is not cleared. An active AI run uses the existing queue; the active conversation must match the one owning the button.
- `open`: `url=https://example.com` opens a validated HTTP(S) URL.
- `toggle`: `target=detailsId` toggles a component marked `id=detailsId mode=hidden`.
- `select`, `sort`, `filter`: `target=componentId value="..."` adjust local control state. Tables also expose native sorting/filtering controls.
- `reset`: resets local TideUI control values to defaults.
- `timer.*`: requires `target=timerId`. Native timers also include built-in lifecycle controls, including 25, 50, 90, and custom-minute duration selection. Each timer uses a deadline-based clock and ticks once per second while the chat view stays mounted. It remains accurate after background throttling when updated, but does not survive reloads or issue OS notifications. Incorrect-state actions are disabled with explanations.

## Visual interactions and scroll stability

Cards and metrics may specify `hover=highlight`, `hover=lift`, `hover=glow`, or `hover=none`. Effects use TideCode theme tokens, match keyboard focus, and respect reduced-motion preferences. Unspecified hover effects are not applied. Charts may specify `interactive=true` to enable selecting data points via pointer or keyboard; points support inspection with the app-owned `Tooltip.tsx` presentation and a persistent inline data summary for touch/mobile. Select inputs reuse the existing `DropdownField`, and copy/action controls use the shared tooltip.

When assistant output streams, the chat follower keys its layout effect to the actual latest content length and pins followed conversations to the current bottom before the browser paints the new frame. Observer-driven scrolling is only a backup for asynchronous layout changes. Programmatic scroll events do not disable following; explicit upward wheel/touch/scrollbar/keyboard intent does. The user can still scroll upward to pause following, and the follower resumes when the user returns to the bottom. Components are not animated while still being generated.

### Native focus timer example

```tideui
panel "Focus session" hover=highlight
  timer "Deep work" id=focus duration=50
  button "Pause" action=timer.pause target=focus
  button "Resume" action=timer.resume target=focus
  button "Reset" action=timer.reset target=focus
```

These buttons reflect the actual timer state. An unsupported button action renders disabled with an explanation, rather than executing arbitrary AI-authored JavaScript.

All actions are local UI events except the existing chat-send path. No TideUI button can execute a privileged TideCode tool, terminal command, or file modification by itself.

## Custom HTML

Use one fenced `tidehtml` format. HTML is the content; inline CSS and JavaScript are independently optional. HTML only, HTML/CSS, HTML/JavaScript, and HTML/CSS/JavaScript all use the same renderer. Completed blocks mount and run scripts immediately, including saved blocks reopened from history. Incomplete blocks wait for their actual closing fence.

HTML appears directly in chat with a transparent, borderless background and no outer card, viewer title, toolbar, manual resize handle or Expand control. It uses the available chat width and its actual content height, without a fixed height or cap; content changes grow and shrink the embed. Scrolling upward over HTML pauses chat autoscroll. Wheel input is observed passively: native browser scrolling, momentum and scroll chaining handle both inner elements and chat. The bridge never cancels wheel events or manually applies wheel movement. The sandboxed iframe remains isolated from the application. Streaming subsequent chat text does not reload it.

Use optional inline JavaScript for working local interactions rather than drawing inert controls. Supply self-contained inline CSS and JavaScript only as needed; browser DOM, canvas and local state are available. External libraries/CDNs, module imports from the network and network requests are blocked. Use responsive full-width layouts and natural document scrolling rather than adding another fixed-height scrolling wrapper.

```tidehtml
<style>body{padding:24px}button{padding:10px 16px}</style>
<button id="counter">Count: 0</button>
<script>
  let count = 0;
  document.getElementById('counter').addEventListener('click', (event) => {
    count += 1;
    event.currentTarget.textContent = `Count: ${count}`;
  });
</script>
```

The renderer uses opaque-origin iframe sandboxing, no TideCode preload or Node access, a restrictive document Content Security Policy, and a 60 KB source-size limit. `sandbox=allow-scripts` permits inline JavaScript without `allow-same-origin`, `allow-forms`, `allow-popups`, or `allow-top-navigation`. CSP blocks network requests, external scripts, frames and workers. The host accepts sizing/wheel messages only from its iframe window and opaque origin with the matching per-document token. Users should not place secrets in generated HTML. Application actions are available only through the restricted bridge described below.

### Shared designs and native widgets inside HTML

Custom HTML can opt into the existing TideUI designs through shared classes and semantic theme variables. For example, `tideui-card`, `tideui-button`, `tideui-control`, `tideui-field`, `tideui-metric`, `tideui-badge`, `tideui-row`, `tideui-column` and `tideui-grid` use the same stylesheet as native chat UI. Colors, typography tokens and light/dark theme updates are mirrored into the iframe. The app's Latin UI font is supplied as an inline asset. Custom markup and CSS remain independent choices:

```tidehtml
<div class="tideui-root">
  <section class="tideui-card">
    <h3 class="tideui-title">Choose a follow-up</h3>
    <button class="tideui-button" data-tide-action="draft" data-tide-value="Review these results">Review results</button>
  </section>
</div>
```

Use a `tide-ui` element for actual native widgets. Its inert `text/tideui` script contains the existing declaration language. Custom HTML can surround the element and use its own styles and JavaScript:

```tidehtml
<header style="padding:16px">My custom dashboard</header>
<tide-ui id="report">
  <script type="text/tideui">
panel "Native widgets"
  chart bar "Activity" interactive=true
    point "Mon" 10
    point "Tue" 25
  select "Priority" id=priority default=low
    option low "Low"
    option high "High"
  timer "Focus session" id=focus duration=25
  button "Explain results" action=send message="Explain this dashboard"
  </script>
</tide-ui>
```

The native runtime loads only when a `tide-ui` element is present, and uses the existing React renderer. Native widget styles and their dropdown/tooltip portals stay inside a shadow root, while theme variables inherit from the document. Floating controls fit the portion of the iframe visible in chat. Native copy, draft, send and link actions use the same host action bridge; network and asset restrictions remain those of the HTML sandbox.

JavaScript can update `element.source` with declarations or create another `tide-ui` element and set its `.source`. For an existing element, wait for `customElements.whenDefined('tide-ui')` before assigning the property. The element emits `tideui:ready` after its first React commit. Source updates reconcile existing native components, retaining input values, chart selection and timer state where their identity remains the same. Theme changes and surrounding prose do not reload the iframe. Removing a widget unmounts its React tree; moving it synchronously preserves state. Shared styles do not require a native widget or generated JavaScript.

### TideCode actions from custom HTML

Custom HTML can request four application actions through the restricted bridge: `draft`, `send`, `copy`, and `open`. Draft fills the composer; Send submits a visible user message through the existing guarded send/queue path, retaining unsent composer text. Copy uses the host clipboard. Open requests an HTTP(S) link in the host; success acknowledges the request, not remote page loading. Values must contain 1–4000 characters, and URLs also satisfy the shared URL policy. Actions are unavailable until the response finishes streaming and require a genuine user click (including keyboard button activation).

Declarative buttons work with or without generated JavaScript:

```html
<button data-tide-action="draft" data-tide-value="Review this selection">Use selection</button>
<button data-tide-action="send" data-tide-value="Explain this chart">Explain chart</button>
```

The bridge disables a declarative control while pending, keeps its label unchanged, and displays errors only. Successful actions add no status text. A successfully submitted Send stays disabled to avoid duplicate submission. Other successful controls, and rejected controls, become usable again. The control emits `tidecode:action-result` with `{ ok, error? }` in `event.detail`.

`tidehtml` pages also expose `window.tidecode.draft(text)`, `.send(text)`, `.copy(text)`, and `.open(url)`. Each returns `Promise<{ ok: boolean; error?: string }>`. Call the method directly in the click handler, before awaiting any other work. One host action is allowed per click, and one may be pending at a time. Pages should keep their button labels unchanged, disable controls while pending, and display failures only:

```html
<button id="explain">Explain selection</button>
<span id="status" role="status"></span>
<script>
  document.getElementById('explain').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const result = await window.tidecode.send('Explain my selected chart results');
    document.getElementById('status').textContent = result.error || '';
    button.disabled = result.ok;
  });
</script>
```

Page-load code, timers and synthetic `.click()` calls cannot authorize host actions. A private action credential stays inside the bridge closure: its bootstrap removes itself before generated scripts run. The host checks the credential in addition to source/origin/token validation and rejects repeated or concurrent requests. No raw tools, terminal, filesystem, conversation history or application DOM are exposed. Remounting the page or changing its source starts a new document and resets its local state. Unrelated chat updates and response completion retain the current document.

## Transport and behavior

The AI emits ordinary response text with embedded fenced blocks. During generation, TideCode commits each complete declaration line, so labels, messages, placeholders, and attributes never render token-by-token. Panels and widgets fill progressively, including individual chart points and table rows, while retaining their existing component instances. Malformed declarations are isolated without discarding valid siblings or flashing an error panel. Chat-send and chat-draft actions remain inactive until the assistant response completes. The same component instance remains mounted when the closing fence arrives. Incomplete HTML previews remain inert. Conversation history retains the source Markdown rather than serialized React elements, so branch and replay reconstruct the same UI defaults. UI input values are ephemeral local state.

All components use TideCode theme CSS variables and flex/grid with narrow-width wrapping.

## Validation and verification

See `tests/tideuiParser.test.ts`, `tests/tideuiStreaming.test.ts`, `tests/tideuiRenderer.test.tsx`, `tests/tideuiActions.test.ts`, and `tests/tideuiHtmlIsolation.test.tsx`.
