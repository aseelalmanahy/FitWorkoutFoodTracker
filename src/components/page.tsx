import type { ReactNode } from "react";
import { cx } from "./ui";

/**
 * How wide a page's content runs. The shell allows up to 1200 px on desktop. A page picks:
 * - "focused": forms and the workout logger, which read best as one column.
 * - "medium": lists and settings.
 * - "wide": dashboards, charts and multi-column layouts.
 * Phones get the full width in every case.
 */
const WIDTH = { focused: "max-w-xl", medium: "max-w-3xl", wide: "max-w-none" } as const;

export function Page({ width = "medium", className, children }: { width?: keyof typeof WIDTH; className?: string; children: ReactNode }) {
  return <div className={cx("mx-auto w-full", WIDTH[width], className)}>{children}</div>;
}
