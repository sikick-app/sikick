#!/usr/bin/env node
// The README / listing image: the plugin's REAL lines from an e2e run (said.json) above the REAL My day row it produced
// (linked-desktop-*-row.png), both from test/e2e-local.mjs --shots <dir>. Nothing typed in by hand.
//   SIKICK_E2E_PLAYWRIGHT=<playwright-core> SIKICK_E2E_CHROME=<chrome binary> node test/render-listing.mjs <shots dir>   -> plugins/sikick/assets/claude-code-session-{dark,light}.png
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { PLUGIN } from './helpers.mjs';

const dir = process.argv[2]; if (!dir) { console.log('usage: node test/render-listing.mjs <shots dir>'); process.exit(1); }
const said = JSON.parse(readFileSync(join(dir, 'said.json'), 'utf8'));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SIKICK_E2E_PLAYWRIGHT);
const CHROME = process.env.SIKICK_E2E_CHROME;
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const out = join(PLUGIN, 'assets'); mkdirSync(out, { recursive: true });

const b = await chromium.launch({ executablePath: CHROME });
for (const mode of ['dark', 'light']) {
  const row = join(dir, `linked-desktop-${mode}-row.png`); if (!existsSync(row)) continue;
  const img = 'data:image/png;base64,' + readFileSync(row).toString('base64');
  const T = mode === 'dark' ? { bg: '#0f1012', panel: '#16181b', ln: '#2a2e33', fg: '#f3f5f8', mut: '#9aa1a9', ac: '#c6ff3d', you: '#f3f5f8' }
    : { bg: '#f4f3ee', panel: '#ffffff', ln: '#111111', fg: '#111111', mut: '#4a4a4a', ac: '#407402', you: '#111111' };
  const lines = said.map(([who, t]) => who === 'you' ? `<div class="l you"><span class="p">&gt;</span> ${esc(t)}</div>` : `<div class="l ${who}">${esc(t).replace(/^SiKick:/, '<b>SiKick:</b>')}</div>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:${T.bg};color:${T.fg};font:15px/1.5 Inter,system-ui,sans-serif;width:1280px;display:flex;flex-direction:column;gap:22px;padding:44px 56px}
  h1{margin:0;font-size:30px;letter-spacing:-.01em}h1 i{color:${T.ac};font-style:normal}.sub{color:${T.mut};margin:-14px 0 0}
  .term{border:${mode === 'dark' ? '1px' : '2px'} solid ${T.ln};background:${T.panel};border-radius:14px;padding:18px 22px;font:13.5px/1.75 "JetBrains Mono",ui-monospace,Menlo,monospace}
  .bar{display:flex;gap:7px;margin:0 0 12px}.bar i{width:10px;height:10px;border-radius:50%;border:1.5px solid ${T.mut}}
  .l{white-space:pre-wrap}.l b{color:${T.ac};font-weight:700}.you{color:${T.you};margin-top:8px}.p{color:${T.ac}}.hook,.cli{color:${T.mut}}
  .cap{font:12px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:${T.mut};margin:4px 0 -10px}
  .row{border-radius:12px;max-width:100%}</style>
  <h1>Claude Code sessions become SiKick work<i>.</i></h1><p class="sub">The fitting card is suggested at the start (matched on your computer), one key links it, the time counts on it, and you close it as done or worked on.</p>
  <div class="term"><div class="bar"><i></i><i></i><i></i></div>${lines}</div>
  <div class="cap">My day, at the same time</div><img class="row" src="${img}">`;
  const p = await b.newPage({ viewport: { width: 1280, height: 200 }, deviceScaleFactor: 1 });
  await p.setContent(html); await p.waitForTimeout(300);
  await p.screenshot({ path: join(out, `claude-code-session-${mode}.png`), fullPage: true });
  console.log('wrote', join(out, `claude-code-session-${mode}.png`));
  await p.close();
}
await b.close();
