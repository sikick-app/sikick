#!/usr/bin/env node
// sikick: the CLI behind /sikick:* commands and the skills. Prints plain text for Claude to relay. Always exits 0, so a
// failing call never aborts a command (a failing !`…` aborts the whole command).
//   sikick status|today|next                                   --session SID
//   sikick start [card key | number | words] | unlink           --session SID   (no arg: lists My day to pick from)
//   sikick done [note…] [--today [--to tomorrow|plan|stay|YYYY-MM-DD]] [--minutes N] [--card ws:id]  --session SID
//   sikick wrap                                                 --session SID   (what /sikick:wrap needs; local TODO scan)
//   sikick todos                                                TODO/FIXME lines added in this repo's working tree (local)
//   sikick bug <text…> | new <title…> [--project ws] [--notes …] --session SID
//   sikick pause [--on|--off]                                   --session SID
//   sikick progress <note…>                                     --session SID
//   sikick persona show | persona upload <file.json> | persona delete
//   sikick token <sct_…>
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  call, token, baseUrl, checkUrl, noTokenHelp, failText, saveToken, setSessionState, sessionState, projectOf, currentSession,
  gitInfo, rememberLink, queueCount, auth, tokenMeta, VERSION, setPendingWrap, shownDir,
} from './lib.mjs';
import { todosFromDiff } from './match.mjs';

const argv = process.argv.slice(2), cmd = argv.shift() || 'status', opt = {}, words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--') { words.push(...argv.slice(i + 1)); break; }
  if (/^--(session|minutes|card|project|cwd|to|notes)$/.test(a)) opt[a.slice(2)] = argv[++i];
  else if (/^--(today|on|off|json)$/.test(a)) opt[a.slice(2)] = true;
  else words.push(a);
}
const cwd = opt.cwd || process.cwd();
const sid = (opt.session && !/^\$\{/.test(opt.session) ? opt.session : '') || currentSession(cwd);
const text = words.join(' ').trim();
let BUF = '';
const out = (s) => { BUF += s.endsWith('\n') ? s : s + '\n'; };   // written once at the end, then exit
const fail = (r) => out(failText(r));
const line = (c, i) => `${i != null ? `${String(i + 1).padStart(2)}. ` : ''}${c.at ? `${c.at}-${c.until} ` : ''}${c.title}${c.project ? ` [${c.project}]` : c.card?.startsWith('own:') ? ' [you]' : ''}${c.done ? ' (done)' : ''}${c.now ? ' <- now' : ''}${c.did_not_fit ? ` (did not fit, ${c.mins} min)` : ''}  {${c.card}}`;
const dayName = (d) => { if (d === 'plan') return 'To plan'; const t = new Date(d + 'T12:00:00'); return isNaN(t) ? d : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
const TO = /^(tomorrow|plan|stay|\d{4}-\d{2}-\d{2})$/;

function localTodos() {
  const g = gitInfo(cwd); if (!g.root) return { repo: false, list: [] };
  try {
    const diff = execFileSync('git', ['-C', g.root, 'diff', '--no-color', '--unified=0', 'HEAD'], { encoding: 'utf8', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
    return { repo: true, list: todosFromDiff(diff) };
  } catch { return { repo: true, list: [] }; }
}

async function main() {
  if (cmd === 'version') return out(`sikick plugin ${VERSION}`);
  if (cmd === 'token') { if (!/^sct_[\w-]{20,80}$/.test(text)) return out('Usage: sikick token sct_… (from ' + baseUrl() + '/app/claude)'); return out(`Saved to ${saveToken(text)} (for ${baseUrl()}).`); }
  if (cmd === 'todos') { const t = localTodos(); return out(!t.repo ? 'Not in a git repository: no TODO scan.' : t.list.length ? t.list.map((x, i) => `${i + 1}. ${x.tag}: ${x.text}  (${x.file})`).join('\n') : 'No TODO / FIXME lines added in the working tree.'); }
  const u = checkUrl(); if (!u.ok) return out(failText({ badurl: true, error: u.error }));
  if (!token()) return out(noTokenHelp());

  if (cmd === 'status') {
    const where = `${baseUrl()} (${u.kind === 'live' ? 'live' : u.kind === 'local' ? 'local test server' : 'custom / staging address'})`;
    const q = queueCount(), m = tokenMeta(), local = sessionState(sid);
    const notes = [q ? `${q} event${q === 1 ? '' : 's'} waiting on this computer (sent with the next one that gets through)` : '', m.base && m.base !== baseUrl() ? `the token was saved for ${m.base}` : ''].filter(Boolean);
    const r = await call(`/app/api/claude/status?session=${encodeURIComponent(sid)}`);
    if (!r.ok) return out([`SiKick plugin ${VERSION} · ${where}`, failText(r), ...notes].join('\n'));
    const j = r.json, s = j.session;
    return out([`SiKick plugin ${VERSION} · ${j.email} at ${where} · ${j.today_minutes} min in Claude Code today (${j.day})`,
      s ? `This session (${s.project || 'no project'}): ${s.card ? `on "${s.card_title || s.card}" {${s.card}} · ${s.card_minutes} min on it today${s.card_unlogged ? ` (${s.card_unlogged} not logged yet)` : ''}` : 'not linked to a card (/sikick:start)'}${s.paused || local.paused ? ' · PAUSED (nothing is sent)' : ''} · ${s.minutes} min worked · ${s.prompts} prompts · ${Object.values(s.tools || {}).reduce((a, b) => a + b, 0)} tool calls · ${s.files} files touched${s.progress ? `\nLast progress: ${s.progress.note}` : ''}` : (local.paused ? 'This session is PAUSED (nothing is sent).' : 'This session has sent no events yet.'),
      `Persona: ${j.persona ? 'uploaded' : 'none yet (/sikick:persona)'}`, ...notes.map(n => `Note: ${n}`)].join('\n'));
  }

  if (cmd === 'today' || cmd === 'next' || (cmd === 'start' && !text)) {
    const r = await call('/app/api/claude/today'); if (!r.ok) return fail(r);
    const j = r.json;
    if (cmd === 'next') return out(j.next ? `Next on your day (${j.day}, now ${j.now}):\n${line(j.next)}\nStart it: /sikick:start ${j.next.card}` : `Nothing left on your day (${j.day}).`);
    const all = [...j.cards, ...j.did_not_fit];
    if (!all.length) return out(`My day (${j.day}) has no cards. Add one: sikick new "<title>"`);
    return out([`My day ${j.day} (now ${j.now}):`, ...all.map(line), j.next ? `\nNext: ${j.next.title} {${j.next.card}}` : '', cmd === 'start' ? '\nPick one by number, key or words: sikick start <pick> --session <id>' : ''].filter(Boolean).join('\n'));
  }

  if (cmd === 'start' || cmd === 'unlink') {
    if (!sid) return out(`No session id: run this from /sikick:start.`);
    if (cmd === 'unlink') { const r = await call('/app/api/claude/link', { method: 'POST', body: { session_id: sid, card: null } }); if (!r.ok) return fail(r); setSessionState(sid, { card: null, title: '' }); return out('This session is not linked to a card any more (its time so far stays where it was).'); }
    let card = /^[\w.-]{1,80}:[\w:.-]{1,120}$/.test(text) ? text : '', title = '';
    if (!card) {
      const r = await call('/app/api/claude/today'); if (!r.ok) return fail(r);
      const all = [...r.json.cards, ...r.json.did_not_fit], n = /^\d+$/.test(text) ? all[+text - 1] : null;
      const hits = n ? [n] : all.filter(c => c.title.toLowerCase().includes(text.toLowerCase()));
      if (hits.length !== 1) return out(hits.length ? `"${text}" matches ${hits.length} cards, pick one:\n${hits.map(line).join('\n')}` : `No card on your day matches "${text}". /sikick:today lists them.`);
      card = hits[0].card; title = hits[0].title;
    } else {   // a key: its title from My day, else from the card itself (a card that is not on today's plan)
      const r = await call('/app/api/claude/today');
      title = (r.ok && [...r.json.cards, ...r.json.did_not_fit].find(c => c.card === card)?.title) || '';
      if (!title) { const c = await call(`/app/api/claude/card?card=${encodeURIComponent(card)}`); if (c.ok) title = String(c.json.title || ''); else if (c.status === 400) return out(`SiKick: ${c.error} (${card})`); }
    }
    const r = await call('/app/api/claude/link', { method: 'POST', body: { session_id: sid, card, title, cwd: shownDir(cwd), project: projectOf(cwd) } }); if (!r.ok) return fail(r);
    setSessionState(sid, { card, title, paused: false, offer: undefined });
    const g = gitInfo(cwd); rememberLink(cwd, g.branch, card, title);
    return out(`Linked this session to "${title || card}" {${card}}. My day shows "working in Claude" on it; /sikick:wrap or /sikick:done when finished.${r.json.carried ? ` This session's ${r.json.carried} min so far count on it too.` : ''}`);
  }

  if (cmd === 'done') {
    if (opt.to && !TO.test(opt.to)) return out('--to is tomorrow, plan, stay or a date YYYY-MM-DD');
    const body = { session_id: sid, note: text, finish: !opt.today, ...(opt.today && opt.to && opt.to !== 'tomorrow' ? { to: opt.to } : {}), ...(opt.minutes ? { minutes: +opt.minutes } : {}), ...(opt.card ? { card: opt.card } : {}) };
    const r = await call('/app/api/claude/done', { method: 'POST', body, timeout: 15000 }); if (!r.ok) return fail(r);
    const j = r.json; if (j.finished) { setSessionState(sid, { card: null }); setPendingWrap(cwd, null); }
    return out(`${j.finished ? 'Done' : 'Worked on (not finished)'}: "${j.title || j.card}"${j.minutes ? ` · ${j.minutes} min logged` : ''}${text ? ` · note: "${text}"` : ''}${!j.finished ? (j.to ? ` · continues ${dayName(j.to)}` : ' · stays on today') : ''}.`);
  }

  if (cmd === 'wrap') {
    const r = await call(`/app/api/claude/status?session=${encodeURIComponent(sid)}`); if (!r.ok) return fail(r);
    const s = r.json.session, t = localTodos();
    const head = s?.card ? `Linked card: "${s.card_title || s.card}" {${s.card}} · ${s.card_minutes} min on it today · ${s.card_unlogged || 0} min not logged yet`
      : 'This session is not linked to a card (nothing to mark done; /sikick:start links one).';
    const todo = !t.repo ? 'TODO scan: not a git repository.' : t.list.length ? `TODO / FIXME lines added in this repo (local scan, not sent):\n${t.list.map((x, i) => `${i + 1}. ${x.tag}: ${x.text}  (${x.file})`).join('\n')}` : 'TODO scan: no TODO / FIXME lines added in the working tree.';
    return out(`${head}\n${s?.progress ? `Last progress: ${s.progress.note}\n` : ''}${todo}`);
  }

  if (cmd === 'bug' || cmd === 'new') {
    if (!text) return out(`Usage: sikick ${cmd} "<${cmd === 'bug' ? 'what is broken' : 'title'}>"`);
    const r = await call(`/app/api/claude/${cmd}`, { method: 'POST', body: { session_id: sid, title: text, ...(opt.notes ? { notes: String(opt.notes).slice(0, 1800) } : {}), ...(opt.project ? { project: opt.project } : {}) } }); if (!r.ok) return fail(r);
    const j = r.json;
    return out(`${cmd === 'bug' ? 'Bug filed' : 'Card added'}: "${j.task?.title || text}" → ${j.to === 'day' ? 'your day' : `${j.to} · New from chat`}.`);
  }

  if (cmd === 'pause') {
    if (!sid) return out('No session id: run this from /sikick:pause.');
    const want = opt.on ? true : opt.off ? false : !sessionState(sid).paused;
    setSessionState(sid, { paused: want });   // local flag first: it holds even when SiKick is unreachable
    const r = await call('/app/api/claude/pause', { method: 'POST', body: { session_id: sid, paused: want } });
    return out(`${want ? 'Paused: this session sends nothing to SiKick and its time stops counting.' : 'Resumed: tracking this session again.'}${r.ok ? '' : ` (${failText(r)} The local pause holds.)`}`);
  }

  if (cmd === 'progress') {
    if (!sid || !text) return out('Usage: sikick progress "<one line>" --session <id>');
    if (sessionState(sid).paused) return out('This session is paused: nothing was sent.');
    const r = await call('/app/api/claude/events', { method: 'POST', body: { type: 'progress', session_id: sid, note: text.slice(0, 500), project: projectOf(cwd) } }); if (!r.ok) return fail(r);
    return out('Progress noted in SiKick.');
  }

  if (cmd === 'persona') {
    if (words[0] === 'upload') {
      let profile; try { profile = JSON.parse(readFileSync(words[1], 'utf8')); } catch (e) { return out(`Could not read ${words[1]}: ${e.message}`); }
      const r = await call('/app/api/claude/persona', { method: 'POST', body: { profile } }); if (!r.ok) return fail(r);
      return out('Persona uploaded to SiKick (only the approved profile; no logs).');
    }
    if (words[0] === 'delete') {
      const r = await call('/app/api/claude/persona', { method: 'DELETE' }); if (!r.ok) return fail(r);
      return out(r.json.deleted === false ? 'No persona profile in SiKick to delete.' : 'Persona profile deleted from SiKick. Your local draft (~/.sikick/persona.draft.json), if any, is still on this computer.');
    }
    const r = await call('/app/api/claude/persona'); if (!r.ok) return fail(r);
    return out(r.json.persona ? JSON.stringify(r.json.persona.profile, null, 2) : 'No persona yet: /sikick:persona builds one.');
  }

  out(`Unknown command "${cmd}". Try: status, today, next, start, unlink, done, wrap, todos, bug, new, pause, progress, persona, token, version.`);
}
main().catch(e => out(`SiKick: ${e?.message || e}`)).finally(() => process.stdout.write(BUF, () => process.exit(0)));
