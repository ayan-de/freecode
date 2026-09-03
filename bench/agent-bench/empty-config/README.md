Deliberately empty.

`agents/opencode.json` points `XDG_CONFIG_HOME` here. Without it, opencode
loads `~/.config/opencode/opencode.json` and every MCP server in it — on the
machine this was written, that handed opencode nine tools freecode does not
have (contextcarry x7, figma x2) plus their descriptions in the system prompt.
Neither `--pure` nor `OPENCODE_CONFIG` suppresses them; only XDG_CONFIG_HOME
does.

Do not put a config here. The point is that there isn't one.
