import "server-only";

/**
 * Administrators are named by user ID in ADMIN_USER_IDS, on the server only: nothing a browser sends can make someone
 * one. An entry that isn't the shape of an ID is ignored, so a typo can't widen it, and an empty setting means none.
 */
export function adminUserIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter((s) => /^c[a-z0-9]{20,32}$/.test(s)));
}
export const isAdmin = (userId: string, env?: Record<string, string | undefined>) => adminUserIds(env).has(userId);
