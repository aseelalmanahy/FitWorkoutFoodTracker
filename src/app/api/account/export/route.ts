import { AUTH_BODY_LIMIT_BYTES, accountRoute, parseBody } from "@/lib/server/api";
import { requireAccountPassword } from "@/lib/server/account/reauth";
import { buildExport, exportFilename, serializeExport, withExportSlot } from "@/lib/server/account/export";
import { accountPasswordSchema } from "@/lib/validation";

// accountRoute, not route: someone with no profile, or a restricted one, must be able to take their data.
// POST, as it carries a password, and the response must never be cached.
export const POST = accountRoute(async (req, { user }) => {
  const { password } = await parseBody(req, accountPasswordSchema, { maxBytes: AUTH_BODY_LIMIT_BYTES });
  const verified = await requireAccountPassword(user.id, password);
  const now = new Date();
  const file = await withExportSlot(user.id, async () => serializeExport(await buildExport(user.id, verified, now)));
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(now)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
