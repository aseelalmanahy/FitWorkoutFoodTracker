import { publicRoute } from "@/lib/server/api";
import { destroySession } from "@/lib/server/auth";

export const POST = publicRoute(async () => {
  await destroySession();
  return { ok: true };
});
