// Fills in the onboarding form the way a person has to: nothing is preselected, and a new date of birth
// is confirmed in words before anything is sent. Used by every E2E flow. Saving this for real needs the
// Profile migration, as the fields it no longer sends are stored as null.
"use strict";

const DEFAULTS = { units: "METRIC", name: "Sam", birthDate: "1990-01-01" };

async function fillProfile(page, options = {}) {
  const o = { ...DEFAULTS, ...options };
  // A click before the page has hydrated does nothing, so choose until it's selected.
  const radio = page.getByRole("radio", { name: o.units === "METRIC" ? "kg / cm" : "lb / ft" });
  await radio.waitFor();
  for (let i = 0; i < 50 && (await radio.getAttribute("aria-checked")) !== "true"; i++) {
    await radio.click();
    await page.waitForTimeout(100);
  }
  await page.getByLabel("Name").fill(o.name);
  await page.getByLabel("Date of birth").fill(o.birthDate);
}

/** Submits, confirms the date, and waits for the dashboard. */
async function completeOnboarding(page, options = {}) {
  await fillProfile(page, options);
  if (options.beforeSubmit) await options.beforeSubmit();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Yes, that's right" }).click();
  await page.waitForURL("**/dashboard");
}

module.exports = { fillProfile, completeOnboarding };
