"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, DumbbellIcon, ForkIcon, HomeIcon, UserIcon } from "./icons";
import { BrandMark } from "./brand";
import { cx } from "./ui";

const ITEMS = [
  { href: "/dashboard", label: "Today", Icon: HomeIcon },
  { href: "/workouts", label: "Workouts", Icon: DumbbellIcon },
  { href: "/nutrition", label: "Nutrition", Icon: ForkIcon },
  { href: "/progress", label: "Progress", Icon: ChartIcon },
  { href: "/profile", label: "Profile", Icon: UserIcon },
];

const isActive = (path: string, href: string) => path === href || path.startsWith(href + "/");

/** Phones and tablets: a bar at the bottom, in reach of a thumb. Hidden on desktop, where the side bar takes over. */
export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="mx-auto flex max-w-xl md:max-w-3xl">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(path, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx("flex min-h-14 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition", active ? "text-fg" : "text-muted hover:text-fg")}
              >
                <span className={cx("grid h-7 w-12 place-items-center rounded-full transition", active && "bg-accent-soft text-accent-ink")}>
                  <Icon width={20} height={20} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desktop: a fixed side bar, so the content can use the width beside it. */
export function SideNav() {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface/70 px-3 py-6 backdrop-blur-xl lg:flex">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2.5 px-3">
        <BrandMark className="h-8 w-8" />
        <span className="text-lg font-semibold tracking-tight">Forge</span>
      </Link>
      <ul className="space-y-1">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = isActive(path, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition",
                  active ? "bg-accent-soft text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-fg")}
              >
                <Icon width={20} height={20} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-auto px-3 text-xs text-muted">Training, food and progress</p>
    </nav>
  );
}
