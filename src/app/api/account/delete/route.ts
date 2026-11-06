import { AUTH_BODY, accountRoute, parseBody } from "@/lib/server/api";
import { clearAuthCookies, forgetAttempts } from "@/lib/server/auth";
import { deleteAccount } from "@/lib/server/account/delete";
import { reauthKey, requireAccountPassword } from "@/lib/server/account/reauth";
import { forgetLoginAccount } from "@/lib/server/login-throttle";
import { deleteAccountSchema } from "@/lib/validation";

// accountRoute, not route: someone with no profile, or a restricted one, must be able to leave.
// The confirmation is checked first, so a request without it can't spend a password attempt.
export const POST = accountRoute(async (req, { user }) => {
  const { password } = await parseBody(req, deleteAccountSchema, AUTH_BODY);
  const verified = await requireAccountPassword(user.id, password);
  await deleteAccount(user.id, verified);
  await clearAuthCookies();
  // Short-lived limiter state that names this person. Anything else in memory holds only an id, and expires.
  forgetLoginAccount(user.email);
  forgetAttempts(reauthKey(user.id), `age-refusal:${user.id}`);
  return { ok: true };
});
