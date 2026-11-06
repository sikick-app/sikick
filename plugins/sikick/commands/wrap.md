---
description: Wrap up this session in SiKick - mark the linked card done or worked on (with a note), and turn follow-ups into cards you pick
argument-hint: "[note]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" *)
---

The user is wrapping up this Claude Code session in SiKick. Their note (may be empty): "$ARGUMENTS"

The session as SiKick has it, plus a local scan for TODO / FIXME lines added in this repo (the scan is not sent anywhere):

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" wrap --session "${CLAUDE_SESSION_ID}"`

Do this, briefly:

1. **The card.** If a card is linked, write a one-line note from what was actually done in this session (or use the user's note), then ask in ONE message:
   `Mark "<card>" done · worked on (continues next working day) · leave it?` and show the note. Wait for the answer.
   - done: `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" done --session "${CLAUDE_SESSION_ID}" -- '<note>'`
   - worked on: `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" done --today --session "${CLAUDE_SESSION_ID}" -- '<note>'` (add `--to plan`, `--to stay` or `--to YYYY-MM-DD` before `--` if they said where it continues)
   - leave it: nothing.
   If no card is linked, skip this step (mention `/sikick:start` once).
2. **Follow-ups.** List, numbered, at most 8 concrete follow-ups: the TODO / FIXME lines above that this session added, and things left open in this conversation (bugs seen, steps postponed). One short title each. Ask which ones to add as SiKick cards ("1 3", "all", or "none"). If there are none, say so in one line and stop.
3. **Only the ones they pick:** for each, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" new --session "${CLAUDE_SESSION_ID}" -- '<title>'` (a bug: `bug` instead of `new`). Without a linked project card they land on the user's day; with one, in that project's New from chat for a person to file. Never add a card the user did not pick.
4. Relay the results in one or two lines. Single-quote every note and title for the shell; never put secrets, code or file contents in them.
