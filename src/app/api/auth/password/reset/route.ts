import { AUTH_BODY, publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { redeemTokenSchema } from "@/lib/validation";
import { clearAuthCookies, isRateLimited, recordAttempt } from "@/lib/server/auth";
import { resetPassword } from "@/lib/server/account/access";
import { trustedClientId } from "@/lib/server/login-throttle";

/** Ends every session, including any in this browser, and doesn't sign anyone in. */
export const POST = publicRoute(async (req) => {
  const key = `redeem:${trustedClientId(req.headers) ?? "untrusted"}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.");
  recordAttempt(key);
  const { token, password } = await parseBody(req, redeemTokenSchema, AUTH_BODY);
  await resetPassword(token, password);
  await clearAuthCookies();
  return { ok: true };
});
