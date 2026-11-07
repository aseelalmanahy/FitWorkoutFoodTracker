"use client";

import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLegend } from "@/components/progress/chart-legend";

const tooltip = { contentStyle: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--fg)", fontSize: 13, boxShadow: "var(--shadow)" }, labelStyle: { color: "var(--muted)" }, cursor: { fill: "var(--surface-2)", opacity: 0.6 } };
const axis = { tick: { fill: "var(--muted)", fontSize: 11 }, tickLine: false, axisLine: false } as const;

export function DailyIntakeChart({ data }: { data: { label: string; kcal: number | null; target: number | null }[] }) {
  const hasTarget = data.some((d) => d.target != null);
  return (
    <div>
    <ChartLegend items={[{ label: "Calories consumed", color: "var(--chart-1)", kind: "bar" }, ...(hasTarget ? [{ label: "Target", color: "var(--muted)", kind: "dash" as const }] : [])]} />
    <div className="h-52 w-full md:h-60 lg:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} width={48} />
          <Tooltip {...tooltip} formatter={(v, name) => [v == null ? "—" : `${Math.round(Number(v)).toLocaleString()} kcal`, name === "kcal" ? "Consumed" : "Target"]} />
          <Bar dataKey="kcal" fill="var(--chart-1)" radius={[6, 6, 0, 0]} maxBarSize={44} isAnimationActive={false} />
          {data.some((d) => d.target != null) && <Line dataKey="target" stroke="var(--muted)" strokeDasharray="4 4" dot={false} strokeWidth={2} type="stepAfter" isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}

export function WeeklyTrendChart({ data }: { data: { label: string; kcal: number | null; protein: number | null }[] }) {
  return (
    <div>
    <ChartLegend items={[{ label: "Avg calories (left axis)", color: "var(--chart-1)", kind: "line" }, { label: "Avg protein, g (right axis)", color: "var(--chart-2)", kind: "dash" }]} />
    <div className="h-48 w-full md:h-56 lg:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis yAxisId="k" {...axis} width={48} />
          <YAxis yAxisId="p" orientation="right" {...axis} width={36} />
          <Tooltip {...tooltip} formatter={(v, name) => [v == null ? "—" : name === "kcal" ? `${Math.round(Number(v)).toLocaleString()} kcal` : `${Math.round(Number(v))} g`, name === "kcal" ? "Avg calories" : "Avg protein"]} />
          <Line yAxisId="k" dataKey="kcal" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--chart-1)", strokeWidth: 0 }} connectNulls isAnimationActive={false} />
          <Line yAxisId="p" dataKey="protein" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="6 3" dot={{ r: 2.5, fill: "var(--chart-2)", strokeWidth: 0 }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    </div>
  );
}
