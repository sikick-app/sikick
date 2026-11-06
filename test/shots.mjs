// screenshots of My day on the e2e copy (used by e2e-local.mjs --shots <dir>): desktop 1440 + 1024 dark / light, phone 390 dark / light.
// Also checks: no console errors, no horizontal overflow.
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const PW = [process.env.SIKICK_E2E_PLAYWRIGHT].find(p => p && existsSync(p));
const CHROME = process.env.SIKICK_E2E_CHROME || '';
const VIEWS = [
  ['desktop-dark', { viewport: { width: 1440, height: 900 } }, 'dark'], ['desktop-light', { viewport: { width: 1440, height: 900 } }, 'light'],
  ['d1024-dark', { viewport: { width: 1024, height: 800 } }, 'dark'],
  ['phone-dark', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'dark'], ['phone-light', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'light'],
];
export async function shots(base, dir, log = console.log, label = 'myday') {
  if (!PW || !existsSync(CHROME)) { log('      (no playwright / chrome: shots skipped)'); return; }
  mkdirSync(dir, { recursive: true });
  const { chromium } = require(PW), b = await chromium.launch({ executablePath: CHROME });
  const problems = [];
  try {
    for (const [name, view, mode] of VIEWS) {
      const ctx = await b.newContext({ ...view, colorScheme: mode, reducedMotion: 'reduce', locale: 'en-GB' });
      await ctx.addCookies([{ name: 'sk_mode', value: mode, domain: new URL(base).hostname, path: '/' }]);
      const p = await ctx.newPage(), errs = [];
      p.on('console', m => { const t = m.text() + ' @' + (m.location()?.url || ''); if (m.type() === 'error' && !/favicon|fathom\/status/.test(t)) errs.push(t.slice(0, 260)); });
      p.on('pageerror', e => errs.push(e.message));
      await p.goto(base + '/app/', { waitUntil: 'load' }); await p.waitForTimeout(3000);
      const badges = await p.locator('.ck-claude').count();
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const f = join(dir, `${label}-${name}.png`); await p.screenshot({ path: f });
      if (badges && name.startsWith('desktop')) {   // the card row with the badge alone (no other cards of the test data): for the listing
        const row = p.locator('.fl-tl .ck-claude').first().locator('xpath=ancestor::li[1]');
        if (await row.count()) await row.screenshot({ path: join(dir, `${label}-${name}-row.png`) }).catch(() => {});
      }
      log(`      ${label}-${name}: ${badges} Claude badge(s), overflow ${over}px, ${errs.length} console errors`);
      if (over > 0) problems.push(`${name}: horizontal overflow ${over}px`); if (errs.length) problems.push(`${name}: ${errs.join(' | ')}`);
      await ctx.close();
    }
  } finally { await b.close(); }
  if (problems.length) log('      NOTE: ' + problems.join('; '));
  return problems;
}
