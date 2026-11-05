import "server-only";
/**
 * Spending limits for label scans, as each scan can be a paid provider request. Only validated
 * images are counted, as nothing is sent for the others. A failed request still counts, because a
 * provider may have billed it, so failures can't be retried without limit.
 *
 * LIMITATION: counts live in memory, per server process, and reset on restart. Set a spending limit
 * with the provider too, as the only hard ceiling across restarts and processes.
 */
const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_USER_DAILY_LIMIT = 30;
const DEFAULT_GLOBAL_DAILY_LIMIT = 300;
const MAX_TRACKED_USERS = 10_000;

const scansByUser = new Map<string, number[]>();
let globalScans: number[] = [];

/** Invalid settings fall back to the default, never to unlimited. 0 turns scanning off. */
function limitFrom(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export type ScanBudget = { allowed: true } | { allowed: false; retryAfterSec: number };

const retryAfter = (oldest: number | undefined, now: number) => Math.max(1, Math.ceil(((oldest ?? now) + WINDOW_MS - now) / 1000));

function check(userId: string, now: number): { budget: ScanBudget; userScans: number[] } {
  const userLimit = limitFrom(process.env.LABEL_SCAN_USER_DAILY_LIMIT, DEFAULT_USER_DAILY_LIMIT);
  const globalLimit = limitFrom(process.env.LABEL_SCAN_GLOBAL_DAILY_LIMIT, DEFAULT_GLOBAL_DAILY_LIMIT);
  globalScans = globalScans.filter((t) => now - t < WINDOW_MS);
  const userScans = (scansByUser.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (userScans.length >= userLimit) return { budget: { allowed: false, retryAfterSec: retryAfter(userScans[0], now) }, userScans };
  if (globalScans.length >= globalLimit) return { budget: { allowed: false, retryAfterSec: retryAfter(globalScans[0], now) }, userScans };
  return { budget: { allowed: true }, userScans };
}

/** Whether a scan could go ahead. Costs nothing, so it runs before the upload is read. */
export const checkLabelScanBudget = (userId: string): ScanBudget => check(userId, Date.now()).budget;

/** Takes one scan from the budget, immediately before a provider request. */
export function reserveLabelScan(userId: string): ScanBudget {
  const now = Date.now();
  const { budget, userScans } = check(userId, now);
  if (!budget.allowed) return budget;
  scansByUser.delete(userId); // re-inserted last, so the oldest user is dropped first when full
  if (scansByUser.size >= MAX_TRACKED_USERS) scansByUser.delete(scansByUser.keys().next().value as string);
  scansByUser.set(userId, [...userScans, now]);
  globalScans.push(now);
  return budget;
}

/** Test hooks. */
export function _resetLabelScanLimits() { scansByUser.clear(); globalScans = []; }
export const _trackedScanUsers = () => scansByUser.size;
