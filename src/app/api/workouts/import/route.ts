import { route, parseBody } from "@/lib/server/api";
import { readIdempotencyKey } from "@/lib/server/idempotency";
import { saveImport } from "@/lib/server/workout-import";
import { importSaveSchema } from "@/lib/workout-import/save-schema";

/**
 * Phase 3: saves an imported program the person has checked and completed. The plan's file was read in their browser
 * and never reaches here: only the confirmed, validated draft does. All or nothing; new plans only.
 */
export const POST = route(async (req, { user }) => {
  const key = readIdempotencyKey(req);
  const input = await parseBody(req, importSaveSchema, { maxBytes: 128 * 1024 });
  return saveImport(user.id, input, key);
});
