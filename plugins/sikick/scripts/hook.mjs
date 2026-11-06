#!/usr/bin/env node
// SiKick hooks. Never fails the hook (always exit 0), never blocks your work for long. Without a token: nothing at all.
//
//   session_start | prompt | tool | stop | session_end   one small event each (fire-and-forget; queued locally when
//                                                        SiKick can't be reached). Sent: session id, event type, time,
//                                                        cwd + folder name, tool name, changed file paths (relative to
//                                                        the project; outside it only the file name), prompt LENGTH.
//                                                        Prompt text only when send_prompts is on. Never commands,
//                                                        tool output, file contents or transcripts.
//   offer   (SessionStart, waits ≤ 3 s)  suggests the card on My day that fits this folder / branch (scored HERE, from
//           GET /app/api/claude/today), or offers to wrap up the last linked session in this folder. Prints one line
//           for you (systemMessage) and a short note for Claude (additionalContext).
//   gate    (UserPromptSubmit, local)    your one-key answer to an offer (y / n, d / w note / n; later "sk y") is handled
//           here and does not go to Claude; otherwise it may add a short SiKick note for Claude. Your prompt's words are
//           only compared with your card titles on this machine.
import { relative, isAbsolute, basename } from 'node:path';
import {
  token, sendPrompts, sessionState, setSessionState, projectOf, noteCurrent, postEvents, call, rememberOptions, gitInfo,
  links, rememberLink, pendingWraps, setPendingWrap, suggestOn, auth, setAuth, baseUrl, checkUrl, failText, shownDir,
} from './lib.mjs';
import { suggest, answer, wrapsUp } from './match.mjs';

const mode = process.argv[2] || 'tool';
const SYNC = mode === 'offer' || mode === 'gate';
let OUT = '';
const quit = () => (OUT ? process.stdout.write(OUT, () => process.exit(0)) : process.exit(0));
setTimeout(quit, SYNC ? 3500 : 1500).unref();   // hard stop, whatever happens
const emit = (o) => { if (o) OUT = JSON.stringify(o); };   // written once, at the end (quit)

async function readHook() { let raw = ''; for await (const c of process.stdin) raw += c; try { return JSON.parse(raw || '{}'); } catch { return {}; } }
const rootOf = (h) => process.env.CLAUDE_PROJECT_DIR || h.cwd || process.cwd();
const OFFER_PROMPTS = 3, OFFER_MS = 3 * 3600e3;
const live = (o) => o && o.prompts < OFFER_PROMPTS && Date.now() - (o.t || 0) < OFFER_MS;
const q = (s) => `"${String(s || '').slice(0, 90)}"`;
const dayName = (d) => { if (!d || d === 'plan') return d === 'plan' ? 'To plan' : ''; const t = new Date(d + 'T12:00:00'); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };

/* ---------- events ---------- */
async function event(h) {
  const sid = h.session_id; if (!sid) return;
  const st = sessionState(sid), root = rootOf(h);
  if (mode === 'session_end' && st.card && !st.paused && !h.agent_id) setPendingWrap(root, { sid, card: st.card, title: st.title || '', at: Date.now() });
  if (st.paused && mode !== 'session_end') return;   // /sikick:pause: nothing leaves this machine
  const ev = { v: 1, type: mode, session_id: sid, client_at: new Date().toISOString(), cwd: shownDir(h.cwd || root), project: projectOf(root) };
  if (h.agent_type) ev.agent_type = String(h.agent_type).slice(0, 60);
  if ((mode === 'session_start' || mode === 'prompt') && !h.agent_id) noteCurrent(sid, h.cwd || root);
  if (mode === 'session_start' && h.source) ev.source = h.source;
  if (mode === 'session_end' && h.reason) ev.reason = h.reason;
  if (mode === 'prompt') { const p = String(h.prompt || ''); ev.prompt_len = p.length; if (sendPrompts() && p) ev.prompt = p.slice(0, 4000); }
  if (mode === 'tool') {
    ev.tool = String(h.tool_name || '').slice(0, 80);
    const ti = h.tool_input || {}, paths = [ti.file_path, ti.notebook_path].filter(x => typeof x === 'string' && x);
    if (paths.length) ev.files = paths.map(f => { const r = isAbsolute(f) ? relative(root, f) : f; return r.startsWith('..') || isAbsolute(r) ? basename(f) : r; });
  }
  await postEvents([ev], 1000);
}

/* ---------- offer (SessionStart) ---------- */
async function linkOffer(h, root, bare, skip = '') {
  const t = await call('/app/api/claude/today', { timeout: 2500 }); if (!t.ok) return null;
  const all = [...(t.json.cards || []), ...(t.json.did_not_fit || [])];
  const g = gitInfo(root), ctx = { repo: basename(g.root || root), dir: root, branch: g.branch, links: links(), next: t.json.next?.card };
  const s = suggest(all.filter(c => c.card !== skip), ctx); if (!s) return null;
  const cards = all.filter(c => !c.done).slice(0, 40).map(c => ({ card: c.card, title: c.title, project: c.project, now: c.now }));
  return { kind: 'link', card: s.card, title: s.title, project: s.project, why: s.why, strong: s.strong, bare, prompts: 0, t: Date.now(), cards, branch: g.branch, next: t.json.next?.card || '' };
}
const linkLine = (o, keys) => `SiKick: link this session to ${q(o.title)}${o.project ? ` [${o.project}]` : ''}? (${o.why})  ${keys ? 'y = link · n = no' : 'Reply "sk y" to link, "sk n" for no'} · /sikick:start picks another`;
const wrapLine = (o, keys) => `SiKick: your last session here worked ${o.mins} min on ${q(o.title)}, not logged yet.  ${keys ? 'd = done · w [note] = worked on (continues next working day) · n = leave it' : 'Reply "sk d" done · "sk w <note>" worked on · "sk n" leave it'}`;
const forClaude = (o) => `SiKick plugin: the user was just offered: ${o.kind === 'link' ? linkLine(o, false) : wrapLine(o, false)}. The plugin handles that answer itself (it never reaches you). If the user's message is a task instead, do the task, and only at the end of your FIRST reply add that offer as one short line. Never link, finish or log a SiKick card yourself without the user's yes.`;

async function offer(h) {
  const sid = h.session_id; if (!sid || h.agent_id || h.source === 'compact') return;
  const root = rootOf(h), st = sessionState(sid);
  noteCurrent(sid, h.cwd || root);
  const a = auth(), u = checkUrl();
  if (!u.ok) return emit({ systemMessage: `SiKick: ${u.error}. Nothing is sent until it's fixed (/sikick:status).` });
  if (a.rejected && a.rejected === baseUrl() && (!a.shown || Date.now() - Date.parse(a.shown) > 6 * 3600e3)) {
    setAuth({ ...a, shown: new Date().toISOString() });
    return emit({ systemMessage: `SiKick: ${baseUrl()} rejected your token (replaced or removed). Make a new one at ${baseUrl()}/app/claude. Until then events wait on this computer.` });
  }
  if (st.paused) return;
  if (st.card) return emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `SiKick plugin: this session is linked to the SiKick card ${q(st.title || st.card)} {${st.card}}.` } });
  const bare = h.source === 'startup' || h.source === 'clear' || !h.source;
  // 1) the last linked session in this folder ended with time not logged: wrap it up
  const pw = pendingWraps()[root];
  let o = null;
  if (pw && pw.sid !== sid && Date.now() - pw.at < 7 * 864e5) {
    const r = await call(`/app/api/claude/status?session=${encodeURIComponent(pw.sid)}`, { timeout: 2000 });
    const s = r.ok ? r.json.session : null;
    if (r.ok && (!s || !s.card || !(s.card_unlogged > 0))) setPendingWrap(root, null);
    else if (s) o = { kind: 'wrap', from: pw.sid, card: s.card, title: s.card_title || pw.title || s.card, mins: s.card_unlogged, bare, prompts: 0, t: Date.now() };
  }
  // 2) not linked: the card that fits (after a wrap: the best other card, since that one is done or continues later)
  const lk = !st.declined && suggestOn() ? await linkOffer(h, root, bare, o?.card || '') : null;
  if (o && lk) o.then = lk;
  o ||= lk;
  if (!o) return;
  setSessionState(sid, { offer: o });
  emit({ systemMessage: o.kind === 'link' ? linkLine(o, bare) : wrapLine(o, bare), hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: forClaude(o) } });
}

/* ---------- gate (UserPromptSubmit) ---------- */
async function act(sid, h, o, a) {
  const root = rootOf(h);
  if (o.kind === 'link') {
    if (a.act === 'no') { setSessionState(sid, { offer: undefined, declined: true }); return 'SiKick: not linked. /sikick:start links this session later.'; }
    const r = await call('/app/api/claude/link', { method: 'POST', timeout: 3000, body: { session_id: sid, card: o.card, title: o.title, cwd: shownDir(h.cwd || root), project: projectOf(root) } });
    if (!r.ok) { setSessionState(sid, { offer: undefined }); return failText(r); }
    setSessionState(sid, { offer: undefined, card: o.card, title: o.title, paused: false });
    rememberLink(root, o.branch, o.card, o.title);
    return `SiKick: linked to ${q(o.title)}. Its time counts while you work (gaps over 10 min don't); /sikick:wrap at the end, /sikick:pause to stop.`;
  }
  // wrap
  let line;
  if (a.act === 'no') { setPendingWrap(root, null); line = `SiKick: left ${q(o.title)} as it is.`; }
  else {
    const r = await call('/app/api/claude/done', { method: 'POST', timeout: 3000, body: { session_id: o.from, card: o.card, finish: a.act === 'done', note: a.note || '' } });
    if (!r.ok) { setSessionState(sid, { offer: undefined }); return failText(r); }
    setPendingWrap(root, null);
    const j = r.json;
    line = j.finished ? `SiKick: ${q(o.title)} done${j.minutes ? ` · ${j.minutes} min logged` : ''}.`
      : `SiKick: ${q(o.title)} worked on${j.minutes ? ` · ${j.minutes} min` : ''}${j.to ? ` · continues ${dayName(j.to)}` : ''}${a.note ? ' · note kept for next time' : ''}.`;
  }
  if (o.then) { const n = { ...o.then, bare: o.bare, prompts: 0, t: Date.now() }; setSessionState(sid, { offer: n }); return `${line}\n${linkLine(n, n.bare)}`; }
  setSessionState(sid, { offer: undefined });
  return line;
}

async function gate(h) {
  const sid = h.session_id; if (!sid || h.agent_id) return;
  const st = sessionState(sid); if (st.paused) return;
  const prompt = String(h.prompt || ''), ctx = [];
  let o = live(st.offer) ? st.offer : null;
  if (o) {
    const a = answer(prompt, o.kind, o.bare && o.prompts === 0);
    if (a) return emit({ decision: 'block', reason: await act(sid, h, o, a) });
    o = { ...o, prompts: o.prompts + 1, bare: false };
    // the first prompt: its words may point at a better card (compared here; the prompt is not sent)
    if (o.kind === 'link' && o.prompts === 1 && !o.strong && o.cards?.length) {
      const g = gitInfo(rootOf(h)), s = suggest(o.cards, { repo: basename(g.root || rootOf(h)), dir: rootOf(h), branch: g.branch, prompt, links: links(), next: o.next });
      if (s && s.strong && s.card !== o.card) { o = { ...o, card: s.card, title: s.title, project: s.project, why: s.why, strong: true }; ctx.push(`SiKick plugin: this work looks like the card ${q(o.title)} on the user's day. At the end of your reply add one short line: ${linkLine(o, false)}`); }
    }
    setSessionState(sid, { offer: live(o) ? o : undefined });
  } else if (st.offer) setSessionState(sid, { offer: undefined });
  if (st.card && st.told !== st.card) { ctx.push(`SiKick plugin: this session is linked to the SiKick card ${q(st.title || st.card)} {${st.card}} (the sikick-coach skill applies).`); setSessionState(sid, { told: st.card }); }
  if (st.card && !st.wrapHint && wrapsUp(prompt)) { ctx.push('SiKick plugin: the user seems to be wrapping up. Before you finish, offer once in one line: "/sikick:wrap: mark the card done, or log it as worked on with a note, and turn follow-ups into cards (you pick)".'); setSessionState(sid, { wrapHint: true }); }
  if (ctx.length) emit({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx.join('\n') } });
}

async function main() {
  rememberOptions();
  if (!token()) return;
  const h = await readHook();
  if (mode === 'offer') return offer(h);
  if (mode === 'gate') return gate(h);
  return event(h);
}
main().catch(() => {}).finally(quit);
