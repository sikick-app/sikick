---
description: File a bug in SiKick from this session (goes to the linked card's project, else your day)
argument-hint: "\"what is broken\""
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

The user wants to file a bug in SiKick: "$ARGUMENTS"

If that is empty, ask for one line. Otherwise run with the Bash tool: `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" bug --session "${CLAUDE_SESSION_ID}" -- '<the text>'` (single-quoted for the shell; you may tighten the wording, never invent details). Relay where it landed in one line.
