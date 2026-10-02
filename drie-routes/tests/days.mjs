// Helpers to simulate days of practice through the UI.
export const D = s => new Date(s + 'T09:00:00');
export function addDaysStr(s, n){ const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

export async function gotoTab(page, tab){ await page.click(`[data-act="tab"][data-tab="${tab}"]`); }

// Runs a session of `minutes`; policy(blockInfo) -> 'pass' | 'fail' for checks. Returns log of blocks.
export async function runSession(page, minutes, policy, opts = {}){
  await gotoTab(page, 'vandaag');
  await page.click(`[data-act="min"][data-min="${minutes}"]`);
  const plan = await page.$$eval('.plan li', ls => ls.map(l => l.innerText.replace(/\n/g, ' | ')));
  if (!plan.length) return { plan, blocks: [] };
  await page.click('[data-act="start"]');
  const blocks = [];
  for (let guard = 0; guard < 40; guard++){
    await page.waitForTimeout(60);
    if (await page.$('.sum')) break;
    const head = await page.$eval('.blockhead', e => e.innerText.replace(/\n/g, ' ')).catch(() => null);
    if (!head) break;
    const title = await page.$eval('.block h2', e => e.textContent);
    const help = await page.$eval('.help', e => e.innerText.replace(/\n/g, ' '));
    const info = { head, title, help };
    if (await page.$('[data-act="checkok"]')){
      const verdict = policy ? policy(info) : 'pass';
      info.verdict = verdict;
      await page.click(verdict === 'pass' ? '[data-act="checkok"]' : '[data-act="checkbad"]');
      if (verdict !== 'pass'){
        await page.waitForTimeout(60);
        info.failNote = await page.$eval('.actionbar', e => e.innerText.replace(/\n/g, ' ')).catch(() => '');
        if (opts.markBar && await page.$('[data-act="hard"][data-bar="2"][aria-pressed="false"]')) await page.click('[data-act="hard"][data-bar="2"]');
        await page.click('[data-act="next"]');
      }
    } else if (await page.$('[data-act="done"]')){
      await page.clock.fastForward((opts.practiceMin || 3) * 60000);
      await page.click('[data-act="done"]');
    } else break;
    blocks.push(info);
  }
  const summary = await page.$eval('.sum', e => e.innerText.replace(/\s+/g, ' ')).catch(() => null);
  if (await page.$('[data-act="finish"]')) await page.click('[data-act="finish"]');
  return { plan, blocks, summary };
}

export async function newDay(page, dateStr){
  await page.clock.setSystemTime(D(dateStr));
  await gotoTab(page, 'liedjes');
  await gotoTab(page, 'vandaag');
}
