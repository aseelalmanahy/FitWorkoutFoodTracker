import "server-only";
/**
 * Limits on image uploads, which are large compared with every other request. Checked after
 * authentication and before any of the body is read, so a refused request costs almost nothing.
 *
 * - At most 4 uploads are held in memory at once: 4 x 7 MB bounds the memory used while reading.
 * - One upload at a time per user, so one account can't hold every slot with slow uploads.
 * - Each user gets 20 uploads per 10 minutes. Failed uploads count too.
 *
 * LIMITATION: all state is in memory, per server process, like the login limits.
 */
const MAX_CONCURRENT_UPLOADS = 4;
const USER_LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_TRACKED_USERS = 10_000;

const uploadsByUser = new Map<string, number[]>();
const usersUploading = new Set<string>();
let active = 0;

export type UploadSlot = { allowed: true; release: () => void } | { allowed: false; retryAfterSec: number };

export function beginImageUpload(userId: string): UploadSlot {
  const now = Date.now();
  const times = (uploadsByUser.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= USER_LIMIT) {
    uploadsByUser.set(userId, times);
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((times[0] + WINDOW_MS - now) / 1000)) };
  }
  if (active >= MAX_CONCURRENT_UPLOADS || usersUploading.has(userId)) return { allowed: false, retryAfterSec: 1 };

  uploadsByUser.delete(userId); // re-inserted last, so the oldest user is dropped first when full
  if (uploadsByUser.size >= MAX_TRACKED_USERS) uploadsByUser.delete(uploadsByUser.keys().next().value as string);
  uploadsByUser.set(userId, [...times, now]);
  usersUploading.add(userId);
  active++;
  let released = false;
  return { allowed: true, release: () => { if (!released) { released = true; active--; usersUploading.delete(userId); } } };
}

/** Test hooks. */
export function _resetImageUploadLimits() { uploadsByUser.clear(); usersUploading.clear(); active = 0; }
export const _trackedUploadUsers = () => uploadsByUser.size;
