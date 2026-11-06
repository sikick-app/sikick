---
description: Show your SiKick day (My day) - card blocks, what's next, what didn't fit
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" today --session "${CLAUDE_SESSION_ID}"`

Show the user their SiKick day above as a short list (time, title, project). Leave out the {card keys} unless they ask. End with the "Next" card and say `/sikick:start` links this session to a card.
