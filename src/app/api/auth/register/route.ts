import { AUTH_BODY, publicRoute, parseBody, HttpError } from "@/lib/server/api";
import { emailRequestSchema } from "@/lib/validation";
import { isRateLimited, recordAttempt } from "@/lib/server/auth";
import { requestSignupLink } from "@/lib/server/account/access";
import { trustedClientId } from "@/lib/server/login-throttle";

/**
 * The same answer for an invited address, an uninvited one and an existing account, with nothing looked up before
 * it's sent. Without a trusted client address, all callers share one limit, so forged headers gain nothing.
 */
export const POST = publicRoute(async (req) => {
  const key = `register:${trustedClientId(req.headers) ?? "untrusted"}`;
  if (isRateLimited(key)) throw new HttpError(429, "Too many attempts. Try again later.");
  recordAttempt(key);
  const { email } = await parseBody(req, emailRequestSchema, AUTH_BODY);
  requestSignupLink(email);
  return { ok: true };
});
