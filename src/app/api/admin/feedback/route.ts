import type { NextRequest } from "next/server";
import { adminRoute } from "@/lib/server/api";
import { feedbackFilterSchema } from "@/lib/feedback";
import { listAllFeedback } from "@/lib/server/feedback";

const filterOf = (req: NextRequest) => feedbackFilterSchema.parse(Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v !== "")));

export const GET = adminRoute(async (req) => listAllFeedback(filterOf(req)));
