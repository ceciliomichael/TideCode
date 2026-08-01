# TideCode

**A calmer, more efficient way to build with AI.**

TideCode is a desktop AI workspace for getting real software work done without constantly switching between a chat window, an editor, a terminal, and Git. Bring a project into one focused workspace, choose the model and tools that fit the task, and move from intent to a reviewed change with less friction.

## What TideCode is about

TideCode is built around one idea: efficiency should feel like clarity, not speed for its own sake.

The workspace keeps the conversation, project files, terminal, planning board, and source control close together. That makes it easier to understand the work, make deliberate changes, and keep momentum when a task grows beyond a single prompt.

## What you can do

### Work with an AI that can follow the project

- Start focused conversations for each project or workstream.
- Use Agent mode for implementation work and Plan mode for thinking through a change before editing.
- Let the assistant inspect files, apply changes, search the workspace, and use project tools.
- Attach files, mention workspace paths, edit or revert messages, and queue follow-up work while a turn is in progress.
- Continue longer sessions with context usage indicators and conversation compaction.

### Keep the whole workspace in view

- Browse project files in an integrated explorer.
- Edit source files with search, replace, syntax highlighting, and Markdown or diagram previews where supported.
- Open a terminal beside the conversation and choose the execution mode that fits the task.
- Review proposed changes in a focused diff view before they move forward.

### Plan work that stays understandable

- Turn ideas into tasks on a Kanban board.
- Organize subtasks, descriptions, labels, assignees, and acceptance criteria.
- Use the assistant to help turn a task into a reviewable plan, then implement it from the conversation when you are ready.

### Keep Git work close to the change

- Inspect branches, status, diffs, commits, and history.
- Stage and unstage files, discard changes when needed, and create commits with the work in context.
- Sync with a remote repository and publish a project to GitHub from the workspace.

### Choose the model setup that works for you

- Connect Codex through your ChatGPT account.
- Bring API-key providers such as OpenAI, Anthropic, Google, Mistral AI, and DeepSeek.
- Add custom model connections and choose different models for planning, agent work, summarization, and Git or pull-request flows.
- Connect MCP servers and control which tools are available.
- Add reusable skills and instruction packs for workflows you use often.

## Start using TideCode

1. Download the latest TideCode release for your platform from [GitHub Releases](https://github.com/ceciliomichael/TideCode/releases).
2. Open TideCode and choose the project folder you want to work in.
3. Connect a model provider from Settings, or sign in to Codex.
4. Start a conversation and describe the outcome you want.

TideCode is designed to work with the provider and credentials you choose. Review your provider's terms and data handling before sending sensitive project content to an external model service.

## Supported platforms

The release workflow produces installers for:

- Windows (x64)
- macOS
- Linux (AppImage, x64)

## Build from source

TideCode requires Node.js 20 or newer for local development.

```sh
npm ci
npm run dev
```

Before opening a change, run the project checks:

```sh
npm run typecheck
npm test
npm run build
```

## The TideCode approach

TideCode is intentionally opinionated about reducing context switching:

- Keep the goal visible.
- Make changes inspectable.
- Keep the human in control of consequential actions.
- Use the model and tools that fit the work.
- Leave the workspace clearer than you found it.

## Project status

TideCode 1.0.0 is the first public release of the TideCode product identity. The application is actively evolving, and feedback is welcome through the [GitHub repository](https://github.com/ceciliomichael/TideCode).
