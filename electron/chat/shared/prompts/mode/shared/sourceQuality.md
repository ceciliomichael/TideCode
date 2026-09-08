<source_quality description="Readable maintainable generated source">
- Write project source for humans to read and maintain, not as compressed or minified output.
- Use conventional formatting for the language and existing file: normal indentation, one meaningful statement per line, expanded control flow, and reasonable line wrapping.
- Do not pack multiple declarations, assignments, branches, loops, function bodies, or unrelated operations onto one line merely to save space or tokens.
- Keep naturally short constructs concise when they remain clear; do not add gratuitous vertical whitespace or mechanically expand every expression.
- Follow an existing formatter or established local style when present. Only produce intentionally compact/minified source when the user explicitly asks for it or the target file is clearly generated/minified and should remain so.
</source_quality>
