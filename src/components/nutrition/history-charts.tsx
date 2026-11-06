"use client";

import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const tooltip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--fg)", fontSize: 13 }, labelStyle: { color: "var(--muted)" } };
const axis = { tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false, axisLine: false } as const;

export function DailyIntakeChart({ data }: { data: { label: string; kcal: number | null; target: number | null }[] }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={48} />
          <Tooltip {...tooltip} formatter={(v, name) => [v == null ? "—" : `${Math.round(Number(v)).toLocaleString()} kcal`, name === "kcal" ? "Consumed" : "Target"]} />
          <Bar dataKey="kcal" fill="var(--accent)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
          {data.some((d) => d.target != null) && <Line dataKey="target" stroke="var(--muted)" strokeDasharray="4 4" dot={false} strokeWidth={2} type="stepAfter" isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeeklyTrendChart({ data }: { data: { label: string; kcal: number | null; protein: number | null }[] }) {
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis yAxisId="k" {...axis} width={48} />
          <YAxis yAxisId="p" orientation="right" {...axis} width={36} />
          <Tooltip {...tooltip} formatter={(v, name) => [v == null ? "—" : name === "kcal" ? `${Math.round(Number(v)).toLocaleString()} kcal` : `${Math.round(Number(v))} g`, name === "kcal" ? "Avg calories" : "Avg protein"]} />
          <Line yAxisId="k" dataKey="kcal" stroke="var(--accent-ink)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          <Line yAxisId="p" dataKey="protein" stroke="var(--info)" strokeWidth={2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
