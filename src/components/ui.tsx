import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-95 active:brightness-90 font-semibold",
  secondary: "bg-surface-2 text-fg hover:bg-line font-medium",
  ghost: "text-fg hover:bg-surface-2 font-medium",
  danger: "bg-down/10 text-down hover:bg-down/20 font-medium",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm rounded-lg",
  md: "h-11 px-4 text-[15px] rounded-xl",
  lg: "h-13 px-5 text-base rounded-2xl",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex items-center justify-center gap-2 transition select-none disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type="button" className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-2xl bg-surface border border-line", className)} {...props} />;
}

export function PageHeader({ title, subtitle, action, back }: { title: string; subtitle?: ReactNode; action?: ReactNode; back?: string }) {
  return (
    <header className="flex items-end justify-between gap-3 pt-6 pb-4">
      <div className="min-w-0">
        {back && (
          <Link href={back} className="mb-1 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <span aria-hidden>‹</span> Back
          </Link>
        )}
        <h1 className="truncate text-[28px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

const inputBase =
  "w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[15px] text-fg placeholder:text-muted/70 focus:border-fg/40 focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputBase, "h-11", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputBase, "h-11 appearance-none", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputBase, "min-h-20 py-2.5", className)} {...props} />;
}

export function Field({ label, hint, error, group, children }: { label: string; hint?: ReactNode; error?: string; group?: boolean; children: ReactNode }) {
  const msg = error ? <span className="mt-1 block text-xs text-down">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null;
  // Button groups must not live inside <label>: the label would become the first button's accessible name.
  if (group) {
    return (
      <div role="group" aria-label={label}>
        <span className="mb-1.5 block text-sm font-medium">{label}</span>
        {children}
        {msg}
      </div>
    );
  }
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {msg}
    </label>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </Card>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="num mt-0.5 truncate text-xl font-bold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="rounded-xl bg-down/10 px-3 py-2 text-sm text-down">{children}</p>;
}

export function ProgressBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx("h-2 overflow-hidden rounded-full bg-surface-2", className)} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
