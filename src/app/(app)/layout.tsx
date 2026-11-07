import { BottomNav, SideNav } from "@/components/bottom-nav";
import { requireProfile } from "@/lib/server/profile";

// One responsive shell, by CSS breakpoints only:
// - phones: one column, bottom bar;
// - tablets (md, 768 px): a wider column, still with the bottom bar;
// - desktop (lg, 1024 px): a side bar, and content up to 1200 px beside it.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireProfile();
  return (
    <>
      <SideNav />
      <div className="lg:pl-60">
        <main className="mx-auto w-full max-w-xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:max-w-3xl md:px-6 lg:max-w-[1200px] lg:px-10 lg:pb-12">
          {children}
        </main>
      </div>
      <BottomNav />
    </>
  );
}
