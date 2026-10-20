# tools.write

Create or replace one complete file. Supply the exact destination path and entire content. For smaller targeted edits, use `tools.patch`. When supplying literal multiline file contents, put the exact text in outer `exec.payloads` and pass its payload reference as `content`. Preserve embedded backticks, interpolation expressions, quotes, backslashes, newlines, and indentation as data; do not nest the file source in an executable template string.
