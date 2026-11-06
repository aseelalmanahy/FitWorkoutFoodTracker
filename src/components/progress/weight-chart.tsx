"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Entries as faint dots, with the trend as the line, so the eye follows the trend and not each weigh-in. */
export function WeightChart({ data, unit }: { data: { label: string; weight: number; trend: number }[]; unit: string }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--fg)" }}
            labelStyle={{ color: "var(--muted)" }}
            formatter={(v, name) => [`${typeof v === "number" ? v.toLocaleString() : v} ${unit}`, name === "trend" ? "Trend" : "Logged"]}
          />
          <Line type="monotone" dataKey="weight" stroke="var(--muted)" strokeOpacity={0} dot={{ r: 2, fill: "var(--muted)", strokeWidth: 0 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="trend" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
