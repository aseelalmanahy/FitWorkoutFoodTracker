import { ageFromBirthDate } from "./energy";

/**
 * Declared-age eligibility. The date is what the person typed, so this is never age verification.
 * Dates are UTC calendar dates, and the client's time zone has no effect. Someone born on
 * 29 February turns 18 on 1 March in a common year, which legal review still has to confirm.
 */
export const MIN_ADULT_AGE = 18;
/** A data-entry bound. Not a medical limit. */
export const MAX_ENTRY_AGE = 110;

export type Eligibility = "eligible" | "under_minimum" | "out_of_range";

const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

export function eligibilityOf(birthIso: string, now: Date = new Date()): Eligibility {
  if (birthIso > now.toISOString().slice(0, 10)) return "out_of_range";
  const age = ageFromBirthDate(utcDate(birthIso), now);
  if (age > MAX_ENTRY_AGE) return "out_of_range";
  return age < MIN_ADULT_AGE ? "under_minimum" : "eligible";
}

export type AccessState = "no_profile" | "restricted" | "ok";

/**
 * Who may use the app, derived from the stored date on every check, with no flag stored. API routes
 * and pages both use this. Only under the minimum restricts: someone who ages past the data-entry
 * bound keeps their account.
 */
export function accessStateFor(profile: { birthDate: Date } | null, now: Date = new Date()): AccessState {
  if (!profile) return "no_profile";
  return ageFromBirthDate(profile.birthDate, now) < MIN_ADULT_AGE ? "restricted" : "ok";
}
