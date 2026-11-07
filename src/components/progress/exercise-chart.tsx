"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cx } from "@/components/ui";

export interface ChartPoint {
  date: string; // ISO
  label: string;
  topWeight: number;
  e1rm: number | null;
  volume: number;
  reps: number;
}

const METRICS = [
  { key: "topWeight", label: "Top weight" },
  { key: "e1rm", label: "Est. 1RM" },
  { key: "volume", label: "Volume" },
  { key: "reps", label: "Total reps" },
] as const;

type MetricKey = (typeof METRICS)[number]["key"];

export function ExerciseChart({ data, unit, bodyweight }: { data: ChartPoint[]; unit: string; bodyweight: boolean }) {
  const available = bodyweight ? METRICS.filter((m) => m.key === "reps") : METRICS;
  const [metric, setMetric] = useState<MetricKey>(available[0].key);
  const suffix = metric === "reps" ? " reps" : ` ${unit}`;

  return (
    <div>
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1 md:max-w-lg" role="group" aria-label="Chart measure">
        {available.map((m) => (
          <button key={m.key} type="button" onClick={() => setMetric(m.key)} aria-pressed={metric === m.key}
            className={cx("h-8 flex-1 shrink-0 rounded-lg px-2 text-xs font-medium transition", metric === m.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="h-56 w-full md:h-64 lg:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--fg)", fontSize: 13, boxShadow: "var(--shadow)" }}
              labelStyle={{ color: "var(--muted)" }}
              formatter={(v) => [`${typeof v === "number" ? v.toLocaleString() : v}${suffix}`, METRICS.find((m) => m.key === metric)!.label]}
            />
            <Line type="monotone" dataKey={metric} stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3.5, fill: "var(--chart-1)", stroke: "var(--surface)", strokeWidth: 1.5 }} activeDot={{ r: 5.5, stroke: "var(--surface)", strokeWidth: 2 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {metric === "e1rm" && (
        <p className="mt-2 text-xs text-muted">Estimated with the Epley formula from sets of 12 reps or fewer. It is a prediction, not a tested max.</p>
      )}
    </div>
  );
}
