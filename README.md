# SiKick for Claude Code (plugin + marketplace)

This repository is a one-plugin Claude Code marketplace. The plugin is in [`plugins/sikick`](plugins/sikick); its
README is the user-facing description (also what the plugin directory shows), [PRIVACY.md](plugins/sikick/PRIVACY.md)
lists every field it sends. Changes: [CHANGELOG.md](CHANGELOG.md).

## Install (from this repository)

```
/plugin marketplace add sikick-app/sikick
/plugin install sikick@sikick
```

Restart Claude Code (or `/reload-plugins`). Update later with `/plugin marketplace update sikick`. Then connect it:
open `https://www.sikick.si/app/claude`, press **Make a token**, run the line it shows, and check with `/sikick:status`.

## Layout

```
.claude-plugin/marketplace.json     the marketplace (one plugin: sikick)
plugins/sikick/
  .claude-plugin/plugin.json        manifest + options (sikick_url, mcp_url, suggest_cards, send_prompts)
  README.md  PRIVACY.md  LICENSE     the listing, the data list, MIT
  assets/                            the README image (rendered by test/render-listing.mjs from a real e2e run)
  hooks/hooks.json                   events (async) + offer (SessionStart) + gate (UserPromptSubmit) -> scripts/hook.mjs
  commands/*.md                      /sikick:start, wrap, done, today, next, bug, pause, status, persona
  skills/sikick-coach/               the coach (progress lines, parallel agents, wrap-up)
  skills/build-persona/              local persona builder (scan.mjs) + schema; uploads only what you approve
  .mcp.json                          sikick (account MCP, http) + flow (mcp/server.mjs, stdio, no dependencies)
  scripts/lib.mjs                    address checks, token, local state, the offline queue, calls
  scripts/match.mjs                  the local card matching, one-key answers, TODO scan
  scripts/sikick.mjs                 the CLI behind the commands
test/                                node:test unit + hook tests, e2e against a local data copy, listing render
```

## Develop and test

Node 18+ only; nothing to install.

```bash
npm test                 # unit + hooks/CLI against a fake SiKick (node:test, ~3 s)
npm run validate         # claude plugin validate --strict (plugin + marketplace)
npm run test:e2e         # against a real SiKick on a throwaway copy of test data (free ports); needs the SiKick
                         # server source, which is not in this repository: SIKICK_SITE_DIR=<its folder>
node test/e2e-local.mjs --shots <dir> && node test/render-listing.mjs <dir>   # + My day shots, the README image
                         # (these two need SIKICK_E2E_PLAYWRIGHT=<playwright-core> and SIKICK_E2E_CHROME=<chrome binary>)
```

The e2e never touches live; it prints no email address or token.

Try the plugin from this folder without installing it, against a local SiKick, with its own state folder:

```bash
export SIKICK_URL=http://localhost:3000 SIKICK_HOME=$(mktemp -d)
node plugins/sikick/scripts/sikick.mjs token sct_…     # from http://localhost:3000/app/claude
claude --plugin-dir ./plugins/sikick
```

## License

MIT
