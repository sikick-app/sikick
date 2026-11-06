#!/usr/bin/env node
// End to end against a REAL SiKick site + boards server on a throwaway COPY of the test data (never live). Needs the
// SiKick server source, which is not in this repository: its _e2e/lib/servers.mjs starts them on free ports.
//   SIKICK_SITE_DIR=<its folder> node test/e2e-local.mjs [--keep] [--shots <dir>]
// Covers: token, My day, the start offer + one-key link (with the session's earlier time carried onto the card), offline
// events placed at their own time, status, worked on (the ↻ record on My day, the card moved on, the note carried),
// new card + done, a rejected token. Prints no email address and no token.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { hook, cli, rm } from './helpers.mjs';

const SITE = process.env.SIKICK_SITE_DIR;
if (!SITE) { console.log('e2e skipped: set SIKICK_SITE_DIR to the SiKick server source (not in this repository)'); process.exit(0); }
const keep = process.argv.includes('--keep'), shotsAt = process.argv.indexOf('--shots'), SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : '';
const hide = (s) => String(s).replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi, '<email>').replace(/sct_[\w-]+/g, 'sct_…');
const log = (...a) => console.log(hide(a.join(' ')));
const step = async (name, fn) => { const t = Date.now(); try { await fn(); log(`  ok  ${name} (${Date.now() - t} ms)`); } catch (e) { log(`  FAIL ${name}: ${e.message}`); throw e; } };

const { startServers } = await import(join(SITE, '_e2e/lib/servers.mjs'));
const srv = await startServers({ keep, log: (m) => log('  ', m) });
const H = mkdtempSync(join(tmpdir(), 'sikick-e2e-home-'));
const env = { SIKICK_HOME: H, SIKICK_URL: srv.base };
let fail = 0; const said = [];   // the plugin's own lines, for the listing image (test/render-listing.mjs)
try {
  // a token, as /app/claude makes it (the copy signs in as its dev person)
  let tok = '';
  await step('make a token on /app/claude', async () => {
    const r = await fetch(srv.base + '/app/api/claude/token', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: '{"label":"e2e"}' });
    tok = (await r.json()).token; assert.match(tok || '', /^sct_/);
    const s = await cli(['token', tok], env); assert.match(s.out, /^Saved to /);
  });
  let day;
  await step('My day through the plugin', async () => {
    const r = await fetch(srv.base + '/app/api/claude/today', { headers: { authorization: `Bearer ${tok}` } }); day = await r.json();
    assert.ok(Array.isArray(day.cards), 'cards'); log(`      ${day.day}: ${day.cards.length} cards, ${day.did_not_fit.length} did not fit`);
    const t = await cli(['today'], env); assert.match(t.out, /^My day /);
  });
  // a card of the person's own to work on (deterministic, whatever the copy's plan holds), then a repo whose branch names it
  let own;
  await step('add a card to My day (sikick new)', async () => {
    const n = await cli(['new', '--', 'Rotate the staging webhook secret'], env); assert.match(n.out, /Card added: "Rotate the staging webhook secret" → your day/);
    const r = await (await fetch(srv.base + '/app/api/claude/today', { headers: { authorization: `Bearer ${tok}` } })).json();
    own = [...r.cards, ...r.did_not_fit].find(c => c.title === 'Rotate the staging webhook secret'); assert.ok(own, 'on the day');
  });
  const repo = join(mkdtempSync(join(tmpdir(), 'sikick-e2e-repo-')), 'webhooks'); mkdirSync(join(repo, '.git'), { recursive: true }); writeFileSync(join(repo, '.git/HEAD'), 'ref: refs/heads/chore/rotate-webhook-secret\n');
  const SID = 'e2e-' + Date.now().toString(36), S = (x = {}) => ({ session_id: SID, cwd: repo, ...x });
  let offer;
  await step('session start offers that card (scored locally)', async () => {
    offer = await hook('offer', S({ source: 'startup' }), env);
    assert.match(offer.json?.systemMessage || '', /link this session to "Rotate the staging webhook secret"/); log('      ' + offer.json.systemMessage); said.push(['hook', offer.json.systemMessage], ['you', 'y']);
  });
  await step('worked before linking: offline events, sent later, placed at their own time', async () => {
    // 6 tool events 30..5 min ago that "could not be sent" (queued), then one live event flushes them
    const L = join(H, 'queue.jsonl'), now = Date.now();
    writeFileSync(L, [30, 25, 20, 15, 10, 5].map(m => JSON.stringify({ base: srv.base, ev: { v: 1, type: 'tool', tool: 'Edit', session_id: SID, client_at: new Date(now - m * 60e3).toISOString(), cwd: repo, project: 'webhooks' } })).join('\n') + '\n');
    await hook('tool', S({ tool_name: 'Read' }), env);
    assert.equal(readFileSync(L, 'utf8').trim(), '', 'queue flushed');
    const st = await cli(['status', '--session', SID], env); assert.match(st.out, /not linked to a card/); assert.match(st.out, / (29|30|31) min worked/);
  });
  await step('"y" links it; the 30 min so far count on the card', async () => {
    const g = await hook('gate', S({ prompt: 'y' }), env);
    assert.equal(g.json?.decision, 'block'); log('      ' + g.json.reason); said.push(['hook', g.json.reason]);
    const st = await cli(['status', '--session', SID], env);
    assert.match(st.out, /on "Rotate the staging webhook secret" \{own:[^}]+\} · (29|30|31) min on it today \((29|30|31) not logged yet\)/); log('      ' + st.out.split('\n')[1]);
  });
  await step('the My day badge feed shows it live', async () => {
    // the page's own feed (claudebadge.js), signed in as the dev person
    const j = await (await fetch(srv.base + '/app/api/claude/live', { headers: { 'sec-fetch-site': 'same-origin' } })).json();
    const b = j.cards?.[own.card]; assert.ok(b && b.live && b.mins >= 29, JSON.stringify(b));
  });
  if (SHOTS) await step(`screenshots (linked) → ${SHOTS}`, async () => { const { shots } = await import('./shots.mjs'); await shots(srv.base, SHOTS, log, 'linked'); });
  await step('worked on, not finished: the ↻ record, the card moves on, the note carries', async () => {
    const r = await cli(['done', '--today', '--session', SID, '--', 'Old secret revoked; rotate the cron next'], env);
    assert.match(r.out, /Worked on \(not finished\): "Rotate the staging webhook secret" · (29|30|31) min logged · note: "Old secret revoked; rotate the cron next" · continues /); log('      ' + r.out.trim()); said.push(['you', '/sikick:done --today Old secret revoked; rotate the cron next'], ['cli', r.out.trim()]);
    const pf = readdirSync(join(srv.data, 'people')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(srv.data, 'people', f), 'utf8'))).find(x => x.days?.[day.day]?.worked?.[own.card]);
    assert.ok(pf, 'a worked record on today'); const w = pf.days[day.day].worked[own.card];
    assert.ok(w.mins >= 29 && w.to > day.day, JSON.stringify(w));
    assert.ok((pf.days[w.to]?.own || []).some(t => 'own:' + t.id === own.card), 'the task is on the next working day');
    assert.equal(pf.prefs.carry?.[own.card]?.note, 'Old secret revoked; rotate the cron next');
    const again = await cli(['done', '--today', '--session', SID], env);
    assert.match(again.out, /Worked on|SiKick:/);   // nothing left to log: 0 min (or the task is no longer on today)
  });
  await step('a follow-up card, linked, finished', async () => {
    const SID2 = SID + 'b';
    await cli(['new', '--', 'Document the webhook rotation'], env);
    const s = await cli(['start', 'Document the webhook', '--session', SID2], env); assert.match(s.out, /^Linked this session to "Document the webhook rotation"/);
    const d = await cli(['done', '--session', SID2, '--', 'written down'], env); assert.match(d.out, /^Done: "Document the webhook rotation"/); log('      ' + d.out.trim());
    const pf = readdirSync(join(srv.data, 'people')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(srv.data, 'people', f), 'utf8'))).find(x => (x.days?.[day.day]?.own || []).some(t => t.title === 'Document the webhook rotation'));
    assert.equal(pf.days[day.day].own.find(t => t.title === 'Document the webhook rotation').done, true, 'ticked on My day');
  });
  await step('a board card: worked on → a work log + comment on its board, the ↻ record, on to the next day', async () => {
    const bc = day.cards.find(c => !c.card.startsWith('own:') && !c.done); if (!bc) { log('      (no board card on the copy\'s day: skipped)'); return; }
    const SID3 = SID + 'c';
    const s = await cli(['start', bc.card, '--session', SID3], env); assert.match(s.out, /^Linked this session/);
    const r = await cli(['done', '--today', '--minutes', '20', '--session', SID3, '--', 'Draft sent for review'], env);
    assert.match(r.out, /Worked on \(not finished\): .* · 20 min logged · note: "Draft sent for review" · continues /); log('      ' + r.out.trim());
    const pf = readdirSync(join(srv.data, 'people')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(srv.data, 'people', f), 'utf8'))).find(x => x.days?.[day.day]?.worked?.[bc.card]);
    const w = pf.days[day.day].worked[bc.card]; assert.equal(w.mins, 20);
    assert.ok((pf.days[w.to]?.order || [])[0] === bc.card, 'first in line on its next day');
    const c = await (await fetch(srv.base + `/app/api/claude/card?card=${encodeURIComponent(bc.card)}`, { headers: { authorization: `Bearer ${tok}` } })).json();
    assert.ok(JSON.stringify(c).includes('Worked on in Claude Code (20 min): Draft sent for review'), 'the comment is on the card');
  });
  if (SHOTS) await step(`screenshots (worked on) → ${SHOTS}`, async () => { const { shots } = await import('./shots.mjs'); await shots(srv.base, SHOTS, log, 'worked'); });
  await step('a rejected token: one clear line, events kept', async () => {
    const H2 = mkdtempSync(join(tmpdir(), 'sikick-e2e-bad-')); writeFileSync(join(H2, 'token'), 'sct_' + 'x'.repeat(32));
    const e2 = { SIKICK_HOME: H2, SIKICK_URL: srv.base };
    const t = await cli(['today'], e2); assert.match(t.out, /rejected the token/);
    await hook('tool', S({ tool_name: 'Edit' }), e2); assert.ok(existsSync(join(H2, 'queue.jsonl')));
    rm(H2);
  });
  if (SHOTS) writeFileSync(join(SHOTS, 'said.json'), hide(JSON.stringify(said, null, 1)));
  rm(join(repo, '..'));
} catch (e) { fail = 1; }
finally { await srv.stop(); rm(H); }
log(fail ? 'E2E FAILED' : 'E2E passed');
process.exit(fail);
