# TideUI implementation

The current language, actions and examples are documented in [tideui.md](tideui.md). Module boundaries are documented in [ARCHITECTURE.md](../ARCHITECTURE.md), and presentation behavior in [DESIGN.md](../DESIGN.md).

- `tideui` renders native React components progressively as declaration lines complete, preserving existing component state and valid siblings.
- `tidehtml` renders HTML with independently optional inline CSS and JavaScript. Completed blocks execute automatically inside an isolated iframe.
- HTML height follows content. Wheel scrolling stays native; upward intent pauses chat following.
- Native controls and custom HTML support the restricted Draft, Send, Copy and Open action paths. Host actions require user interaction; HTML action requests also require response completion.
- Parsing, streaming, sandbox and action logic live in `src/lib/tideui/`; presentation lives in `src/components/tideui/`.
- Focused tests cover normalization, progressive rendering, action validation, actual Electron interactions, state retention, sizing and scrolling.
