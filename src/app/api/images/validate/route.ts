import { NextResponse } from "next/server";
import { route } from "@/lib/server/api";
import { withValidatedImage } from "@/lib/server/images/upload";

/**
 * Validate one image sent as the raw request body. Nothing is stored, and the browser shows the
 * user's own file for preview, so no image URL exists.
 */
export const POST = route(async (req, { user }) => withValidatedImage(req, user.id, async ({ image, bytes, sha256 }) => NextResponse.json(
  { ok: true, format: image.format, mediaType: image.mediaType, width: image.width, height: image.height, bytes, sha256 },
  { headers: { "Cache-Control": "no-store" } },
)));
