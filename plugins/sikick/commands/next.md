---
description: The next card on your SiKick day
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" next --session "${CLAUDE_SESSION_ID}"`

Tell the user the next card in one line. Offer to link this session to it with `/sikick:start` and to pull its context (the flow MCP tool `card_context`).
