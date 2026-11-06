// Fills in the onboarding form the way a person has to: nothing is preselected, units come first, and
// a new date of birth is confirmed in words before anything is sent. Used by every E2E flow.
"use strict";

const DEFAULTS = {
  units: "METRIC", name: "Sam", birthDate: "1990-01-01", sex: "Male", goal: "Maintenance",
  activity: "MODERATE", experience: "BEGINNER", days: "3",
  heightCm: "180", weightKg: "80", heightFt: "5", heightIn: "10", weightLb: "180", goalWeight: null,
};

async function fillProfile(page, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const metric = o.units === "METRIC";
  const height = page.getByLabel(metric ? "Height (cm)" : "Height (ft)");
  // A click before the page has hydrated does nothing, so choose until the fields it reveals appear.
  const radio = page.getByRole("radio", { name: metric ? "kg / cm" : "lb / ft" });
  await radio.waitFor();
  for (let i = 0; i < 50 && !(await height.isVisible()); i++) {
    await radio.click();
    await page.waitForTimeout(100);
  }
  await page.getByLabel("Name").fill(o.name);
  await page.getByLabel("Date of birth").fill(o.birthDate);
  await page.getByRole("radio", { name: o.sex, exact: true }).click();
  if (metric) {
    await height.fill(o.heightCm);
    await page.getByLabel("Current weight (kg)").fill(o.weightKg);
  } else {
    await height.fill(o.heightFt);
    await page.getByLabel("Height (in)").fill(o.heightIn);
    await page.getByLabel("Current weight (lb)").fill(o.weightLb);
  }
  if (o.goalWeight) await page.getByLabel(metric ? "Goal weight (kg)" : "Goal weight (lb)").fill(o.goalWeight);
  await page.getByRole("button", { name: o.goal, exact: true }).click();
  await page.getByLabel("Activity level").selectOption(o.activity);
  await page.getByLabel("Training experience").selectOption(o.experience);
  await page.getByLabel("Workout days / week").selectOption(o.days);
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
