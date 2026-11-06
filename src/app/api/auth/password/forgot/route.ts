import { AUTH_BODY, publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { emailRequestSchema } from "@/lib/validation";
import { isRateLimited, recordAttempt } from "@/lib/server/auth";
import { requestPasswordReset } from "@/lib/server/account/access";
import { trustedClientId } from "@/lib/server/login-throttle";

/** The same answer whether or not there's an account, with nothing looked up before it's sent. */
export const POST = publicRoute(async (req) => {
  const key = `forgot:${trustedClientId(req.headers) ?? "untrusted"}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.");
  recordAttempt(key);
  const { email } = await parseBody(req, emailRequestSchema, AUTH_BODY);
  requestPasswordReset(email);
  return { ok: true };
});
