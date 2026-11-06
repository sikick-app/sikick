// node --test test/  — the hooks and the CLI against a fake SiKick: what is sent, the one-key offers, offline / 401 / pause
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { home, rm, fakeSiKick, hook, cli } from './helpers.mjs';

const TODAY = { day: '2026-11-06', now: '10:00', cards: [
  { card: 'acme:t1', title: 'Fix login redirect loop', project: 'acme', at: '09:00', until: '10:30', now: true },
  { card: 'own:a1', title: 'Invoices for October', at: '11:00', until: '11:30' }], did_not_fit: [], next: { card: 'acme:t1', title: 'Fix login redirect loop' } };

function repo(branch) {   // a folder with a git HEAD on that branch (no git process needed)
  const d = mkdtempSync(join(tmpdir(), 'sikick-repo-')); mkdirSync(join(d, '.git')); writeFileSync(join(d, '.git/HEAD'), `ref: refs/heads/${branch}\n`); return d;
}
const S = (sid, cwd, extra = {}) => ({ session_id: sid, cwd, hook_event_name: 'x', ...extra });

test('no token: the hooks send nothing and print nothing', async () => {
  const H = home(''), F = await fakeSiKick();
  const r = await hook('offer', S('s0', '/tmp', { source: 'startup' }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  const e = await hook('tool', S('s0', '/tmp', { tool_name: 'Edit' }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  assert.equal(r.out + e.out, ''); assert.equal(F.seen.length, 0);
  await F.close(); rm(H);
});

test('events: only the documented fields; never commands, output or prompt text', async () => {
  const H = home(), F = await fakeSiKick(), d = repo('main');
  await hook('tool', S('s1', d, { tool_name: 'Bash', tool_input: { command: 'cat ~/.ssh/id_rsa' }, tool_response: { stdout: 'SECRET' } }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  await hook('tool', S('s1', d, { tool_name: 'Edit', tool_input: { file_path: join(d, 'src/a.ts'), old_string: 'x', new_string: 'SECRET' } }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  await hook('tool', S('s1', d, { tool_name: 'Write', tool_input: { file_path: '/etc/elsewhere/b.txt', content: 'SECRET' } }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  await hook('prompt', S('s1', d, { prompt: 'my SECRET prompt' }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  const evs = F.seen.filter(x => x.path === '/app/api/claude/events').map(x => x.body);
  assert.equal(evs.length, 4);
  assert.ok(!JSON.stringify(evs).includes('SECRET'), 'nothing of the command, output, contents or prompt');
  assert.deepEqual(evs[1].files, ['src/a.ts']); assert.deepEqual(evs[2].files, ['b.txt']);
  assert.equal(evs[3].prompt_len, 16); assert.equal(evs[3].prompt, undefined);
  for (const e of evs) assert.deepEqual(Object.keys(e).filter(k => !['v', 'type', 'session_id', 'client_at', 'cwd', 'project', 'tool', 'files', 'prompt_len', 'sent_at'].includes(k)), []);
  assert.match(F.seen[0].ua, /^sikick-claude-plugin\/0\.3\.0$/);
  await F.close(); rm(H); rm(d);
});

test('send_prompts on: the prompt text (first 4000 characters) goes too', async () => {
  const H = home(), F = await fakeSiKick();
  await hook('prompt', S('s1', '/tmp', { prompt: 'x'.repeat(5000) }), { SIKICK_HOME: H, SIKICK_URL: F.url, CLAUDE_PLUGIN_OPTION_SEND_PROMPTS: 'true' });
  assert.equal(F.seen[0].body.prompt.length, 4000);
  await F.close(); rm(H);
});

test('offer at session start: the fitting card, scored locally; "y" links it and never reaches Claude', async () => {
  const H = home(), d = repo('fix/login-redirect');
  const F = await fakeSiKick({ 'GET /app/api/claude/today': () => [200, TODAY], 'POST /app/api/claude/link': (_q, b) => [200, { ok: true, card: b.card }] });
  const env = { SIKICK_HOME: H, SIKICK_URL: F.url };
  const o = await hook('offer', S('s2', d, { source: 'startup' }), env);
  assert.match(o.json.systemMessage, /link this session to "Fix login redirect loop" \[acme\]\? \(matches branch fix\/login-redirect\)  y = link · n = no/);
  assert.equal(o.json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(o.json.hookSpecificOutput.additionalContext, /never reaches you/);
  const today = F.seen.find(x => x.path === '/app/api/claude/today');
  assert.deepEqual(today.query, {}, 'nothing about the repo or branch is sent to get the day');
  const g = await hook('gate', S('s2', d, { prompt: 'y' }), env);
  assert.equal(g.json.decision, 'block'); assert.match(g.json.reason, /linked to "Fix login redirect loop"/);
  const link = F.seen.find(x => x.path === '/app/api/claude/link');
  assert.deepEqual(Object.keys(link.body).sort(), ['card', 'cwd', 'project', 'session_id', 'title']);
  assert.equal(link.body.card, 'acme:t1');
  // the next prompt: Claude is told once which card the session is on
  const g2 = await hook('gate', S('s2', d, { prompt: 'go on' }), env);
  assert.match(g2.json.hookSpecificOutput.additionalContext, /linked to the SiKick card "Fix login redirect loop" \{acme:t1\}/);
  const g3 = await hook('gate', S('s2', d, { prompt: 'and more' }), env);
  assert.equal(g3.out, '');
  // a new session on the same branch: what you linked before
  const o2 = await hook('offer', S('s3', d, { source: 'startup' }), env);
  assert.match(o2.json.systemMessage, /you linked branch fix\/login-redirect to it before/);
  await F.close(); rm(H); rm(d);
});

test('offer: a task as the first prompt passes through; bare "y" later is NOT taken, "sk y" is', async () => {
  const H = home(), d = repo('main');
  const F = await fakeSiKick({ 'GET /app/api/claude/today': () => [200, TODAY], 'POST /app/api/claude/link': (_q, b) => [200, { ok: true, card: b.card }] });
  const env = { SIKICK_HOME: H, SIKICK_URL: F.url };
  await hook('offer', S('s4', d, { source: 'startup' }), env);
  const g1 = await hook('gate', S('s4', d, { prompt: 'do the invoices for october please' }), env);
  assert.notEqual(g1.json?.decision, 'block');
  assert.match(g1.json.hookSpecificOutput.additionalContext, /Invoices for October/, 'the prompt pointed at a better card (matched locally)');
  assert.ok(!F.seen.some(x => JSON.stringify(x.body || '').includes('invoices for october please')), 'the prompt text was not sent');
  const g2 = await hook('gate', S('s4', d, { prompt: 'y' }), env);
  assert.equal(g2.out, '', 'a bare y mid-session may answer Claude: left alone');
  const g3 = await hook('gate', S('s4', d, { prompt: 'sk y' }), env);
  assert.equal(g3.json.decision, 'block');
  assert.equal(F.seen.find(x => x.path === '/app/api/claude/link').body.card, 'own:a1');
  await F.close(); rm(H); rm(d);
});

test('offer on resume: no bare keys (the last reply may have asked a yes/no question)', async () => {
  const H = home(), d = repo('main');
  const F = await fakeSiKick({ 'GET /app/api/claude/today': () => [200, TODAY] });
  const o = await hook('offer', S('s5', d, { source: 'resume' }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  assert.match(o.json.systemMessage, /Reply "sk y" to link/);
  const g = await hook('gate', S('s5', d, { prompt: 'y' }), { SIKICK_HOME: H, SIKICK_URL: F.url });
  assert.equal(g.out, '');
  await F.close(); rm(H); rm(d);
});

test('suggestions off (plugin option): no offer, no call', async () => {
  const H = home(), F = await fakeSiKick({ 'GET /app/api/claude/today': () => [200, TODAY] });
  const o = await hook('offer', S('s6', '/tmp', { source: 'startup' }), { SIKICK_HOME: H, SIKICK_URL: F.url, CLAUDE_PLUGIN_OPTION_SUGGEST_CARDS: 'false' });
  assert.equal(o.out, ''); assert.equal(F.seen.length, 0);
  await F.close(); rm(H);
});

test('session end -> next session start offers the wrap: "w note" = worked on, then the link offer follows', async () => {
  const H = home(), d = repo('fix/login-redirect'), calls = [];
  const F = await fakeSiKick({
    'GET /app/api/claude/today': () => [200, { ...TODAY, cards: [...TODAY.cards, { card: 'sikick:t7', title: 'Fix the redirect tests', project: 'sikick' }] }],
    'POST /app/api/claude/link': (_q, b) => [200, { ok: true, card: b.card }],
    'GET /app/api/claude/status': (_q, _b, u) => [200, { email: 'a@b.c', day: '2026-11-06', today_minutes: 50, session: u.searchParams.get('session') === 's7' ? { card: 'acme:t1', card_title: 'Fix login redirect loop', card_unlogged: 42 } : null }],
    'POST /app/api/claude/done': (_q, b) => { calls.push(b); return [200, { ok: true, card: b.card, finished: b.finish, minutes: 42, to: b.finish ? undefined : '2026-11-07' }]; },
  });
  const env = { SIKICK_HOME: H, SIKICK_URL: F.url };
  await hook('offer', S('s7', d, { source: 'startup' }), env);
  await hook('gate', S('s7', d, { prompt: 'y' }), env);
  await hook('session_end', S('s7', d, { reason: 'prompt_input_exit' }), env);
  assert.ok(JSON.parse(readFileSync(join(H, 'pending.json'), 'utf8'))[d]);
  const o = await hook('offer', S('s8', d, { source: 'startup' }), env);
  assert.match(o.json.systemMessage, /your last session here worked 42 min on "Fix login redirect loop", not logged yet\.  d = done · w \[note\]/);
  const g = await hook('gate', S('s8', d, { prompt: 'w redirect fixed, tests next' }), env);
  assert.equal(g.json.decision, 'block');
  assert.match(g.json.reason, /worked on · 42 min · continues Sat 7 Nov · note kept/);
  assert.match(g.json.reason, /\nSiKick: link this session to "Fix the redirect tests"/);
  assert.deepEqual(calls[0], { session_id: 's7', card: 'acme:t1', finish: false, note: 'redirect fixed, tests next' });
  assert.deepEqual(JSON.parse(readFileSync(join(H, 'pending.json'), 'utf8')), {});
  const g2 = await hook('gate', S('s8', d, { prompt: 'y' }), env);
  assert.match(g2.json.reason, /linked to "Fix the redirect tests"/);
  await F.close(); rm(H); rm(d);
});

test('offline: events wait locally and go with the next one, with their own time', async () => {
  const H = home(), F = await fakeSiKick(), port = new URL(F.url).port; await F.close();
  const env = { SIKICK_HOME: H, SIKICK_URL: `http://127.0.0.1:${port}` };
  await hook('tool', S('s9', '/tmp', { tool_name: 'Edit' }), env);
  await hook('tool', S('s9', '/tmp', { tool_name: 'Read' }), env);
  assert.equal(readFileSync(join(H, 'queue.jsonl'), 'utf8').trim().split('\n').length, 2);
  const st = await cli(['status', '--session', 's9'], env);
  assert.match(st.out, /unreachable at http:\/\/127\.0\.0\.1/); assert.match(st.out, /2 events waiting on this computer/);
  // SiKick is back (same port)
  const { createServer } = await import('node:http'); const got = [];
  const srv = createServer((q, r) => { let b = ''; q.on('data', c => (b += c)); q.on('end', () => { got.push(JSON.parse(b)); r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}'); }); });
  await new Promise(r => srv.listen(+port, '127.0.0.1', r));
  await hook('stop', S('s9', '/tmp'), env);
  assert.equal(got.length, 1); assert.equal(got[0].events.length, 3); assert.ok(got[0].sent_at);
  assert.deepEqual(got[0].events.map(e => e.type), ['tool', 'tool', 'stop']);
  assert.equal(readFileSync(join(H, 'queue.jsonl'), 'utf8').trim(), '');
  await new Promise(r => srv.close(r)); rm(H);
});

test('token rejected (401): queued, said once at session start, the CLI says what to do', async () => {
  const H = home(), F = await fakeSiKick({ 'POST /app/api/claude/events': () => [401, { error: 'token' }], 'GET /app/api/claude/status': () => [401, { error: 'token' }] });
  writeFileSync(join(H, 'token.meta.json'), JSON.stringify({ base: 'https://www.sikick.si' }));
  const env = { SIKICK_HOME: H, SIKICK_URL: F.url };
  await hook('tool', S('s10', '/tmp', { tool_name: 'Edit' }), env);
  assert.ok(existsSync(join(H, 'queue.jsonl')));
  const o = await hook('offer', S('s10', '/tmp', { source: 'startup' }), env);
  assert.match(o.json.systemMessage, /rejected your token/);
  const o2 = await hook('offer', S('s11', '/tmp', { source: 'startup' }), env);
  assert.ok(!/rejected/.test(o2.out), 'not again within 6 h');
  const st = await cli(['status', '--session', 's10'], env);
  assert.match(st.out, /rejected the token/); assert.match(st.out, /saved for https:\/\/www\.sikick\.si, but the plugin talks to http:\/\/127/);
  await F.close(); rm(H);
});

test('a non-https address: nothing is sent, the token never leaves', async () => {
  const H = home(), F = await fakeSiKick();
  const env = { SIKICK_HOME: H, SIKICK_URL: F.url.replace('127.0.0.1', 'sikick-test.example') };
  await hook('tool', S('s12', '/tmp', { tool_name: 'Edit' }), env);
  const o = await hook('offer', S('s12', '/tmp', { source: 'startup' }), env);
  assert.match(o.json.systemMessage, /must be https/);
  const st = await cli(['today'], env); assert.match(st.out, /must be https/);
  assert.equal(F.seen.length, 0);
  await F.close(); rm(H);
});

test('pause: the session sends nothing (also when SiKick is down), and no offers', async () => {
  const H = home(), F = await fakeSiKick({ 'POST /app/api/claude/pause': () => [200, { ok: true }], 'GET /app/api/claude/today': () => [200, TODAY] });
  const env = { SIKICK_HOME: H, SIKICK_URL: F.url };
  const p = await cli(['pause', '--session', 's13'], env); assert.match(p.out, /^Paused/);
  const n = F.seen.length;
  await hook('tool', S('s13', '/tmp', { tool_name: 'Edit' }), env);
  await hook('prompt', S('s13', '/tmp', { prompt: 'hi' }), env);
  const o = await hook('offer', S('s13', '/tmp', { source: 'resume' }), env);
  const pr = await cli(['progress', 'x', '--session', 's13'], env); assert.match(pr.out, /paused/);
  assert.equal(F.seen.length, n); assert.equal(o.out, '');
  await F.close(); rm(H);
});

test('CLI done --today: the worked-on record, where it continues', async () => {
  const H = home(), calls = [], F = await fakeSiKick({ 'POST /app/api/claude/done': (_q, b) => { calls.push(b); return [200, { ok: true, card: 'acme:t1', title: 'Fix login', finished: false, minutes: 25, to: b.to || '2026-11-09' }]; } });
  const env = { SIKICK_HOME: H, SIKICK_URL: F.url };
  const a = await cli(['done', '--today', '--session', 's14', '--', 'half way'], env);
  assert.match(a.out, /Worked on \(not finished\): "Fix login" · 25 min logged · note: "half way" · continues Mon 9 Nov\./);
  await cli(['done', '--today', '--to', 'plan', '--session', 's14'], env);
  assert.equal(calls[1].to, 'plan'); assert.equal(calls[0].to, undefined);
  const bad = await cli(['done', '--today', '--to', 'someday', '--session', 's14'], env); assert.match(bad.out, /--to is/);
  await F.close(); rm(H);
});

test('CLI todos / wrap: the TODO scan is local (git diff), nothing of it is sent', async () => {
  const { execFileSync } = await import('node:child_process');
  const d = mkdtempSync(join(tmpdir(), 'sikick-git-')), g = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
  g('init', '-q'); g('config', 'user.email', 't@t.t'); g('config', 'user.name', 't');
  writeFileSync(join(d, 'a.js'), 'x\n'); g('add', '.'); g('commit', '-qm', 'i');
  writeFileSync(join(d, 'a.js'), 'x\n// TODO: handle the empty list\n');
  const H = home(), F = await fakeSiKick({ 'GET /app/api/claude/status': () => [200, { session: { card: 'acme:t1', card_title: 'Fix login', card_minutes: 30, card_unlogged: 30 } }] });
  const t = await cli(['todos'], { SIKICK_HOME: H, SIKICK_URL: F.url }, d);
  assert.match(t.out, /1\. TODO: handle the empty list  \(a\.js\)/);
  const w = await cli(['wrap', '--session', 's15'], { SIKICK_HOME: H, SIKICK_URL: F.url }, d);
  assert.match(w.out, /Linked card: "Fix login" \{acme:t1\} · 30 min on it today · 30 min not logged yet/);
  assert.match(w.out, /handle the empty list/);
  assert.ok(!JSON.stringify(F.seen).includes('empty list'));
  await F.close(); rm(H); rm(d);
});

test('flow MCP: lists its tools, answers today, a failure is a tool error with what to do', async () => {
  const { spawn } = await import('node:child_process');
  const H = home(), F = await fakeSiKick({ 'GET /app/api/claude/today': () => [200, TODAY], 'POST /app/api/claude/done': () => [401, { error: 'token' }] });
  const p = spawn(process.execPath, [join(new URL('../plugins/sikick/mcp/server.mjs', import.meta.url).pathname)], { env: { ...process.env, SIKICK_HOME: H, SIKICK_URL: '', SIKICK_PLUGIN_URL: F.url } });
  let buf = ''; const got = new Map(); p.stdout.on('data', d => { buf += d; for (const l of buf.split('\n').slice(0, -1)) { const m = JSON.parse(l); got.set(m.id, m); } buf = buf.slice(buf.lastIndexOf('\n') + 1); });
  const send = (id, method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  send(1, 'initialize', { protocolVersion: '2025-06-18' }); send(2, 'tools/list'); send(3, 'tools/call', { name: 'today', arguments: {} }); send(4, 'tools/call', { name: 'mark_done', arguments: { session_id: 's', finish: false, to: 'plan' } });
  for (let i = 0; i < 50 && got.size < 4; i++) await new Promise(r => setTimeout(r, 50));
  p.kill();
  assert.equal(got.get(1).result.serverInfo.version, '0.3.0');
  assert.deepEqual(got.get(2).result.tools.map(t => t.name), ['next_card', 'today', 'card_context', 'mark_done', 'new_card', 'progress']);
  assert.match(got.get(3).result.content[0].text, /Fix login redirect loop/);
  assert.equal(got.get(4).result.isError, true); assert.match(got.get(4).result.content[0].text, /rejected the token/);
  assert.equal(F.seen.find(x => x.path === '/app/api/claude/done').body.to, 'plan');
  await F.close(); rm(H);
});
