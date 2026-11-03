// Exact conversion constants (international avoirdupois pound, international inch).
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export type UnitSystem = "METRIC" | "IMPERIAL";

export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const inToCm = (inch: number) => inch * CM_PER_IN;
export const cmToIn = (cm: number) => cm / CM_PER_IN;

export function round(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Convert a stored kg value to the user's display unit. */
export function toDisplayMass(kg: number, units: UnitSystem): number {
  return round(units === "IMPERIAL" ? kgToLb(kg) : kg, 1);
}

/** Convert a value entered in the user's unit to kg for storage. */
export function fromDisplayMass(value: number, units: UnitSystem): number {
  return units === "IMPERIAL" ? lbToKg(value) : value;
}

export const massUnit = (units: UnitSystem) => (units === "IMPERIAL" ? "lb" : "kg");

export function formatMass(kg: number, units: UnitSystem): string {
  return `${toDisplayMass(kg, units).toLocaleString("en-US")} ${massUnit(units)}`;
}

export function formatVolume(kg: number, units: UnitSystem): string {
  return `${Math.round(units === "IMPERIAL" ? kgToLb(kg) : kg).toLocaleString("en-US")} ${massUnit(units)}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
