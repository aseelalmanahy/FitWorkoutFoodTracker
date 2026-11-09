// Phase 3 in real browsers, on the production build: importing a workout plan from every supported kind of file, and
// refusing hostile ones. Every request the page makes is recorded: a document must never be uploaded; an image (or a
// scanned page) goes once to the reader and comes back as text; only the confirmed draft is saved.
//   BASE_URL=… DATABASE_URL=<designated test database> node scripts/e2e-workout-import.cjs
const assert = require("node:assert/strict");
const playwright = require("playwright");
const { PrismaClient } = require("@prisma/client");
const { createSignedInUser } = require("./lib/test-users.cjs");
const { docx, xlsx, screenshot, textPdf, scannedPdf, zip, PLAN_LINES } = require("./lib/plan-fixtures.cjs");
const target = require("./lib/test-target-guard.cjs").requireSafeTarget();

const BASE = target.baseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: target.databaseUrl } } });
const run = Date.now();
const step = (s) => console.log(`✓ ${s}`);

async function signedIn(browser, label) {
  const { user, token } = await createSignedInUser(prisma, `wimpe2e${label}x${run}@test.dev`);
  await prisma.profile.create({ data: { userId: user.id, name: "Importer", birthDate: new Date("1990-01-01T00:00:00Z"), timezone: "UTC", unitSystem: "METRIC" } });
  const ctx = await target.guardContext(await browser.newContext({ viewport: { width: 1200, height: 900 } }));
  await ctx.addCookies([{ name: "fit_session", value: token, url: BASE, httpOnly: true, sameSite: "Lax", secure: false }]);
  const page = await ctx.newPage();
  const sent = [];
  page.on("request", (r) => { if (r.method() !== "GET") sent.push({ path: new URL(r.url()).pathname, bytes: r.postDataBuffer()?.length ?? 0, head: (r.postDataBuffer() ?? Buffer.alloc(0)).subarray(0, 5).toString("latin1") }); });
  await page.goto(`${BASE}/workouts/import`);
  await page.getByTestId("import-file").waitFor();
  await page.waitForFunction(() => !document.querySelector("[data-testid=import-file]").disabled, null, { timeout: 15000 });
  return { user, page, sent };
}
async function choose(page, name, buffer, mimeType) {
  await page.getByTestId("import-file").setInputFiles({ name, mimeType, buffer });
  await page.waitForFunction(() => !document.querySelector("[data-testid=import-busy]"), null, { timeout: 60000 });
}
const rows = (page) => page.getByTestId("import-row");
const sources = async (page) => (await rows(page).allInnerTexts()).map((t) => /From the plan: (.*)/.exec(t)?.[1] ?? "");
const noDocumentUploaded = (sent, label) => {
  const others = sent.filter((r) => r.path !== "/api/workouts/import" && r.path !== "/api/workouts/import/ocr");
  assert.deepEqual(others.map((r) => r.path), [], `${label}: nothing else was sent`);
  for (const r of sent) assert.ok(!["%PDF-", "PK\u0003\u0004"].includes(r.head), `${label}: no document was uploaded`);
};

async function fullImport(browser) {
  const { user, page, sent } = await signedIn(browser, "full");
  const text = PLAN_LINES.join("\n").replace("RDL 3x10", "RDL 3x10\nNotes: rest as needed\nFace Pull 3x15 @ 20").replace("Pull-Up 3x8", "Pull-Up 3xAMRAP");
  await choose(page, "strength-block.txt", Buffer.from(text), "text/plain");
  assert.equal(await page.getByTestId("import-program").inputValue(), "Strength Block");
  assert.deepEqual(await page.getByTestId("import-day-name").evaluateAll((els) => els.map((e) => e.value)), ["Monday - Upper", "Thursday - Lower"]);
  assert.deepEqual(await page.getByTestId("import-day-weekday").evaluateAll((els) => els.map((e) => e.value)), ["0", "3"]);
  const ready = await rows(page).evaluateAll((els) => els.map((e) => e.dataset.ready));
  assert.deepEqual(ready, ["true", "false", "false", "false", "true"], "bench and Face Pull (weight optional, its unit-less value kept in notes) are ready; AMRAP, Squat and RDL need the person");
  const r = rows(page);
  assert.match(await r.nth(1).innerText(), /Needs: reps/);
  assert.match(await r.nth(1).getByTestId("import-notes").inputValue(), /Reps as written: AMRAP/);
  assert.match(await r.nth(2).innerText(), /Not matched for certain/);
  assert.equal(await r.nth(2).getByTestId("import-weight").inputValue(), "225");
  assert.equal(await r.nth(2).getByTestId("import-unit").inputValue(), "lb");
  assert.match(await r.nth(2).innerText(), /Saved as 102\.06 kg/);
  assert.equal(await r.nth(4).getByTestId("import-weight").inputValue(), "", "a weight with no unit is left empty");
  assert.match(await r.nth(4).getByTestId("import-notes").inputValue(), /no unit: 20/);
  assert.equal(await page.getByTestId("import-save").isDisabled(), true, "nothing can be saved yet");
  step("txt: two days with their stated weekdays; exact matches chosen; AMRAP, an unmatched name and a unit-less weight left for the person; lb shown in kg; save held back");

  await r.nth(1).getByTestId("import-reps-min").fill("6");
  await r.nth(1).getByTestId("import-reps-max").fill("10");
  const suggestion = async (n, label) => r.nth(n).getByTestId("import-exercise").selectOption({ label });
  await suggestion(2, "Back Squat");
  await suggestion(3, "Romanian Deadlift");
  await r.nth(4).getByTestId("import-exercise").selectOption({ label: "Face Pull" });
  await r.nth(4).getByTestId("import-weight").fill("20");
  await r.nth(4).getByTestId("import-unit").selectOption("kg");
  await page.getByTestId("import-save").waitFor({ state: "visible" });
  assert.equal(await page.getByTestId("import-save").isDisabled(), false);
  await page.getByTestId("import-save").click();
  await page.getByTestId("import-saved").waitFor({ timeout: 15000 });
  const plans = await prisma.workoutTemplate.findMany({ where: { userId: user.id }, include: { exercises: { include: { exercise: true }, orderBy: { position: "asc" } }, slots: true }, orderBy: { name: "asc" } });
  assert.deepEqual(plans.map((p) => [p.name, p.slots.map((s) => s.weekday)]), [["Strength Block – Monday - Upper", [0]], ["Strength Block – Thursday - Lower", [3]]]);
  assert.deepEqual(plans[0].exercises.map((e) => [e.exercise.name, e.targetSets, e.targetRepsMin, e.targetRepsMax, e.targetWeightKg]), [["Barbell Bench Press", 4, 6, 8, 80], ["Pull-Up", 3, 6, 10, null]]);
  assert.deepEqual(plans[1].exercises.map((e) => [e.exercise.name, e.targetWeightKg]), [["Back Squat", 102.06], ["Romanian Deadlift", null], ["Face Pull", 20]]);
  assert.equal(plans.every((p) => p.userId === user.id), true);
  noDocumentUploaded(sent, "txt");
  assert.deepEqual(sent.map((s) => s.path), ["/api/workouts/import"], "only the confirmed draft was sent, once");
  step("txt: after the person's choices, two plans saved with exactly the values shown, on their weekdays; the file never left the browser");
}

async function everyFormat(browser, engine) {
  const { page, sent } = await signedIn(browser, `fmt${engine}`);
  const table = [["Strength Block"], ["Day", "Exercise", "Sets", "Reps", "Weight (kg)"], ["Upper", "Barbell Bench Press", "4", "6-8", "80"], ["Lower", "Deadlift", "3", "5", "140"]];
  const cases = [
    ["plan.csv", Buffer.from(table.map((r) => r.join(",")).join("\n")), "text/csv", 2],
    ["plan.docx", docx(["Strength Block", "Monday - Upper", "Barbell Bench Press 4x6-8 @ 80kg", "Pull-Up 3x8"]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 2],
    ["plan.xlsx", xlsx(table), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 2],
    ["plan.pdf", textPdf(["Strength Block", "Monday - Upper", ["Barbell Bench Press", "4", "x", "8"], "Pull-Up 3x8", "Thursday - Lower", "Deadlift 3x5 @ 140kg"]), "application/pdf", 2],
  ];
  if (engine === "chromium") cases.push(
    ["screenshot.png", await screenshot(PLAN_LINES), "image/png", 3],
    ["photo.jpg", await screenshot(PLAN_LINES, { format: "jpeg" }), "image/jpeg", 3],
    ["scan.pdf", await scannedPdf(PLAN_LINES), "application/pdf", 3],
  );
  for (const [name, buffer, mime, atLeast] of cases) {
    const before = sent.length;
    await choose(page, name, buffer, mime);
    const found = await sources(page);
    assert.ok(found.length >= atLeast, `${engine} ${name}: ${found.length} exercises (${await page.locator("body").innerText().then((t) => t.slice(0, 200))})`);
    assert.ok(found.some((s) => /Bench Press/i.test(s)), `${engine} ${name}: the bench press was read`);
    const mine = sent.slice(before);
    if (/\.(png|jpg)$|scan/.test(name)) assert.deepEqual(mine.map((r) => r.path), ["/api/workouts/import/ocr"], `${name}: one image read as text`);
    else assert.deepEqual(mine, [], `${name}: nothing sent`);
  }
  noDocumentUploaded(sent, engine);
  step(`${engine}: ${cases.map((c) => c[0]).join(", ")} each read into a draft; documents never left the browser${engine === "chromium" ? "; images and the scanned page were read once each, as text" : ""}`);
}

async function hostile(browser) {
  const { page, sent } = await signedIn(browser, "hostile");
  const bomb = "a".repeat(9 * 1024 * 1024);
  const cases = [
    ["bomb.docx", zip({ "word/document.xml": bomb }, { lie: true }), /too large or damaged/],
    ["big.docx", zip({ "word/document.xml": bomb }), /too large/],
    ["locked.docx", docx(["Squat 3x5"]).length && zip({ "word/document.xml": "<w:document/>" }, { encrypt: true }), /encrypted/],
    ["program.exe.pdf", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), /isn't supported/],
    ["page.pdf", Buffer.from(["<html><img src=x onerror=\"window.__xss=1\"><script>window.__xss=1</script>", "Squat 3x5 <b onmouseover=window.__xss=1>x</b></html>"].join("\n")), null],
    ["huge.txt", Buffer.alloc(11 * 1024 * 1024, 65), /too large/],
    ["broken.pdf", Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n"), /PDF/],
    ["other.zip", zip({ "readme.txt": "hello" }), /isn't a Word document or an Excel workbook/],
  ];
  for (const [name, buffer, re] of cases) {
    await choose(page, name, buffer, "application/octet-stream");
    const body = await page.locator("body").innerText();
    if (re) assert.match(body, re, name);
    else {
      // HTML named .pdf is only text: read as text, never run. Its script didn't execute.
      await page.getByTestId("import-row").first().hover();
      assert.equal(await page.evaluate(() => typeof window.__xss), "undefined", `${name}: nothing in it ran`);
      assert.ok((await sources(page)).some((s) => s.includes("<b onmouseover")), `${name}: its markup is shown as text`);
      assert.equal(await page.locator("[data-testid=import-row] img, [data-testid=import-row] b").count(), 0, `${name}: no element was made from it`);
    }
  }
  assert.deepEqual(sent, [], "nothing hostile reached the server");
  step(`chromium: a zip bomb (declared and real size), an encrypted document, a program named .pdf, HTML named .pdf (read as text, not run), an 11 MB file, a broken PDF and a stray ZIP are refused in the browser; nothing was sent`);
}

/**
 * IMG-01: a small three-day table image, laid out like the owner's real one that failed (day | exercise | sets & reps,
 * 420 px wide, text about 10 px). It's read into an editable draft, nothing is saved until confirmed, a line read
 * without its sets can be added and must then be filled in, a day can be split, and the confirmed plans are saved.
 */
async function tableImage(browser, engine) {
  const sharp = require("sharp");
  const { user, page, sent } = await signedIn(browser, `img${engine}`);
  const DAYS = [["MONDAY", ["Barbell Bench Press", "Dumbbell Incline Press", "Cable Fly"]], ["WEDNESDAY", ["Seated Cable Row", "Face Pull", "Hammer Curl", "Barbell Curl"]], ["FRIDAY", ["Romanian Deadlift", "Leg Press"]]];
  const lines = [[[10, "DAY"], [120, "WORKOUT"], [300, "SETS & REPS"]]];
  for (const [day, ex] of DAYS) ex.forEach((e, i) => lines.push([...(i === 0 ? [[10, day]] : []), [120, e], [300, "3 sets of 8-12 reps"]]));
  lines.push([[120, "Seated Leg Curl"]]); // a row whose sets weren't printed
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="${(lines.length + 3) * 16}"><rect width="100%" height="100%" fill="#fff"/>${lines.map((cells, i) => cells.map(([x, t]) => `<text x="${x}" y="${(i + 2) * 16}" font-family="Arial" font-size="10" fill="#111">${t.replace(/&/g, "&amp;")}</text>`).join("")).join("")}</svg>`;
  await choose(page, "three-day.jpg", await sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer(), "image/jpeg");

  const days = page.getByTestId("import-day");
  assert.equal(await days.count(), 3, `${engine}: three days`);
  for (const [i, [day, ex]] of DAYS.entries()) {
    const d = days.nth(i);
    assert.equal(await d.getByTestId("import-day-name").inputValue(), day);
    assert.equal(await d.getByTestId("import-day-weekday").inputValue(), String([0, 2, 4][i]), `${day}: on its weekday`);
    const r = d.getByTestId("import-row");
    assert.equal(await r.count(), ex.length, `${day}: ${ex.length} exercises`);
    for (let k = 0; k < ex.length; k++) {
      const row = r.nth(k);
      assert.deepEqual([await row.getByTestId("import-sets").inputValue(), await row.getByTestId("import-reps-min").inputValue(), await row.getByTestId("import-reps-max").inputValue()], ["3", "8", "12"], `${day} ${ex[k]}: 3 x 8-12`);
      assert.match(await row.innerText(), new RegExp(`Matched: ${ex[k]}`), `${day}: ${ex[k]} matched`);
    }
  }
  assert.deepEqual(sent.map((r) => r.path), ["/api/workouts/import/ocr"], `${engine}: read once, nothing saved yet`);
  assert.equal(await prisma.workoutTemplate.count({ where: { userId: user.id } }), 0);

  // The row without sets: listed, added on request, and then it must be filled in before anything can be saved.
  await page.getByTestId("import-warnings").locator("summary").click(); // the list is folded when days were found
  const unread = await page.getByTestId("import-unparsed").innerText();
  assert.match(unread, /Seated Leg Curl/, `${engine}: the line without sets is listed, not dropped or guessed`);
  await page.getByTestId("import-unparsed").locator("li", { hasText: "Seated Leg Curl" }).getByTestId("import-add-line").click();
  const added = days.nth(2).getByTestId("import-row").last();
  assert.match(await added.innerText(), /Matched: Seated Leg Curl/);
  assert.equal(await added.getByTestId("import-sets").inputValue(), "", "its sets aren't invented");
  assert.equal(await page.getByTestId("import-save").isDisabled(), true, "nothing can be saved with a row incomplete");
  await added.getByTestId("import-sets").fill("3");
  await added.getByTestId("import-reps-min").fill("10");
  await added.getByTestId("import-reps-max").fill("12");

  // A day split, as when a page's day labels weren't read: Wednesday's last two become their own day.
  await days.nth(1).getByTestId("import-row").nth(2).getByTestId("import-split-day").click();
  assert.equal(await days.count(), 4, "split into a new day");
  assert.equal(await days.nth(2).getByTestId("import-row").count(), 2);
  await days.nth(2).getByTestId("import-day-name").fill("Arms");

  await page.getByTestId("import-program").fill(`Three-day ${engine}`);
  await page.getByTestId("import-save").click();
  await page.getByTestId("import-saved").waitFor({ timeout: 20000 });
  const saved = await prisma.workoutTemplate.findMany({ where: { userId: user.id }, include: { exercises: { orderBy: { position: "asc" }, include: { exercise: true } } } });
  assert.deepEqual(saved.map((t) => [t.name.replace(`Three-day ${engine} – `, ""), t.exercises.map((e) => `${e.exercise.name} ${e.targetSets}x${e.targetRepsMin}-${e.targetRepsMax}`)]).sort(), [
    ["Arms", ["Hammer Curl 3x8-12", "Barbell Curl 3x8-12"]],
    ["FRIDAY", ["Romanian Deadlift 3x8-12", "Leg Press 3x8-12", "Seated Leg Curl 3x10-12"]],
    ["MONDAY", ["Barbell Bench Press 3x8-12", "Dumbbell Incline Press 3x8-12", "Cable Fly 3x8-12"]],
    ["WEDNESDAY", ["Seated Cable Row 3x8-12", "Face Pull 3x8-12"]],
  ].sort());
  step(`${engine}: IMG-01 a small three-day table image read into 3 days, 9 exercises at 3 x 8-12 on their weekdays; a row without sets added and filled in by hand; a day split; saved only on confirmation`);
}

(async () => {
  await target.verifyServer();
  const chromium = await playwright.chromium.launch(target.launchOptions("chromium"));
  try {
    await fullImport(chromium);
    await everyFormat(chromium, "chromium");
    await tableImage(chromium, "chromium");
    await hostile(chromium);
  } finally { await chromium.close(); }
  for (const engine of ["firefox", "webkit"]) {
    const browser = await playwright[engine].launch(target.launchOptions(engine));
    try { await everyFormat(browser, engine); await tableImage(browser, engine); } finally { await browser.close(); }
  }
  console.log("ALL WORKOUT IMPORT CHECKS PASSED");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
