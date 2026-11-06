"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { Button, ButtonLink, Card, SectionTitle, cx } from "@/components/ui";

type Theme = "system" | "light" | "dark";

export function AccountActions() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    try {
      const t = localStorage.getItem("theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);

  function applyTheme(t: Theme) {
    setTheme(t);
    try {
      if (t === "system") {
        localStorage.removeItem("theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("theme", t);
        document.documentElement.dataset.theme = t;
      }
    } catch {}
  }

  async function logout() {
    await api("POST", "/api/auth/logout").catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <SectionTitle>Appearance</SectionTitle>
      <Card className="p-1">
        <div className="grid grid-cols-3 gap-1">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button key={t} type="button" onClick={() => applyTheme(t)} aria-pressed={theme === t}
              className={cx("h-10 rounded-xl text-sm font-medium capitalize", theme === t ? "bg-surface-2 text-fg" : "text-muted")}>
              {t}
            </button>
          ))}
        </div>
      </Card>
      <SectionTitle>Account</SectionTitle>
      <ButtonLink href="/account" variant="secondary" className="mb-2 w-full">Download or delete my data</ButtonLink>
      <Button variant="danger" className="w-full" onClick={logout}>Log out</Button>
    </>
  );
}
