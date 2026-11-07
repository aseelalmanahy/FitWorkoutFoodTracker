import { AUTH_BODY, publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { completeSignupSchema } from "@/lib/validation";
import { isRateLimited, recordAttempt } from "@/lib/server/auth";
import { completeSignup } from "@/lib/server/account/access";
import { trustedClientId } from "@/lib/server/login-throttle";

/** Creates the account, and doesn't sign anyone in. */
export const POST = publicRoute(async (req) => {
  const key = `redeem:${trustedClientId(req.headers) ?? "untrusted"}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.");
  recordAttempt(key);
  const { token, password, acceptedVersion } = await parseBody(req, completeSignupSchema, AUTH_BODY);
  await completeSignup(token, password, acceptedVersion);
  return { ok: true };
});
