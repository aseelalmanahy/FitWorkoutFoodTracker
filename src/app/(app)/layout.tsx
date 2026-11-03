import { BottomNav } from "@/components/bottom-nav";
import { requireProfile } from "@/lib/server/profile";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireProfile();
  return (
    <>
      <main className="mx-auto max-w-xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
      <BottomNav />
    </>
  );
}
