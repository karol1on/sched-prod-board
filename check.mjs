// Acceptance check for SCHED-4511..4514 and R6, against any served build of the board.
// The incident API is faked in the browser, so every run sees the same incidents and a new one mid-run.
// Usage: node check.mjs <board url>   (exit 1 on the first failed check)
import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) throw new Error('usage: node check.mjs <board url>');

const base = [
  { id: 'INC-1', service: 'auth', region: 'eu-west', summary: 'older one', severity: 'sev3', openedAt: '2026-11-12T03:03:00.000Z' },
  { id: 'INC-2', service: 'payments', region: 'us-east', summary: 'newer one', severity: 'sev1', openedAt: '2026-11-12T04:04:00.000Z' },
];
const late = { id: 'INC-3', service: 'reminders', region: 'eu-west', summary: 'arrives later', severity: 'sev2', openedAt: '2026-11-12T05:05:00.000Z' };

async function fakeApi(context) {
  let calls = 0;
  const acked = [];
  await context.route('**/challenges/show-me-when/api/incidents*', async (route) => {
    calls += 1;
    if (calls === 1) await new Promise((r) => setTimeout(r, 800)); // slow first answer, so the loader is visible
    const incidents = calls >= 3 ? [late, ...base] : [...base];
    // like the course API, openedAt can change between answers: from the 4th answer INC-2 says 04:14
    if (calls >= 4) incidents[incidents.findIndex((i) => i.id === 'INC-2')] = { ...base[1], openedAt: '2026-11-12T04:14:00.000Z' };
    incidents.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    await route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents, cursor: `c${calls}` } });
  });
  await context.route('**/challenges/show-me-when/api/ack*', async (route) => {
    const id = new URL(route.request().url()).searchParams.get('id');
    acked.push(id);
    await route.fulfill({ json: { id, ackedAt: new Date().toISOString(), receipt: `fake-${id}` } });
  });
  return acked;
}

function check(ok, what) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL }); // PW_CHANNEL=chrome uses the installed Chrome
try {
  // Berlin viewer: loader, live list, ack, build sha
  const berlin = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const acked = await fakeApi(berlin);
  const page = await berlin.newPage();
  await page.goto(url);

  check(await page.getByTestId('loader').isVisible().catch(() => false), 'SCHED-4512 loader shows on open');
  await page.getByTestId('incident-row').first().waitFor({ timeout: 5000 }).catch(() => {});
  check((await page.getByTestId('loader').count()) === 0 || !(await page.getByTestId('loader').isVisible()), 'SCHED-4512 loader gone once incidents show');

  const ids = () => page.getByTestId('incident-row').evaluateAll((rows) => rows.map((r) => r.dataset.id));
  check(JSON.stringify(await ids()) === '["INC-2","INC-1"]', 'SCHED-4511 rows newest first');

  // Ack like a person (SCHED-4515): aim at INC-1's Ack by position, click 300 ms after INC-3 lands.
  const row = page.locator('[data-testid="incident-row"][data-id="INC-1"]');
  const box = await row.getByTestId('ack').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.waitForFunction(() => document.querySelector('[data-testid="new-bar"]')?.checkVisibility?.({ visibilityProperty: true }) || document.querySelector('[data-testid="incident-row"]')?.dataset.id === 'INC-3', null, { timeout: 7000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const markShown = await row.getByTestId('acked').waitFor({ timeout: 3000 }).then(() => true, () => false);
  check(markShown && JSON.stringify(acked) === '["INC-1"]', `SCHED-4511/4515 an Ack clicked by position as an incident lands acks the row meant (acked ${JSON.stringify(acked)})`);

  check(JSON.stringify(await ids()) === '["INC-2","INC-1"]', 'SCHED-4515 the list holds still while a new incident waits');
  const bar = page.getByTestId('new-bar');
  check((await bar.isVisible()) && /1 new/.test(await bar.textContent()), 'SCHED-4515 the "N new" bar shows the count');
  await bar.click({ timeout: 2000 }).catch(() => {});
  check(JSON.stringify(await ids()) === '["INC-3","INC-2","INC-1"]' && !(await bar.isVisible()), 'SCHED-4515 a click on the bar puts the new incident on top and hides the bar');
  check((await page.locator('[data-testid="incident-row"][data-id="INC-3"] [data-testid="ack"]').count()) === 1, 'SCHED-4515 Ack stays on the new row');
  await page.waitForTimeout(2500); // one more refresh
  check((await row.getByTestId('acked').count()) === 1, 'SCHED-4511 acked mark survives a refresh');

  const inc2 = page.locator('[data-testid="incident-row"][data-id="INC-2"] time');
  check((await inc2.getAttribute('datetime')) === '2026-11-12T04:14:00.000Z' && /05:14/.test(await inc2.textContent()), 'SCHED-4513 a refresh updates a row that changed (openedAt 04:04 -> 04:14)');

  const meta = await page.locator('meta[name="build"]').getAttribute('content').catch(() => null);
  const footer = (await page.getByTestId('build-sha').textContent().catch(() => '')).trim();
  check(/^[0-9a-f]{40}$/.test(meta ?? '') && meta === footer, `R6 build sha in meta and footer (${meta})`);

  const berlinTime = await row.locator('time').textContent();
  check((await row.locator('time').getAttribute('datetime')) === '2026-11-12T03:03:00.000Z', 'SCHED-4514 full UTC kept in <time datetime>');
  check(/12\.11\.\d+.*04:03/.test(berlinTime), `SCHED-4514 Berlin sees 12.11 04:03 (got "${berlinTime}")`);
  await berlin.close();

  // A quiet night: no incidents
  const quiet = await browser.newContext();
  await quiet.route('**/challenges/show-me-when/api/incidents*', (route) => route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: [], cursor: 'q' } }));
  const q = await quiet.newPage();
  await q.goto(url);
  const emptyShown = await q.getByTestId('empty').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(emptyShown && !(await q.getByTestId('loader').isVisible().catch(() => false)), 'SCHED-4512 no incidents: loader gone, empty state shows');
  await quiet.close();

  // Auckland viewer: same incident, own zone and order
  const auckland = await browser.newContext({ locale: 'en-NZ', timezoneId: 'Pacific/Auckland' });
  await fakeApi(auckland);
  const nz = await auckland.newPage();
  await nz.goto(url);
  const nzTime = await nz.locator('[data-testid="incident-row"][data-id="INC-1"] time').textContent({ timeout: 5000 }).catch(() => '');
  check(/12\/11\/\d+.*4:03/i.test(nzTime), `SCHED-4514 Auckland sees 12/11 4:03 pm (got "${nzTime}")`);
  await auckland.close();
} finally {
  await browser.close();
}
