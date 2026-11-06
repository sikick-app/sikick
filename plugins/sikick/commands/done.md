---
description: Mark the linked SiKick card done, with worked minutes and an optional note (--today = worked on, not finished; it continues next working day)
argument-hint: "[--today] [note]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

The user says the SiKick card linked to this session is done. Arguments: "$ARGUMENTS"

Run with the Bash tool: `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" done --session "${CLAUDE_SESSION_ID}" -- <note>`
- Put `--today` before `--` if the arguments start with "--today", "today" or "worked" (worked on, not finished: the same record as ↻ on My day; the card continues on the next working day); drop that word from the note. If they say where it continues, add `--to plan`, `--to stay` (stays on today) or `--to YYYY-MM-DD`.
- The note is the rest of the arguments, single-quoted for the shell. With no note, write a one-line note yourself from what was done in this session and show it to the user first.
- Minutes come from the session automatically; add `--minutes N` only if the user gave a number.

Relay the result in one line. For a fuller wrap-up (follow-up cards too) there is `/sikick:wrap`.
