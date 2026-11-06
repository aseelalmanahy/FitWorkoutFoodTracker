"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function logout() {
    await api("POST", "/api/auth/logout").catch(() => {});
    router.replace("/login");
    router.refresh();
  }
  return <Button type="button" variant="secondary" className={className} onClick={logout}>Log out</Button>;
}
