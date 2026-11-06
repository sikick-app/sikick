// Which card on My day fits this session: scored here, on this machine, from the folder name, the git branch, the
// cards you linked here before and (on the first prompt) the prompt's words. Nothing of that is sent anywhere.
const STOP = new Set(('the and for with from into onto that this then than what when where which while your you our are was were will '
  + 'fix fixes feat feature chore wip main master dev develop release hotfix refactor update updates add new old src app apps web site '
  + 'test tests spec code claude please can could would should make let get set use using need want just also more some all any '
  + 'not but have has had its it\'s them they there here about after before again only like look see sure thanks thank okay').split(' '));

export function words(s) {
  return [...new Set(String(s || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
    .split(/[^a-z0-9äöüßéèàçñ]+/i)
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter(w => (w.length >= 3 || /^\d{2,}$/.test(w)) && !STOP.has(w) && !/^\d{1}$/.test(w)))];
}

/** cards: My day's cards (+ did not fit), {card, title, project?, done?, now?}. ctx: {repo, dir, branch, prompt, links, next}.
 *  -> [{card, title, score, why}] best first (done cards left out) */
export function rank(cards, ctx = {}) {
  const repoW = words(ctx.repo), branchW = words(ctx.branch), promptW = words(ctx.prompt).slice(0, 60);
  const mem = ctx.links || {}, memB = mem[`${ctx.dir}#${ctx.branch || ''}`], memD = mem[`${ctx.dir}#`];
  const out = [];
  for (const c of cards || []) {
    if (!c || !c.card || c.done) continue;
    const titleW = words(c.title), projW = words(c.project), all = new Set([...titleW, ...projW]);
    let score = 0; const why = [];
    if (memB && memB.card === c.card && ctx.branch) { score += 10; why.push(`you linked branch ${ctx.branch} to it before`); }
    else if (memD && memD.card === c.card) { score += 4; why.push('you linked this folder to it before'); }
    const rp = repoW.filter(w => all.has(w)); if (rp.length) { score += 3 * rp.length; why.push(`matches ${ctx.repo}`); }
    const br = branchW.filter(w => titleW.includes(w) || projW.includes(w)); if (br.length) { score += 2.5 * br.length; why.push(`matches branch ${ctx.branch}`); }
    const pr = promptW.filter(w => all.has(w)); if (pr.length) { score += 1.5 * Math.min(pr.length, 4); why.push('matches what you asked'); }
    if (c.now) { score += 1; if (!why.length) why.push('on now in My day'); }
    if (ctx.next && ctx.next === c.card) { score += 0.5; if (!why.length) why.push('next in My day'); }
    if (score > 0) out.push({ card: c.card, title: c.title, project: c.project || '', score: Math.round(score * 10) / 10, why: why[0] || '' });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** the one card to suggest, or null: a real match (>= 2.5), else the card on now / next (a weaker "on now" offer) */
export function suggest(cards, ctx = {}) {
  const r = rank(cards, ctx);
  if (!r.length) return null;
  const top = r[0];
  return { ...top, strong: top.score >= 2.5, others: r.slice(1, 4) };
}

/** a prompt that answers an offer: {act: 'yes'|'no'|'done'|'worked', note} or null.
 *  bare = the very first prompt of a fresh session (y / n / d / w …); otherwise only with the "sk " prefix */
export function answer(prompt, kind, bare) {
  let p = String(prompt || '').trim();
  const pre = /^sk\s+/i.exec(p);
  if (pre) p = p.slice(pre[0].length); else if (!bare) return null;
  if (p.length > 300 || p.includes('\n')) return null;
  if (kind === 'link') {
    if (/^(y|yes|ok|link)\.?$/i.test(p)) return { act: 'yes' };
    if (/^(n|no|skip)\.?$/i.test(p)) return { act: 'no' };
    return null;
  }
  if (kind === 'wrap') {
    if (/^(d|done)\.?$/i.test(p)) return { act: 'done', note: '' };
    const w = /^(w|worked)(?:\s+(.+))?$/i.exec(p); if (w) return { act: 'worked', note: (w[2] || '').trim() };
    if (/^(n|no|skip|leave)\.?$/i.test(p)) return { act: 'no' };
    return null;
  }
  return null;
}

// a prompt that sounds like the end of the work (local check; it only adds a hint for Claude)
export const wrapsUp = (prompt) => /\b(that'?s (all|it) for (now|today)|done for (now|today)|wrap(ping)? (it )?up|call it a day|signing off|end (of|the) session|finish(ed)? for today|i'?m done|good ?night|bye)\b/i.test(String(prompt || ''));

// TODO / FIXME lines added in the working tree (from `git diff` text): candidates for follow-up cards, never sent
export function todosFromDiff(diff) {
  const out = []; let file = '';
  for (const l of String(diff || '').split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(l); if (f) { file = f[1]; continue; }
    if (!l.startsWith('+') || l.startsWith('+++')) continue;
    const m = /\b(TODO|FIXME|XXX|HACK)\b[:(\s-]*(.*)$/.exec(l);
    if (m) { const text = m[2].replace(/\)?\s*(\*\/|-->|#}|%>)\s*$/, '').trim(); if (text.length >= 3) out.push({ file, tag: m[1], text: text.slice(0, 200) }); }
  }
  return out.slice(0, 30);
}
