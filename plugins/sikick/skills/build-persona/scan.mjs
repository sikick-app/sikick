#!/usr/bin/env node
// build-persona, step 1: read ~/.claude/projects/**/*.jsonl LOCALLY and print a digest for Claude to build the profile
// from: counts (projects, sessions, active days, hours of day, tools, file types) and a small sample of the person's own
// prompts (shortened, obvious secrets masked). Nothing leaves this machine here; the digest is never uploaded.
//   node scan.mjs [--days 90] [--samples 80] [--dir ~/.claude/projects]
import { readdirSync, statSync, createReadStream } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = +arg('days', 90), SAMPLES = +arg('samples', 80), ROOT = arg('dir', join(homedir(), '.claude', 'projects'));
const since = Date.now() - DAYS * 86_400_000;
const mask = (s) => s
  .replace(/\b(sk|skc|sct|sk_sess|ghp|gho|xox[abp]|AKIA)[-_][\w-]{8,}/g, '[key]')
  .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[email]')
  .replace(/\b(?:\d[ -]?){13,19}\b/g, '[number]')
  .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[secret]');

function files(dir, out = []) {
  let ents = []; try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'subagents' && e.name !== 'memory' && e.name !== 'tool-results') files(p, out); }
    else if (e.name.endsWith('.jsonl')) { try { if (statSync(p).mtimeMs >= since) out.push(p); } catch {} }
  }
  return out;
}

const projects = {}, tools = {}, exts = {}, hours = Array(24).fill(0), weekdays = Array(7).fill(0), days = new Set(), lens = [], prompts = [];
let sessions = 0, interrupts = 0;
for (const f of files(ROOT)) {
  sessions++;
  const rl = createInterface({ input: createReadStream(f), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length > 400_000) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain || (j.type !== 'user' && j.type !== 'assistant')) continue;
    const ts = Date.parse(j.timestamp || ''); if (!(ts >= since)) continue;
    const c = j.message?.content;
    if (j.type === 'assistant' && Array.isArray(c)) {
      for (const b of c) if (b?.type === 'tool_use') {
        tools[b.name] = (tools[b.name] || 0) + 1;
        const fp = b.input?.file_path; if (typeof fp === 'string') { const x = extname(fp) || basename(fp); exts[x] = (exts[x] || 0) + 1; }
      }
      continue;
    }
    if (j.userType && j.userType !== 'external') continue;
    if (j.isMeta || j.isCompactSummary || j.isVisibleInTranscriptOnly) continue;
    const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b?.type === 'text').map(b => b.text).join('\n') : '';
    if (!txt || /^\s*</.test(txt) || (Array.isArray(c) && c.some(b => b?.type === 'tool_result'))) continue;
    if (/^\[Request interrupted/.test(txt)) { interrupts++; continue; }
    const d = new Date(ts); hours[d.getHours()]++; weekdays[d.getDay()]++; days.add(d.toISOString().slice(0, 10)); lens.push(txt.length);
    const proj = basename(j.cwd || '') || '?'; projects[proj] = (projects[proj] || 0) + 1;
    prompts.push({ ts, p: proj, t: mask(txt.replace(/\s+/g, ' ').trim()).slice(0, 220) });
  }
}
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ [k]: v }));
lens.sort((a, b) => a - b);
// an even spread over time, not just the latest session
prompts.sort((a, b) => a.ts - b.ts);
const step = Math.max(1, Math.floor(prompts.length / SAMPLES)), sample = prompts.filter((_, i) => i % step === 0).slice(-SAMPLES).map(x => `[${new Date(x.ts).toISOString().slice(0, 10)} ${x.p}] ${x.t}`);
process.stdout.write(JSON.stringify({
  note: 'LOCAL digest for building the persona. Do not upload this; upload only the approved sikick.persona/v1 profile.',
  window_days: DAYS, sessions, active_days: days.size, prompts: prompts.length, interrupts,
  prompt_chars: lens.length ? { median: lens[lens.length >> 1], p90: lens[Math.floor(lens.length * 0.9)] } : null,
  hours_of_day: hours, weekdays_sun_first: weekdays,
  projects: top(projects, 15), tools: top(tools, 15), file_types: top(exts, 15),
  sample_prompts: sample,
}, null, 1) + '\n');
