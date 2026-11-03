"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartIcon, DumbbellIcon, ForkIcon, HomeIcon, UserIcon } from "./icons";
import { cx } from "./ui";

const ITEMS = [
  { href: "/dashboard", label: "Today", Icon: HomeIcon },
  { href: "/workouts", label: "Workouts", Icon: DumbbellIcon },
  { href: "/nutrition", label: "Nutrition", Icon: ForkIcon },
  { href: "/progress", label: "Progress", Icon: ChartIcon },
  { href: "/profile", label: "Profile", Icon: UserIcon },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-xl">
        {ITEMS.map(({ href, label, Icon }) => {
          const active = path === href || path.startsWith(href + "/");
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition", active ? "text-fg" : "text-muted hover:text-fg")}
              >
                <span className={cx("grid h-7 w-12 place-items-center rounded-full transition", active && "bg-accent text-accent-fg")}>
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
