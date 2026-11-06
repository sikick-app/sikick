// node --test test/  — pure logic: matching, answers, TODO scan, address checks, the offline queue, the version
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN, home, rm } from './helpers.mjs';
import { words, rank, suggest, answer, todosFromDiff, wrapsUp } from '../plugins/sikick/scripts/match.mjs';

const CARDS = [
  { card: 'acme:t1', title: 'Fix login redirect loop', project: 'acme', now: false },
  { card: 'sikick:t2', title: 'Claude plugin marketplace listing', project: 'sikick', now: true },
  { card: 'own:a1', title: 'Invoices for October', done: false },
  { card: 'acme:t9', title: 'Old thing', project: 'acme', done: true },
];

test('words: splits, drops stop words and short bits, light plural', () => {
  assert.deepEqual(words('feat/fix-login-redirectLoops'), ['login', 'redirect', 'loop']);
  assert.deepEqual(words('the main app'), []);
  assert.ok(words('JIRA-1234 tickets').includes('1234'));
});

test('rank: branch beats "on now"; done cards never suggested', () => {
  const r = rank(CARDS, { repo: 'webapp', branch: 'fix/login-redirect', dir: '/x' });
  assert.equal(r[0].card, 'acme:t1'); assert.match(r[0].why, /branch/);
  assert.ok(!r.some(x => x.card === 'acme:t9'));
});

test('rank: the repo name matches the project', () => {
  const s = suggest(CARDS, { repo: 'claude-plugin', branch: 'main', dir: '/x' });
  assert.equal(s.card, 'sikick:t2'); assert.equal(s.strong, true);
});

test('suggest: nothing matches -> the card on now, marked weak', () => {
  const s = suggest(CARDS, { repo: 'zzz', branch: '', dir: '/x' });
  assert.equal(s.card, 'sikick:t2'); assert.equal(s.strong, false); assert.equal(s.why, 'on now in My day');
});

test('suggest: what you linked here before wins', () => {
  const links = { '/repo#feature-x': { card: 'own:a1', title: 'Invoices for October', at: 1 } };
  const s = suggest(CARDS, { repo: 'login', branch: 'feature-x', dir: '/repo', links });
  assert.equal(s.card, 'own:a1'); assert.match(s.why, /linked branch/);
});

test('suggest: the first prompt can point at a card', () => {
  const s = suggest(CARDS, { repo: 'zzz', dir: '/x', prompt: 'please do the invoices for october' });
  assert.equal(s.card, 'own:a1'); assert.equal(s.strong, true);
});

test('suggest: an empty day -> null', () => { assert.equal(suggest([], {}), null); });

test('answer: bare keys only on the first prompt; "sk" prefix later', () => {
  assert.deepEqual(answer('y', 'link', true), { act: 'yes' });
  assert.equal(answer('y', 'link', false), null);
  assert.deepEqual(answer('sk y', 'link', false), { act: 'yes' });
  assert.deepEqual(answer('N', 'link', true), { act: 'no' });
  assert.equal(answer('yes please fix the bug', 'link', true), null);
  assert.deepEqual(answer('w tests green, docs next', 'wrap', true), { act: 'worked', note: 'tests green, docs next' });
  assert.deepEqual(answer('d', 'wrap', true), { act: 'done', note: '' });
  assert.deepEqual(answer('sk n', 'wrap', false), { act: 'no' });
  assert.equal(answer('done with the refactor?', 'wrap', true), null);
  assert.equal(answer('y\nmore', 'link', true), null);
});

test('wrapsUp: end-of-work phrases only', () => {
  assert.ok(wrapsUp("ok that's all for today"));
  assert.ok(wrapsUp('lets wrap up'));
  assert.ok(!wrapsUp('wrap this function in a try'));
  assert.ok(!wrapsUp('add a done button'));
});

test('todosFromDiff: added TODO / FIXME lines with their file', () => {
  const diff = ['+++ b/src/a.ts', '+  // TODO: retry when offline', '-  // TODO: old one', '+ const x = 1;', '+++ b/web/b.html', '+<!-- FIXME check contrast -->'].join('\n');
  assert.deepEqual(todosFromDiff(diff), [{ file: 'src/a.ts', tag: 'TODO', text: 'retry when offline' }, { file: 'web/b.html', tag: 'FIXME', text: 'check contrast' }]);
});

test('checkUrl: https, or http only for a local test server', async () => {
  const H = home(); process.env.SIKICK_HOME = H;
  const { checkUrl } = await import('../plugins/sikick/scripts/lib.mjs?u=' + Date.now());
  assert.equal(checkUrl('https://www.sikick.si/').kind, 'live');
  assert.equal(checkUrl('https://www.sikick.si/').url, 'https://www.sikick.si');
  assert.equal(checkUrl('http://localhost:3000').kind, 'local');
  assert.equal(checkUrl('https://staging.example.com').kind, 'custom');
  assert.equal(checkUrl('http://staging.example.com').ok, false);
  assert.equal(checkUrl('https://u:p@x.com').ok, false);
  assert.equal(checkUrl('nonsense').ok, false);
  rm(H);
});

test('queue: keeps events per address, capped, cleared', async () => {
  const H = home(); process.env.SIKICK_HOME = H; process.env.SIKICK_URL = 'http://127.0.0.1:9';
  const L = await import('../plugins/sikick/scripts/lib.mjs?q=' + Date.now());
  const ev = (i) => ({ type: 'tool', session_id: 's1', client_at: new Date().toISOString(), i });
  L.enqueue([ev(1), ev(2)]);
  assert.equal(L.queueCount(), 2);
  process.env.SIKICK_URL = 'http://127.0.0.1:10';
  assert.equal(L.queueCount(), 0, 'another SiKick address does not get them');
  process.env.SIKICK_URL = 'http://127.0.0.1:9';
  L.enqueue(Array.from({ length: 2100 }, (_, i) => ev(i)));
  assert.equal(L.queueCount(), 2000);
  L.clearQueue(); assert.equal(L.queueCount(), 0);
  delete process.env.SIKICK_URL; rm(H);
});

test('version: lib, plugin.json and the marketplace agree', async () => {
  const { VERSION } = await import('../plugins/sikick/scripts/lib.mjs');
  const pj = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8'));
  assert.equal(pj.version, VERSION);
  const mk = JSON.parse(readFileSync(join(PLUGIN, '../../.claude-plugin/marketplace.json'), 'utf8'));
  assert.ok(!mk.plugins[0].version || mk.plugins[0].version === VERSION);
});
