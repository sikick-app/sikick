# Changelog

## 0.3.0 (2026-11-06)

- **Sessions turn into SiKick work.** At session start the plugin suggests the card on My day that fits the folder, the
  git branch and the cards you linked there before (matched on your computer); `y` links it. If your first message is
  a task, its words can point at a better card (still matched locally). On a resumed session only `sk y` is taken.
- Linking a session counts its time so far today on the card too.
- **Worked on, not finished** (`/sikick:done --today`, `w <note>`, `mark_done` finish=false) now writes the same record
  as ↻ on My day: today keeps it as worked, the card continues on the next working day (or `--to plan|stay|YYYY-MM-DD`),
  and the note shows on it next time.
- **`/sikick:wrap`**: done / worked on with a one-line note, then follow-ups (TODO / FIXME lines the session added,
  open ends) into cards you pick. A linked session you just quit is offered at the next start in that folder
  (`d` · `w <note>` · `n`).
- **Robust:** events wait locally when SiKick is offline or the token was rejected and go out with the next one (placed
  at their own time); a rejected token is said once at session start and in `/sikick:status` (with a staging vs live
  address hint); https is required except for a local test server; status shows live / local / custom address.
- Privacy: the home folder is sent as `~`; the env vars `SIKICK_TOKEN` / `SIKICK_MCP_KEY` are gone (the token lives
  only in `~/.sikick/token`); new options `suggest_cards` and `mcp_url`. PRIVACY.md lists every field.
- Tests (`npm test`, `npm run test:e2e`), README in the plugin folder, LICENSE.

## 0.2.0

- `/sikick:persona delete`; persona upload is not pre-allowed (Claude Code asks first).

## 0.1.0

- First version: hooks, `/sikick:*` commands, the flow MCP, the coach and build-persona skills.
