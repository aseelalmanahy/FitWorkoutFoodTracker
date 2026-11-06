import { AUTH_BODY, accountRoute, parseBody } from "@/lib/server/api";
import { changePassword } from "@/lib/server/account/access";
import { changePasswordSchema } from "@/lib/validation";

// accountRoute, not route: someone with no profile, or a restricted one, must be able to secure their account.
export const POST = accountRoute(async (req, { user }) => {
  const { currentPassword, newPassword } = await parseBody(req, changePasswordSchema, AUTH_BODY);
  await changePassword(user, currentPassword, newPassword);
  return { ok: true };
});
