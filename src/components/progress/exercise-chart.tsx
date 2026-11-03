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
      <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-1">
        {available.map((m) => (
          <button key={m.key} type="button" onClick={() => setMetric(m.key)}
            className={cx("h-8 flex-1 shrink-0 rounded-lg px-2 text-xs font-medium", metric === m.key ? "bg-surface text-fg shadow-sm" : "text-muted")}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--fg)", fontSize: 13 }}
              labelStyle={{ color: "var(--muted)" }}
              formatter={(v) => [`${typeof v === "number" ? v.toLocaleString() : v}${suffix}`, METRICS.find((m) => m.key === metric)!.label]}
            />
            <Line type="monotone" dataKey={metric} stroke="var(--accent-ink)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--accent-ink)", strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {metric === "e1rm" && (
        <p className="mt-2 text-xs text-muted">Estimated with the Epley formula from sets of 12 reps or fewer. It is a prediction, not a tested max.</p>
      )}
    </div>
  );
}
