---
name: build-persona
description: Build the user's SiKick persona profile from their local Claude Code history (~/.claude/projects), show it for editing and approval, and only then upload the approved profile to SiKick. Use when the user runs /sikick:persona or asks to build, refresh or edit their SiKick persona.
allowed-tools: Bash(node "${CLAUDE_SKILL_DIR}/scan.mjs" *)
# sikick.mjs (the upload) is deliberately NOT pre-allowed: Claude Code asks the user before it runs = the approval gate
---

# Build the SiKick persona

The persona tells SiKick and the `sikick-coach` skill how this person works. Privacy rules, always:
- Transcripts are read **on this machine only**. Never upload, paste or summarise raw prompts into SiKick.
- Only the final profile in the fixed schema `sikick.persona/v1` (`${CLAUDE_SKILL_DIR}/persona.schema.json`) is uploaded, and **only after the user says yes**.
- No secrets, no email addresses, no other people's names or private details in the profile.

## Steps

1. **Scan locally.** Run `node "${CLAUDE_SKILL_DIR}/scan.mjs" --days 90`. It prints a digest: counts (sessions, active days, hours of day, tools, file types, projects) and a short masked sample of the user's own prompts. Read it; don't echo it back in full.
2. **Draft the profile.** Read `${CLAUDE_SKILL_DIR}/persona.schema.json` and fill every required field from the digest:
   - `summary`: 2-3 sentences, second person ("You work in short bursts…").
   - `working_style.peak_hours` from `hours_of_day`; `parallel_agents` from how often the Agent / Task tools appear.
   - `communication`: reply length, tone, languages and likes/dislikes as they show in the prompts (e.g. "keep replies short").
   - `tech` from file types and tools; `projects` = top projects with a few words each (no client secrets).
   - `coach`: sensible defaults (`nudge_style: "brief"`, `progress_every_min: 30`, `suggest_parallel_over_min: 20`) unless the prompts say otherwise.
   - `stats`: counts only. `updated`: today's date. `schema`: `"sikick.persona/v1"`.
   If a field is a guess, keep it but say so when you show it.
3. **Write the draft** to `~/.sikick/persona.draft.json` (create `~/.sikick` if needed).
4. **Show it and ask.** Show the profile as a short readable list (not raw JSON unless asked), say which fields are guesses, and ask: "Edit anything, or upload this to SiKick?" Apply every edit to the draft file and show the changed fields again.
5. **Upload only on a clear yes:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" persona upload ~/.sikick/persona.draft.json`. Relay the result. If the user says no, leave the draft where it is and say so.
6. **Taking it back:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" persona delete` removes the uploaded profile from SiKick (also `/sikick:persona delete`, or Delete all on the Your persona page).
