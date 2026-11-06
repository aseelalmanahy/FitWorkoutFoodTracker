// Counts of what can be seen about accounts, for discussing retention. Facts only, and nothing here classifies anyone:
// a missing profile doesn't show that an account is abandoned or refused, as a refused date isn't stored and logging out
// removes a session. It holds no period, returns no id or address, and has no way to change anything.
"use strict";

const SMALL = 5; // one restricted account can identify someone
const MIN_ADULT_AGE = 18; // as src/lib/eligibility.ts
const DAY = 86_400_000;
const BANDS = [["under 30 days", 0, 30], ["30 to 90 days", 30, 90], ["90 to 365 days", 90, 365], ["over 365 days", 365, null]];

const shown = (n) => (n > 0 && n < SMALL ? `under ${SMALL}` : n);

/** `reader` has one method, `count(model, where)`, which is the only thing this can do with a database. */
async function reportAccountFacts(reader, now) {
  const adultCutoff = new Date(now);
  adultCutoff.setUTCFullYear(adultCutoff.getUTCFullYear() - MIN_ADULT_AGE);
  const facts = {
    accounts: {},
    "no profile row": { profile: { is: null } },
    "stored date under the minimum today": { profile: { is: { birthDate: { gt: adultCutoff } } } },
    "an unexpired session": { sessions: { some: { expiresAt: { gt: now } } } },
    "no unexpired session": { sessions: { none: { expiresAt: { gt: now } } } },
    "a notice version recorded": { termsVersion: { not: null } },
  };
  const rows = [];
  for (const [band, from, to] of BANDS) {
    const createdAt = { lte: new Date(now.getTime() - from * DAY), ...(to === null ? {} : { gt: new Date(now.getTime() - to * DAY) }) };
    const row = { "account age": band };
    for (const [label, where] of Object.entries(facts)) row[label] = shown(await reader.count("user", { ...where, createdAt }));
    rows.push(row);
  }
  return { note: "Counts of what can be seen. These aren't classifications, and say nothing about why.", rows, "unexpired emailed links": shown(await reader.count("accountToken", { expiresAt: { gt: now } })) };
}

module.exports = { reportAccountFacts, SMALL, MIN_ADULT_AGE };
