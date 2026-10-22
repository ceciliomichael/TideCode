# tools.write

Create or replace one complete file. Supply the exact destination path and entire content. For targeted replacements in an existing file, use `tools.edit`; use `tools.patch` for complex contextual edits.

Source must be easy for a human to read, understand, and edit. Follow project conventions, use consistent indentation, expand blocks across lines, and separate distinct statements and structural elements. Apply this to embedded languages too. Do not pack source onto single lines to save space.

For literal multiline content, put the exact text in outer `exec.payloads` and pass its payload reference as `content`. Preserve newlines, indentation, quotes, backticks, backslashes, and interpolation expressions as data. Do not nest file source in an executable template string. After a wrapper parse error, move the source into a payload before retrying.

Read back the saved file and verify its content and human readability. Correct compressed sections before reporting completion.
