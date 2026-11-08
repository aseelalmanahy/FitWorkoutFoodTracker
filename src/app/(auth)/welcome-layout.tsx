import type { ReactNode } from "react";
import { BrandMark, WelcomeArt } from "@/components/brand";

const AREAS = [
  { title: "Training", body: "Plans, sets and progressive overload, session by session." },
  { title: "Nutrition", body: "Meals and targets, with where each value came from." },
  { title: "Progress", body: "Weight trends and personal records over time." },
];

/**
 * The welcome screen around the login form. Desktop: a quiet brand panel beside the form. Phones and tablets:
 * a compact branded header above it. Decorative only: nothing here changes how signing in works.
 */
export function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden bg-hero text-hero-fg lg:flex lg:min-h-dvh lg:flex-col lg:p-12 xl:p-16" aria-label="About FitWorkoutFoodTracker">
        <div className="flex items-center gap-3">
          <BrandMark className="h-10 w-10" />
          <span className="text-xl font-semibold tracking-tight">FitWorkoutFoodTracker</span>
        </div>
        <div className="flex max-w-md flex-1 flex-col justify-center py-10">
          <h2 className="text-[40px] font-semibold leading-[1.1] tracking-tight">Training, food and progress, in one calm place.</h2>
          <ul className="mt-10 space-y-5">
            {AREAS.map((a) => (
              <li key={a.title} className="flex gap-4">
                <span className="mt-2 h-1.5 w-6 shrink-0 rounded-full bg-hero-accent" aria-hidden />
                <span>
                  <span className="block font-semibold">{a.title}</span>
                  <span className="block text-sm text-hero-muted">{a.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {/* Its own band, so it never sits behind text. */}
        <WelcomeArt className="pointer-events-none -mx-12 h-44 w-[calc(100%+6rem)] text-hero-fg xl:-mx-16 xl:h-56 xl:w-[calc(100%+8rem)]" />
        <p className="mt-6 text-xs text-hero-muted">Your data stays in your account. Not medical advice.</p>
      </aside>

      <main className="flex min-h-dvh flex-col justify-center px-5 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="h-10 w-10" />
            <div>
              <p className="font-semibold leading-tight tracking-tight">FitWorkout<wbr />FoodTracker</p>
              <p className="text-xs text-muted">Training, food and progress</p>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
