// Shared code for the SiKick plugin: where SiKick is, the person's token, local state. Node 18+, no dependencies.
// Everything here stays on this machine except what call() / postEvents() send to the SiKick address (README: Privacy).
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, chmodSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';

export const VERSION = '0.3.0';
export const DEFAULT_URL = 'https://www.sikick.si';
export const HOME = process.env.SIKICK_HOME || join(homedir(), '.sikick');
const readT = (f) => { try { return readFileSync(f, 'utf8').trim(); } catch { return ''; } };
export const readJ = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJ(f, v) {   // atomic, private (0600 in a 0700 folder)
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  const t = `${f}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(v), { mode: 0o600 }); renameSync(t, f);
}
const P = (...a) => join(HOME, ...a);
export const config = () => readJ(P('config.json'), {});

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? '').trim());
const falsy = (v) => /^(0|false|no|off)$/i.test(String(v ?? '').trim());

/* ---------- where SiKick is ----------
   SIKICK_URL env > the plugin option sikick_url (hooks get it as CLAUDE_PLUGIN_OPTION_SIKICK_URL; they remember it in
   ~/.sikick/options.json so the CLI, which runs without it, follows too) > ~/.sikick/config.json url > www.sikick.si */
export function rememberOptions() {
  const url = process.env.CLAUDE_PLUGIN_OPTION_SIKICK_URL, off = process.env.CLAUDE_PLUGIN_OPTION_SUGGEST_CARDS;
  if (url === undefined && off === undefined) return;
  const cur = readJ(P('options.json'), {}), next = { ...cur, ...(url !== undefined ? { url } : {}), ...(off !== undefined ? { suggest_cards: !falsy(off) } : {}) };
  if (JSON.stringify(cur) !== JSON.stringify(next)) { try { writeJ(P('options.json'), next); } catch {} }
}
export function rawUrl() {
  const o = readJ(P('options.json'), {});
  return String(process.env.SIKICK_URL || process.env.CLAUDE_PLUGIN_OPTION_SIKICK_URL || process.env.SIKICK_PLUGIN_URL || config().url || o.url || DEFAULT_URL).trim();   // SIKICK_PLUGIN_URL: the option, as .mcp.json hands it to the flow MCP
}
// {ok, url, kind: 'live'|'local'|'custom', error?}. https only, except a local test server (http://localhost…): the
// token is never sent in the clear over a network
export function checkUrl(u = rawUrl()) {
  let x; try { x = new URL(u); } catch { return { ok: false, url: u, error: `"${u}" is not a web address` }; }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname) || x.hostname.endsWith('.localhost');
  if (x.protocol !== 'https:' && !(x.protocol === 'http:' && local)) return { ok: false, url: u, error: `SiKick address must be https:// (only a local test server may be http://localhost): ${x.origin}` };
  if (x.username || x.password || x.search || x.hash) return { ok: false, url: u, error: 'SiKick address: no user, query or # part, please' };
  const url = (x.origin + x.pathname).replace(/\/+$/, '');
  return { ok: true, url, kind: /^(www\.)?sikick\.si$/.test(x.hostname) ? 'live' : local ? 'local' : 'custom' };
}
export const baseUrl = () => checkUrl().url.replace(/\/+$/, '');

/* ---------- the token (sct_…, made on <SiKick>/app/claude) in ~/.sikick/token, 0600 ---------- */
export const token = () => readT(P('token'));
export const tokenMeta = () => readJ(P('token.meta.json'), {});
export function saveToken(t) {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const f = P('token'); writeFileSync(f, t.trim(), { mode: 0o600 }); chmodSync(f, 0o600);
  writeJ(P('token.meta.json'), { base: baseUrl(), saved: new Date().toISOString() });
  setAuth(null);
  return f;
}
// the account MCP key (skc_…, Me → Use my own Claude): ~/.sikick/mcp_key; none = the MCP asks for OAuth
export const mcpKey = () => readT(P('mcp_key'));
export const sendPrompts = () => truthy(process.env.SIKICK_SEND_PROMPTS) || truthy(process.env.CLAUDE_PLUGIN_OPTION_SEND_PROMPTS) || config().send_prompts === true;
// card suggestions at session start (on by default): plugin option suggest_cards, SIKICK_SUGGEST=0, config suggest_cards: false
export const suggestOn = () => !(falsy(process.env.SIKICK_SUGGEST) || falsy(process.env.CLAUDE_PLUGIN_OPTION_SUGGEST_CARDS) || config().suggest_cards === false || readJ(P('options.json'), {}).suggest_cards === false);

/* ---------- auth state: a token SiKick rejected (401) is remembered so status and the next session can say so ---------- */
export const auth = () => readJ(P('auth.json'), {});
export function setAuth(v) { try { if (v) writeJ(P('auth.json'), v); else if (existsSync(P('auth.json'))) writeJ(P('auth.json'), {}); } catch {} }

/* ---------- local per-session state: paused, linked card, a pending offer ---------- */
const sessFile = (sid) => P('sessions', `${String(sid).replace(/[^\w-]/g, '_')}.json`);
export const sessionState = (sid) => (sid ? readJ(sessFile(sid), {}) : {});
export function setSessionState(sid, patch) {
  if (!sid) return {};
  const s = { ...sessionState(sid), ...patch, at: new Date().toISOString() };
  for (const k of Object.keys(s)) if (s[k] === undefined) delete s[k];
  writeJ(sessFile(sid), s); return s;
}

// the last session seen per project dir (hooks write it): the CLI's fallback when a command could not pass the session id
export function noteCurrent(sid, dir) { try { const all = readJ(P('current.json'), {}); all[dir] = { sid, at: Date.now() }; writeJ(P('current.json'), all); } catch {} }
export const currentSession = (dir = process.cwd()) => readJ(P('current.json'), {})[dir]?.sid || '';

// which card you linked in a repo / branch before (local only: the strongest hint for the next suggestion)
export const linkKey = (dir, branch) => `${dir}#${branch || ''}`;
export const links = () => readJ(P('links.json'), {});
export function rememberLink(dir, branch, card, title) {
  if (!dir || !card) return;
  try { const all = links(); all[linkKey(dir, branch)] = { card, title, at: Date.now() }; all[linkKey(dir, '')] = { card, title, at: Date.now() };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 300); writeJ(P('links.json'), Object.fromEntries(keep)); } catch {}
}

// a linked session that ended with time not logged yet: offered at the next session start in the same folder
export const pendingWraps = () => readJ(P('pending.json'), {});
export function setPendingWrap(dir, v) { try { const all = pendingWraps(); if (v) all[dir] = v; else delete all[dir]; writeJ(P('pending.json'), all); } catch {} }

export const projectOf = (dir) => basename(dir || process.cwd());
// a folder as sent: your home folder as ~ (SiKick shows it as where the work happened; it has no use for your user name)
export const shownDir = (dir) => { const h = homedir(), d = String(dir || ''); return d === h ? '~' : d.startsWith(h + '/') ? '~' + d.slice(h.length) : d; };

/* ---------- git, read from files (no git process): the repo root and the branch ---------- */
export function gitInfo(dir = process.cwd()) {
  let d = resolve(dir);
  for (let i = 0; i < 25; i++) {
    const g = join(d, '.git');
    try {
      let gd = g;
      if (statSync(g).isFile()) { const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(g, 'utf8')); if (!m) return { root: d, branch: '' }; gd = resolve(d, m[1].trim()); }
      const head = readT(join(gd, 'HEAD')), m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      return { root: d, branch: m ? m[1] : '' };
    } catch {}
    const up = dirname(d); if (up === d) break; d = up;
  }
  return { root: '', branch: '' };
}

/* ---------- calls to SiKick ---------- */
const UA = `sikick-claude-plugin/${VERSION}`;
// one call; never throws: {ok, status, json, error, notoken?, offline?, rejected?}
export async function call(path, { method = 'GET', body, timeout = 8000 } = {}) {
  const t = token();
  if (!t) return { ok: false, error: 'no token', notoken: true };
  const u = checkUrl(); if (!u.ok) return { ok: false, error: u.error, badurl: true };
  try {
    const r = await fetch(u.url + path, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}), 'user-agent': UA }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    const json = await r.json().catch(() => ({}));
    if (r.status === 401) setAuth({ rejected: u.url, at: new Date().toISOString() }); else if (r.ok && auth().rejected) setAuth(null);
    return { ok: r.ok && !json.error, status: r.status, json, error: json.error || (r.ok ? undefined : `SiKick answered ${r.status}`), rejected: r.status === 401 };
  } catch (e) {
    return { ok: false, offline: true, error: e?.name === 'TimeoutError' ? `SiKick (${u.url}) did not answer in time` : `SiKick unreachable at ${u.url} (${e?.cause?.code || e?.message || e})` };
  }
}

/* ---------- events, with a local queue for when SiKick is offline or the token was rejected ----------
   Queued events keep their own time (client_at) and are sent with the next event that gets through; SiKick places them
   by that time (sent_at - client_at back from when they arrive). At most 2000 lines and 7 days; only for the same SiKick. */
const QF = () => P('queue.jsonl'), QMAX = 2000, QDAYS = 7;
export function queued() {
  const base = baseUrl(), old = Date.now() - QDAYS * 864e5;
  return readT(QF()).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(x => x && x.base === base && Date.parse(x.ev?.client_at) > old).map(x => x.ev);
}
export function enqueue(evs) {
  try {
    mkdirSync(HOME, { recursive: true, mode: 0o700 });
    const base = baseUrl(), lines = readT(QF()).split('\n').filter(Boolean);
    const all = [...lines, ...evs.map(ev => JSON.stringify({ base, ev }))].slice(-QMAX);
    const t = `${QF()}.${process.pid}.tmp`; writeFileSync(t, all.join('\n') + '\n', { mode: 0o600 }); renameSync(t, QF());
  } catch {}
}
export const clearQueue = () => { try { if (existsSync(QF())) writeFileSync(QF(), '', { mode: 0o600 }); } catch {} };
export const queueCount = () => queued().length;
// send events (the queue first); queue them when it fails. Returns the call result.
export async function postEvents(evs, timeout = 1000) {
  const q = queued(), all = [...q, ...evs].slice(-200);
  const r = await call('/app/api/claude/events', { method: 'POST', timeout, body: all.length === 1 ? { ...all[0], sent_at: new Date().toISOString() } : { events: all, sent_at: new Date().toISOString() } });
  if (r.ok) { if (q.length) clearQueue(); return r; }
  if (r.notoken || r.badurl) return r;
  if (r.offline || r.rejected || (r.status || 0) >= 500) { clearQueue(); enqueue(all); }
  return r;
}

export const noTokenHelp = () => `SiKick isn't connected yet. Open ${baseUrl()}/app/claude (signed in), press "Make a token", then run the line it shows (it writes ~/.sikick/token). Or: node <plugin>/scripts/sikick.mjs token sct_…`;
// one line for a failed call: what happened and what to do
export function failText(r) {
  if (r.notoken) return noTokenHelp();
  if (r.badurl) return `SiKick: ${r.error}. Fix SIKICK_URL, the plugin option sikick_url or ~/.sikick/config.json.`;
  if (r.rejected) {
    const m = tokenMeta(), other = m.base && m.base !== baseUrl() ? ` This token was saved for ${m.base}, but the plugin talks to ${baseUrl()}: check the address (staging vs live).` : '';
    return `SiKick (${baseUrl()}) rejected the token: it was replaced or removed.${other} Make a new one at ${baseUrl()}/app/claude.`;
  }
  if (r.offline) return `${r.error}. Nothing is lost: events wait on this computer (~/.sikick/queue.jsonl) and go out with the next one that gets through.`;
  return `SiKick: ${r.error || `error ${r.status}`}`;
}
export const exists = existsSync;
export const appendLine = (f, s) => { try { appendFileSync(f, s); } catch {} };
