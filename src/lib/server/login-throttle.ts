import "server-only";
/**
 * Login abuse protection that doesn't let anyone lock an account by knowing its email.
 *
 * 1. Client + account: 10 failed attempts per 15 minutes, then only THAT client is refused.
 * 2. Client: 100 failed attempts per 15 minutes across all accounts (password spraying).
 *    High enough that people sharing an IP address don't normally affect each other.
 * 3. Account, for clients it hasn't seen before: never a lockout. After 5 failures, attempts are
 *    spaced 1 to 30 s apart across all such clients, which limits distributed guessing to about
 *    40 attempts per 15 minutes per account. A refused attempt can retry at the next open slot.
 * 4. Known devices skip rule 3: a browser holding a valid device cookie from an earlier successful
 *    login keeps its own lane, so an attacker filling the queue can't keep that owner out. It has
 *    its own limit under rule 1. A person on a NEW device can still be slowed during an attack.
 * 5. At most 16 password checks and registration hashes run at once across the app, which bounds
 *    Argon2 CPU and memory. Two of those slots are kept for known devices, so a flood from
 *    other clients can't take them all.
 *
 * MEMORY: at most 50,000 records. When full, the record with the fewest failures among the oldest
 * 1,000 is dropped, so a flood of throwaway emails removes its own records, not a victim's.
 *
 * CLIENT IDENTITY: Next.js keeps any X-Forwarded-For the caller sends and exposes no socket
 * address to route handlers, so that header proves nothing unless a trusted proxy appended to it.
 * Set TRUST_PROXY_HOPS to the number of proxies in front of the app. Without it, rules 1 and 2
 * apply only to known devices, and new devices rely on rule 3.
 *
 * LIMITATION: all state is in memory, per server process. With several instances, each enforces
 * its own limits and spacing, so the effective limits multiply. Move this state to a shared store
 * before horizontal scaling.
 */
import { isIP } from "node:net";

const WINDOW_MS = 15 * 60 * 1000;
const CLIENT_ACCOUNT_LIMIT = 10;
const CLIENT_LIMIT = 100;
const SPACING_AFTER_FAILURES = 5;
const MAX_SPACING_MS = 30_000;
const MAX_HOLD_MS = 5000;
const MAX_PASSWORD_CHECKS = 16;
const SLOTS_KEPT_FOR_KNOWN_DEVICES = 2;
const MAX_RECORDS = 50_000;
const EVICTION_SCAN = 1000;
const MAX_TIMES_PER_RECORD = CLIENT_LIMIT;

interface ThrottleRecord { times: number[]; nextSlotAt: number }
const records = new Map<string, ThrottleRecord>();

const isExpired = (r: ThrottleRecord, now: number) =>
  r.nextSlotAt <= now && (r.times.length === 0 || now - r.times[r.times.length - 1] >= WINDOW_MS);

/**
 * Least recently used records come first, so expired ones go first. If it's still full, drop the
 * record with the fewest failures among the oldest ones, which keeps active limits and spacing.
 */
function makeRoom(now: number) {
  for (const [key, r] of records) {
    if (records.size < MAX_RECORDS) return;
    if (!isExpired(r, now)) break;
    records.delete(key);
  }
  if (records.size < MAX_RECORDS) return;
  let victim: string | null = null, fewest = Infinity, scanned = 0;
  for (const [key, r] of records) {
    if (r.times.length < fewest) { victim = key; fewest = r.times.length; }
    if (++scanned >= EVICTION_SCAN || fewest <= 1) break;
  }
  if (victim) records.delete(victim);
}

function recordFor(key: string, now: number): ThrottleRecord {
  const existing = records.get(key);
  if (existing) records.delete(key); else makeRoom(now);
  const r = existing ?? { times: [], nextSlotAt: 0 };
  r.times = r.times.filter((t) => now - t < WINDOW_MS);
  records.set(key, r);
  return r;
}

const retrySeconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));
const addTime = (r: ThrottleRecord, now: number) => {
  r.times.push(now);
  if (r.times.length > MAX_TIMES_PER_RECORD) r.times.shift();
};
const refusalFrom = (r: ThrottleRecord | null, limit: number, now: number) =>
  (r && r.times.length >= limit ? { allowed: false as const, retryAfterSec: retrySeconds(r.times[0] + WINDOW_MS - now) } : null);

export type LoginRefusal = { allowed: false; retryAfterSec: number };
export type LoginAttempt =
  | LoginRefusal
  | {
    allowed: true;
    /** How long to wait before checking the password. */
    waitMs: number;
    /** The password was correct: this attempt no longer counts as a failure. */
    succeeded: () => void;
    /** The check couldn't run (e.g. database error): this attempt says nothing about the password. */
    abandoned: () => void;
  };

/** A cheap check before any database read: is this client already over its cross-account limit? */
export function clientRefusal(client: string | null): LoginRefusal | null {
  return client ? refusalFrom(recordFor(`client:${client}`, Date.now()), CLIENT_LIMIT, Date.now()) : null;
}

/**
 * Check the limits and count the attempt immediately. Counting before the slow password check
 * means parallel requests can't all pass the check. Applies equally to unknown emails, so the
 * result never reveals whether an account exists. `client` is null when no identity can be trusted.
 */
export function beginLoginAttempt(email: string, client: string | null, knownDevice = false): LoginAttempt {
  const now = Date.now();
  const account = email.trim().toLowerCase();
  const pair = knownDevice ? recordFor(`known:${client ?? "any"}:${account}`, now) : client ? recordFor(`pair:${client}:${account}`, now) : null;
  const byClient = client ? recordFor(`client:${client}`, now) : null;
  const refusal = refusalFrom(pair, CLIENT_ACCOUNT_LIMIT, now) ?? refusalFrom(byClient, CLIENT_LIMIT, now);
  if (refusal) return refusal;

  let acct: ThrottleRecord | null = null;
  let waitMs = 0;
  if (!knownDevice) {
    acct = recordFor(`account:${account}`, now);
    const start = Math.max(now, acct.nextSlotAt);
    waitMs = start - now;
    if (waitMs > MAX_HOLD_MS) return { allowed: false, retryAfterSec: retrySeconds(waitMs) };
    const failures = acct.times.length;
    const spacing = failures < SPACING_AFTER_FAILURES ? 0 : Math.min(1000 * 2 ** (failures - SPACING_AFTER_FAILURES), MAX_SPACING_MS);
    acct.nextSlotAt = start + spacing;
  }

  const counted = [pair, byClient, acct];
  for (const r of counted) if (r) addTime(r, now);
  const uncount = () => { for (const r of counted) r?.times.pop(); };
  return {
    allowed: true,
    waitMs,
    succeeded: () => {
      uncount();
      // Only this client's record for this account resets. Its other limits, and other clients', stay.
      if (pair) pair.times = [];
    },
    abandoned: uncount,
  };
}

let passwordChecks = 0;
/** Refusing here, before any record is created, means a flood during overload leaves nothing behind. */
export const hasPasswordCheckCapacity = (knownDevice = false) =>
  passwordChecks < (knownDevice ? MAX_PASSWORD_CHECKS : MAX_PASSWORD_CHECKS - SLOTS_KEPT_FOR_KNOWN_DEVICES);

/** Reserve one of the limited Argon2 slots. Returns a release function, or null when full. */
export function acquirePasswordCheck(knownDevice = false): (() => void) | null {
  if (!hasPasswordCheckCapacity(knownDevice)) return null;
  passwordChecks++;
  let released = false;
  return () => { if (!released) { released = true; passwordChecks--; } };
}

/** Number of reverse proxies configured as trusted. 0 means no forwarding header can be believed. */
export function trustedProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS;
  return raw && /^\d+$/.test(raw) ? Number(raw) : 0;
}

/** Group IPv6 by /64, the block one customer usually controls. Returns null for an invalid address. */
function normalizeIp(raw: string): string | null {
  const ip = raw.split("%")[0].toLowerCase();
  const kind = isIP(ip);
  if (kind === 4) return ip;
  if (kind !== 6) return null;
  const dotted = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  const [head, tail = ""] = (dotted ? `${dotted[1]}0:0` : ip).split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right].map((g) => parseInt(g, 16));
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return dotted ? dotted[2] : `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  }
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] <= 1) return "::1"; // loopback or unspecified
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Private, loopback and link-local addresses here mean a proxy's own address, not a real client's. */
const isInternalAddress = (id: string) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(id) || id === "::1" || /^(fc|fd|fe[89ab])[0-9a-f]{0,2}:/.test(id);

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (process.env.NODE_ENV === "production" && !warned.has(key)) {
    warned.add(key);
    console.warn(`[auth] ${message}`);
  }
}

/**
 * The client address, read only from the entry the outermost trusted proxy appended to
 * X-Forwarded-For. Entries to its left are caller-controlled and ignored. Other headers such
 * as X-Real-IP are never read. Returns null when no identity can be trusted: TRUST_PROXY_HOPS is
 * unset or invalid, the chain is shorter than configured, the entry is malformed, or it's an internal
 * address. That last case usually means too low a TRUST_PROXY_HOPS, which would otherwise make every
 * client look like one and let an attacker lock that shared identity.
 */
export function trustedClientId(headers: Headers): string | null {
  const hops = trustedProxyHops();
  if (hops < 1) {
    warnOnce("unset", "TRUST_PROXY_HOPS is not set: per-client limits are off for login and registration uses one shared limit.");
    return null;
  }
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const entry = chain[chain.length - hops];
  const id = entry ? normalizeIp(entry) : null;
  if (!id || isInternalAddress(id)) {
    warnOnce("unusable", "TRUST_PROXY_HOPS is set, but X-Forwarded-For has no usable client address. Check the proxy configuration.");
    return null;
  }
  return id;
}

let sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const waitForLoginSlot = (ms: number) => (ms > 0 ? sleep(ms) : Promise.resolve());

/** Test hooks. */
export function _setLoginSleep(fn: (ms: number) => Promise<void>) { sleep = fn; }
export function _resetLoginThrottle() { records.clear(); warned.clear(); passwordChecks = 0; }
export const _loginThrottleRecordCount = () => records.size;
