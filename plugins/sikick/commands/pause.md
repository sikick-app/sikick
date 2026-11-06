---
description: Pause or resume SiKick tracking for this session (paused - nothing is sent, time stops)
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" pause --session "${CLAUDE_SESSION_ID}"`

Relay the result above in one line. (Running /sikick:pause again toggles it back.)
