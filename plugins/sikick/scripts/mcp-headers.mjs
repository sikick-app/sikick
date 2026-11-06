#!/usr/bin/env node
// headersHelper for SiKick's account MCP: prints {"Authorization":"Bearer skc_…"} from ~/.sikick/mcp_key (a key you made
// in SiKick: Me → Use my own Claude). With no key it prints {} and the MCP falls back to its OAuth sign-in.
import { mcpKey } from './lib.mjs';
const k = mcpKey();
process.stdout.write(JSON.stringify(/^skc_[\w-]{10,200}$/.test(k) ? { Authorization: `Bearer ${k}` } : {}));
