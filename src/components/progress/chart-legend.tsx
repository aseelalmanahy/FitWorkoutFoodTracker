/** A small legend above a chart. Each series is named in words, and drawn as it appears, so colour isn't the only cue. */
export function ChartLegend({ items }: { items: { label: string; color: string; kind: "line" | "dash" | "dot" | "bar" }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden>
            {i.kind === "bar" ? <rect x="5" y="0" width="8" height="10" rx="2" fill={i.color} />
              : i.kind === "dot" ? <circle cx="9" cy="5" r="3" fill={i.color} />
              : <line x1="1" y1="5" x2="17" y2="5" stroke={i.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={i.kind === "dash" ? "4 3" : undefined} />}
          </svg>
          {i.label}
        </li>
      ))}
    </ul>
  );
}
