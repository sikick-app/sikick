# SiKick for Claude Code: what it sends, what it keeps

The plugin talks to one place only: **your SiKick address** (`https://www.sikick.si`, or what you set with `SIKICK_URL`
or the `sikick_url` option), over https with your token. Plain http is accepted only for a test server on your own
computer (`localhost`, `127.0.0.1`). With any other address the token is never sent. Without a token the plugin sends
nothing at all.

## Sent automatically (the hooks)

One small event per hook to `POST /app/api/claude/events`:

| Field | When |
|---|---|
| session id, event type, time (`client_at`, `sent_at`) | every event |
| folder (your home folder written as `~`) and its name | every event |
| how the session started / why it ended (`startup`, `resume`, `clear`, `logout`, …) | session start / end |
| the **length** of your prompt | each prompt |
| prompt **text** (first 4000 characters) | **only** if you turned on `send_prompts` |
| tool name; for file tools the changed file path (relative to the project; outside it only the file name) | each tool call |
| agent type | inside a subagent |

At session start, if suggestions are on (`suggest_cards`, default on):

- `GET /app/api/claude/today`: your day. Nothing about the folder, the branch or your prompt is sent with it.
- `GET /app/api/claude/status?session=<id>`: only when your last linked session in this folder ended with time not
  logged yet, to offer the wrap-up.

## Sent only when you act

| You | Sent |
|---|---|
| answer `y` to a suggestion, or `/sikick:start` | `POST /app/api/claude/link`: session id, card key and title, folder (`~/…`) and its name |
| `d` / `w <note>`, `/sikick:done`, `/sikick:wrap` | `POST /app/api/claude/done`: session id, card key, done or worked on, your note, minutes if you gave them, where it continues |
| pick follow-ups in `/sikick:wrap`, `/sikick:bug`, `new_card` | `POST /app/api/claude/new` or `/bug`: the title (and notes) you approved |
| `progress` (the coach, now and then) | one plain line about the work |
| `/sikick:pause` | the pause flag |
| approve your persona | the profile you approved, nothing else (`/sikick:persona delete` removes it) |
| use the `sikick` account MCP | what that tool call asks for, with your MCP key or OAuth |

## Never sent

Bash commands, tool output, file contents, diffs, transcripts, your git branch name, the TODO / FIXME scan, the words
used to match a card (folder, branch, prompt): those are compared with your card titles on your computer only.

## Kept on your computer (`~/.sikick`, private to you)

`token` (mode 600) and `token.meta.json` (which address it was saved for) · `config.json` / `options.json` (address,
switches) · `sessions/` (per session: paused, linked card, an open suggestion) · `current.json` (the last session per
folder) · `links.json` (which card you linked in which folder / branch, for better suggestions) · `pending.json` (a
linked session that ended with time not logged) · `queue.jsonl` (events waiting while SiKick can't be reached: at most
2000, 7 days, only for the address they were made for) · `auth.json` (a token SiKick rejected) · `persona.draft.json`.
Delete the folder to forget all of it.

## Kept by SiKick

The events per day, one row per session (linked card, paused, minutes per card per day, minutes already logged), and
the persona you approved. On a card: the work log, the comment with your note, the worked-on record on My day. Tokens
are stored as a hash only. Make a new token on `/app/claude` to replace one. SiKick's privacy policy:
<https://www.sikick.si/privacy>.
