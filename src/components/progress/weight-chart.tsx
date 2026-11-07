"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fmt = (t: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(t);

/**
 * Entries as faint dots, with the trend as the line, so the eye follows the trend and not each weigh-in. The axis is
 * time, so a gap in the log shows as a gap, and a slope across it isn't mistaken for one day's change.
 */
export function WeightChart({ data, unit }: { data: { date: string; weight: number; trend: number }[]; unit: string }) {
  const points = data.map((d) => ({ t: toTime(d.date), weight: d.weight, trend: d.trend }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--fg)" }}
            labelStyle={{ color: "var(--muted)" }}
            labelFormatter={(t) => fmt(Number(t))}
            formatter={(v, name) => [`${typeof v === "number" ? v.toLocaleString() : v} ${unit}`, name === "trend" ? "Trend" : "Logged"]}
          />
          <Line type="monotone" dataKey="weight" stroke="var(--muted)" strokeOpacity={0} dot={{ r: 2, fill: "var(--muted)", strokeWidth: 0 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="trend" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
