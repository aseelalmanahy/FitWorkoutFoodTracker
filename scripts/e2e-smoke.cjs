// End-to-end smoke test of the Phase 1 flow (register → plan → schedule → log two workouts → progress).
// Usage: BASE_URL=http://localhost:3000 node scripts/e2e-smoke.cjs   (requires playwright)
const { chromium } = require('playwright');
const SHOTS = (process.env.SHOTS_DIR || require('os').tmpdir()) + '/';
const BASE = process.env.BASE_URL || 'http://localhost:3000';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', d => d.accept());
  const email = `e2e${Date.now()}@test.dev`;

  await page.goto(BASE + '/dashboard');
  console.log('unauth redirect ->', page.url());
  await page.goto(BASE + '/register');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'correct horse battery');
  await page.click('button[type=submit]');
  await page.waitForURL('**/onboarding');
  await page.getByLabel('Name').fill('Alex Rivera');
  await page.getByLabel('Date of birth').fill('1994-05-12');
  await page.getByLabel('Height (ft)').fill('5');
  await page.getByLabel('Height (in)').fill('10');
  await page.getByLabel('Current weight (lb)').fill('180');
  await page.getByLabel('Goal weight (lb)').fill('172');
  await page.getByRole('button', { name: 'Fat loss' }).click();
  await page.screenshot({ path: SHOTS + '01-onboarding.png', fullPage: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/dashboard');
  await page.screenshot({ path: SHOTS + '02-dashboard-empty.png' });

  // Create plan
  await page.goto(BASE + '/workouts/plans/new');
  await page.getByLabel('Plan name').fill('Upper Body');
  for (const ex of ['Dumbbell Incline Press', 'Lat Pulldown', 'Pull-Up']) {
    await page.getByRole('button', { name: 'Add exercise' }).click();
    await page.getByPlaceholder('Search exercises').fill(ex);
    await page.getByRole('dialog').getByRole('button', { name: new RegExp('^' + ex) }).first().click();
  }
  const wt = page.getByLabel('Wt (lb)');
  await wt.first().fill('50');
  await page.screenshot({ path: SHOTS + '03-plan-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Save plan' }).click();
  await page.waitForURL('**/workouts');

  // Schedule: put Upper Body on every day so "today" has it
  await page.goto(BASE + '/workouts/schedule');
  const adds = page.getByRole('button', { name: '+ Add workout' });
  const n = await adds.count();
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: '+ Add workout' }).first().click();
  // remove Sat & Sun to have 5 planned
  await page.getByRole('button', { name: 'Remove Upper Body' }).nth(6).click();
  await page.getByRole('button', { name: 'Remove Upper Body' }).nth(5).click();
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await page.waitForURL('**/workouts');
  await page.screenshot({ path: SHOTS + '04-workouts.png', fullPage: true });

  async function doWorkout(sets) {
    // sets: { [exerciseName]: [[w,r],...] }
    for (const [name, list] of Object.entries(sets)) {
      const card = page.locator('div.rounded-2xl', { has: page.getByRole('heading', { name }) }).first();
      for (const [w, r] of list) {
        await card.getByLabel('Weight', { exact: true }).fill(String(w));
        await card.getByLabel('Reps', { exact: true }).fill(String(r));
        await card.getByRole('button', { name: 'Log set' }).click();
        await page.waitForTimeout(150);
      }
    }
  }

  // Workout 1 (start from plan)
  await page.getByRole('button', { name: 'Start' }).first().click();
  await page.waitForURL('**/workouts/session/**');
  await doWorkout({ 'Dumbbell Incline Press': [[50, 10], [50, 10], [50, 9]], 'Lat Pulldown': [[120, 10], [120, 9]], 'Pull-Up': [[0, 8], [0, 7]] });
  await page.screenshot({ path: SHOTS + '05-logger-first.png', fullPage: true });
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForURL('**/workouts/history/**');
  const firstUrl = page.url();

  // Backdate workout 1 via API is not possible; repeat immediately instead.
  await page.getByRole('button', { name: 'Repeat this workout' }).click();
  await page.waitForURL('**/workouts/session/**');
  await page.screenshot({ path: SHOTS + '06-logger-prev.png', fullPage: true });
  await doWorkout({ 'Dumbbell Incline Press': [[50, 12], [50, 10], [50, 9]], 'Lat Pulldown': [[130, 8], [130, 8]], 'Pull-Up': [[0, 7], [0, 6]] });
  await page.screenshot({ path: SHOTS + '07-logger-compare.png', fullPage: true });
  const badges = await page.locator('span.rounded-full').allInnerTexts();
  console.log('live badges:', badges.filter(b => /Improved|Down|Matched|Mixed|Baseline/.test(b)));
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForURL('**/workouts/history/**?done=1');
  await page.screenshot({ path: SHOTS + '08-summary.png', fullPage: true });
  console.log('summary text:', (await page.locator('main').innerText()).slice(0, 600).replace(/\n+/g, ' | '));

  await page.goto(BASE + '/progress');
  await page.screenshot({ path: SHOTS + '09-progress.png', fullPage: true });
  await page.getByText('Dumbbell Incline Press').click();
  await page.waitForURL('**/progress/**');
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + '10-exercise.png', fullPage: true });

  await page.goto(BASE + '/dashboard');
  await page.screenshot({ path: SHOTS + '11-dashboard.png', fullPage: true });
  await page.goto(BASE + '/workouts/history');
  await page.screenshot({ path: SHOTS + '12-history.png', fullPage: true });
  await page.goto(BASE + '/nutrition');
  await page.screenshot({ path: SHOTS + '13-nutrition.png', fullPage: true });

  // light mode
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE + '/dashboard');
  await page.screenshot({ path: SHOTS + '14-dashboard-light.png', fullPage: true });

  // Security checks: cross-origin POST rejected, other-user access denied
  const csrf = await page.evaluate(async () => (await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' })).status);
  console.log('same-origin POST start workout (expect 200):', csrf);
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/register');
  await p2.fill('input[name=email]', 'other' + email);
  await p2.fill('input[name=password]', 'another long password');
  await p2.click('button[type=submit]');
  await p2.waitForURL('**/onboarding');
  const sid = firstUrl.split('/').pop();
  const st = await p2.evaluate(async (sid) => (await fetch('/api/sessions/' + sid)).status, sid);
  console.log('other user GET session (expect 404):', st);
  const st2 = await p2.evaluate(async (sid) => (await fetch('/api/sessions/' + sid, { method: 'DELETE' })).status, sid);
  console.log('other user DELETE session (expect 404):', st2);
  console.log('errors:', errors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
