// test helpers: a temp SIKICK_HOME, a fake SiKick (node:http) that records every request, and runners for the hook / CLI
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export const PLUGIN = resolve(new URL('../plugins/sikick', import.meta.url).pathname);
export const home = (tok = 'sct_' + 'a'.repeat(32)) => { const h = mkdtempSync(join(tmpdir(), 'sikick-home-')); if (tok) writeFileSync(join(h, 'token'), tok, { mode: 0o600 }); return h; };
export const rm = (d) => rmSync(d, { recursive: true, force: true });

// routes: { 'GET /app/api/claude/today': (req, body) => [status, json] }
export async function fakeSiKick(routes = {}) {
  const seen = [];
  const srv = createServer((req, res) => {
    let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => {
      const u = new URL(req.url, 'http://x'), body = raw ? JSON.parse(raw) : null, k = `${req.method} ${u.pathname}`;
      seen.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization, ua: req.headers['user-agent'] });
      const fn = routes[k]; const [st, j] = fn ? fn(req, body, u) : [k === 'POST /app/api/claude/events' ? 200 : 404, k === 'POST /app/api/claude/events' ? { ok: true } : { error: 'not found' }];
      res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); srv.unref();   // a failed test never keeps the run alive
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise(r => srv.close(r)) };
}

function run(args, { env = {}, input = '', cwd } = {}) {
  return new Promise(ok => {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SIKICK_|CLAUDE_PLUGIN_OPTION_|CLAUDE_PROJECT_DIR)/.test(k)));
    const p = spawn(process.execPath, args, { env: { ...clean, ...env }, cwd });
    let out = '', err = ''; p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    p.on('close', code => ok({ code, out, err, json: (() => { try { return JSON.parse(out); } catch { return null; } })() }));
    p.stdin.end(input);
  });
}
export const hook = (mode, h, env, cwd) => run([join(PLUGIN, 'scripts/hook.mjs'), mode], { env, input: JSON.stringify(h), cwd });
export const cli = (args, env, cwd) => run([join(PLUGIN, 'scripts/sikick.mjs'), ...args], { env, cwd });
