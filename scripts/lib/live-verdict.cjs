// Verdict logic for scripts/live-provider-check.cjs (pure; unit-tested).
//
// Evidence per provider (USDA, OPEN_FOOD_FACTS):
//   origin: "real"    the server-recorded Food.origin is the provider's real host
//           "other"   the origin is some other host (stub/mock/proxy) → contradicts live
//           "unknown" no food from this provider was fetched (e.g. the check failed)
//   count:  number    result count of a SUCCESSFUL search, or null if the search failed
// Rules:
//   NOT LIVE    any contradiction: a stub override env var is set, an origin is "other", or a
//               successful search returned fewer results than the real service does
//   INCOMPLETE  no contradiction but evidence is missing for either provider, or any
//               check FAILED / NOT RUN, or the run stopped early
//   PASSED      both providers have real origin + plausible counts, and every check PASSED
"use strict";

const MIN_COUNTS = { USDA: 5, OPEN_FOOD_FACTS: 3 };
const REAL_HOSTS = { USDA: "api.nal.usda.gov", OPEN_FOOD_FACTS: "world.openfoodfacts.org" };

function decideVerdict({ results, evidence, envOverrides = [], crashed = false }) {
  const contradictions = [...envOverrides.map((v) => `${v} is set (stub/override endpoint)`)];
  const missing = [];
  for (const p of ["USDA", "OPEN_FOOD_FACTS"]) {
    const e = evidence[p] || {};
    if (e.origin === "other") contradictions.push(`${p} data was produced by "${e.originHost}", not ${REAL_HOSTS[p]}`);
    else if (e.origin !== "real") missing.push(`no ${p} food origin could be checked`);
    if (typeof e.count === "number") {
      if (e.count < MIN_COUNTS[p]) contradictions.push(`${p} search returned ${e.count} results (the real service returns ≥ ${MIN_COUNTS[p]})`);
    } else missing.push(`no successful ${p} search to check result volume`);
  }
  const summary = { PASS: 0, FAIL: 0, "NOT RUN": 0 };
  for (const r of results) summary[r.status]++;
  let verdict, live;
  if (contradictions.length) { verdict = "NOT LIVE"; live = false; }
  else if (missing.length || crashed || summary.FAIL || summary["NOT RUN"]) { verdict = "INCOMPLETE OR FAILED"; live = missing.length ? null : true; }
  else { verdict = "PASSED"; live = true; }
  const exitCode = verdict === "PASSED" ? 0 : verdict === "NOT LIVE" ? 3 : 1;
  return { verdict, live, exitCode, contradictions, missing, summary };
}

// PROT-1 kinds: "ok" and these errors mean the search passed the guard (src/lib/server/foods/guard.ts,
// acquire), which charges the per-user budget BEFORE contacting the provider.
const REACHED_PROVIDER = new Set(["ok", "http", "timeout", "network", "invalid_response", "not_found"]);

/**
 * PROT-1 result from the per-search outcomes of five searches by one fresh user.
 *   PASS     the first four passed the guard, and the 5th got `user_rate_limited`. Only the
 *            guard emits that kind, before any provider request. Provider errors among the
 *            first four are reported as context: those searches still used up budget.
 *   FAIL     the limit stopped a search too early, or the 5th passed the guard.
 *   NOT RUN  anything else: `unavailable` (circuit open, app-wide budget, or a provider 429,
 *            not all of which charge the budget), or an outcome that can't be classified.
 */
function decideProt1(kinds) {
  const seen = kinds.join(", ");
  const isKnown = (k) => k === "user_rate_limited" || REACHED_PROVIDER.has(k);
  if (kinds.length !== 5 || !kinds.every(isKnown)) {
    return { status: "NOT RUN", detail: `inconclusive, the per-user limit can't be distinguished from an upstream or app failure (${seen}); wait a minute and re-run` };
  }
  const early = kinds.slice(0, 4).indexOf("user_rate_limited");
  if (early !== -1) return { status: "FAIL", detail: `the limit stopped search ${early + 1} of the allowed 4 (${seen})` };
  if (kinds[4] !== "user_rate_limited") return { status: "FAIL", detail: `the 5th search passed the per-user limit (${seen})` };
  const errors = kinds.slice(0, 4).filter((k) => k !== "ok");
  return { status: "PASS", detail: errors.length ? `${seen}; provider errors among the first 4 (${errors.join(", ")}) still used budget` : seen };
}

module.exports = { decideVerdict, decideProt1, MIN_COUNTS, REAL_HOSTS };
