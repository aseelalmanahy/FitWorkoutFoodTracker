/**
 * The one place zod is imported. jitless stops zod from probing whether eval is allowed (it tries `new Function`, and
 * catches the failure). Under this app's Content-Security-Policy, which rightly has no 'unsafe-eval', browsers report
 * that probe as a violation even though nothing breaks. Without its compiled fast path zod is a little slower on large
 * objects, which none of these schemas are. Every schema module imports z from here, so this runs before any schema
 * is built; a test keeps it that way.
 */
import { z, ZodError } from "zod";

z.config({ jitless: true });

export { z, ZodError };
