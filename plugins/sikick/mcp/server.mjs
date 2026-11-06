#!/usr/bin/env node
// SiKick "flow" MCP (stdio, no dependencies): the tools SiKick's account MCP (<SiKick>/mcp: my_day, my_cards, get_card,
// suggest_cards, capture_to_personal, …) does not have yet, for working in Claude Code:
//   next_card, card_context, mark_done (done / today-done with worked minutes + note), new_card, progress.
// They call <SiKick>/app/api/claude/* with the Claude Code token (~/.sikick/token). Newline-delimited JSON-RPC 2.0.
import { createInterface } from 'node:readline';
import { call, failText, VERSION } from '../scripts/lib.mjs';

const S = (description) => ({ type: 'string', description });
const SESSION = S('the Claude Code session id (${CLAUDE_SESSION_ID}); links to the card set with /sikick:start');
const TOOLS = [
  { name: 'next_card', description: "The next card on the person's SiKick day (My day): what to work on now, with its card key.", inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'today', description: "The person's SiKick day: every card block with time, project, done state, what did not fit, and the next one.", inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'card_context', description: 'One SiKick card in full (title, notes, status, comments, history). Omit card to use the card linked to this session.', inputSchema: { type: 'object', properties: { card: S('card key "ws:id" (own tasks: "own:<id>")'), session_id: SESSION } }, annotations: { readOnlyHint: true } },
  { name: 'mark_done', description: 'Finish a SiKick card (finish=true, default) or record it as worked on, not finished (finish=false: the same "worked on" record as SiKick\'s ↻ on My day; the card continues on `to`, default the next working day, and the note shows on it next time). Worked minutes default to the time this session tracked on the card and not logged yet. Ask the person first, every time.', inputSchema: { type: 'object', properties: { card: S('optional card key; default the session\'s linked card'), session_id: SESSION, minutes: { type: 'number', description: 'worked minutes (optional)' }, note: S('one line: what was done / where it stands'), finish: { type: 'boolean', description: 'true = done, false = worked on, not finished' }, to: S('finish=false only: where it continues: "tomorrow" (next working day, default), "plan" (back to To plan), "stay" (stays on today), or a date YYYY-MM-DD') } } },
  { name: 'new_card', description: "Add a card: to the person's own day (default) or, with project, to that project's New from chat for a person to file.", inputSchema: { type: 'object', properties: { title: S('short, concrete'), notes: S('optional details'), project: S('optional project slug (else: your day)'), column: S("optional: one of the person's own My cards columns by name (today -> my_columns), only when it clearly fits; never invent one"), session_id: SESSION }, required: ['title'] } },
  { name: 'progress', description: 'A one-line progress update on the session (shown on the card in My day). Brief, now and then: not every step.', inputSchema: { type: 'object', properties: { note: S('one line'), session_id: SESSION }, required: ['note', 'session_id'] } },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }], ...(isError ? { isError: true } : {}) });
async function run(name, a = {}) {
  const res = (r) => (r.ok ? text(r.json) : text(failText(r), true));
  const sid = a.session_id || '';
  switch (name) {
    case 'next_card': return res(await call('/app/api/claude/next'));
    case 'today': return res(await call('/app/api/claude/today'));
    case 'card_context': return res(await call(`/app/api/claude/card?${new URLSearchParams({ ...(a.card ? { card: a.card } : {}), ...(sid ? { session: sid } : {}) })}`));
    case 'mark_done': return res(await call('/app/api/claude/done', { method: 'POST', timeout: 15000, body: { session_id: sid, card: a.card, minutes: a.minutes, note: a.note || '', finish: a.finish !== false, ...(a.finish === false && /^(plan|stay|\d{4}-\d{2}-\d{2})$/.test(String(a.to || '')) ? { to: a.to } : {}) } }));
    case 'new_card': return res(await call('/app/api/claude/new', { method: 'POST', body: { session_id: sid, title: a.title, notes: a.notes, project: a.project, ...(a.column ? { column: a.column } : {}) } }));
    case 'progress': return res(await call('/app/api/claude/events', { method: 'POST', body: { type: 'progress', session_id: sid, note: String(a.note || '').slice(0, 500) } }));
    default: return text(`unknown tool ${name}`, true);
  }
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input: process.stdin }).on('line', async (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  const ok = (result) => send({ jsonrpc: '2.0', id: m.id, result });
  try {
    if (m.method === 'initialize') return ok({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sikick-flow', version: VERSION } });
    if (m.method === 'tools/list') return ok({ tools: TOOLS });
    if (m.method === 'tools/call') return ok(await run(m.params?.name, m.params?.arguments));
    if (m.method === 'ping') return ok({});
    if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
  } catch (e) { if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(e?.message || e) } }); }
});
