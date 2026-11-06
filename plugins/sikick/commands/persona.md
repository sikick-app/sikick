---
description: Build or show your SiKick persona (built locally from your Claude Code history; you approve before anything is uploaded)
argument-hint: "[show | delete]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" persona show)
---

Arguments: "$ARGUMENTS"

- If the argument is "show": run `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" persona show` with the Bash tool and show the result.
- If the argument is "delete": run `node "${CLAUDE_PLUGIN_ROOT}/scripts/sikick.mjs" persona delete` with the Bash tool (Claude Code asks the user first) and show the result.
- Otherwise use the `sikick:build-persona` skill and follow it step by step. Nothing is uploaded until the user approves the profile.
