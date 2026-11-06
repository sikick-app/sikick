---
description: SiKick status - connection, this session's linked card, worked minutes, pause state
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" status --session "${CLAUDE_SESSION_ID}"`

Relay the SiKick status above to the user in two or three short lines. If it says SiKick isn't connected, show the steps it gives.
