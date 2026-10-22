# tools.terminal.execute.execute

Execute a real terminal command. Retain its `session_id` and continue through `tools.terminal.read` or `tools.terminal.interact` rather than restarting an active command.

Commands and their child processes are automatically terminated when the current chat turn ends, including completion, cancellation, or failure. Closing the desktop app also stops its AI-started commands. Finish any work that depends on a running command, including servers and background tasks, within the same turn. Do not expect a command or its session to remain available in a later turn.

## Writing source through terminal commands

Source created or modified by shell commands, scripts, or generators must meet the same readability requirements as direct file edits. Keep block bodies and nested structures in expanded multiline form with consistent indentation. Put distinct declarations, statements, and sibling structural elements on separate physical source lines, including every embedded language. A short shell command may write multiline content; the saved source itself must remain readable. Concise replies, output limits, and simpler implementations do not justify compressing source. Minify only when explicitly requested or preserving an existing generated/minified artifact.

Read back the affected source after execution, following continuation output when truncated, and correct packed sections introduced by the command before finishing. A successful command, valid syntax, or a working preview does not verify source readability. Use an existing project formatter when appropriate, or format the source yourself; do not add a formatting dependency solely for this purpose.
