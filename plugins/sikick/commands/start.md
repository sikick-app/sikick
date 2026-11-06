---
description: Link this Claude Code session to a SiKick card (no argument - pick from My day)
argument-hint: "[card key | number | words]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

The user wants to link this Claude Code session to a SiKick card. Argument: "$ARGUMENTS"

Their day right now:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" start --session "${CLAUDE_SESSION_ID}"`

- If the argument above is empty: show the day as a short numbered list (no {keys}) and ask which card. When they answer, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" start "<their pick>" --session "${CLAUDE_SESSION_ID}"` with the Bash tool, quoting the pick.
- If the argument is not empty: run that same command right away with the argument as the pick.
- Relay the result in one line. If it lists several matches, ask which one. Once linked, offer to fetch the card's context with the flow MCP tool `card_context` (session_id ${CLAUDE_SESSION_ID}).
