import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { dayEpoch } from "@/lib/analytics-aggregate";

export interface Datum { key: string; label: string; real: number; demo: number; note?: string }

const REAL = "hsl(var(--primary))";
const DEMO = "hsl(var(--muted-foreground) / 0.45)";

/** Stacked real/demo bar chart. Every bar is clickable; native buttons below give the keyboard + text equivalent. */
export function DrillChart({ data, onPick, active, testid, layout = "horizontal", caption, showDemo = true }: {
  data: Datum[]; onPick: (key: string) => void; active?: string | null; testid: string; layout?: "horizontal" | "vertical"; caption: string; showDemo?: boolean;
}) {
  const vertical = layout === "vertical";
  const h = vertical ? Math.max(120, data.length * 44 + 30) : 200;
  if (data.every((d) => d.real + d.demo === 0)) {
    return <p className="rounded-xl border border-dashed border-input px-4 py-8 text-center text-[13.5px] text-muted-foreground" data-testid={`${testid}-empty`}>No records yet.</p>;
  }
  return (
    <div data-testid={testid}>
      <div aria-hidden="true" style={{ height: h }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={vertical ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 0, left: vertical ? 4 : -18 }} barCategoryGap="22%">
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" horizontal={!vertical} vertical={vertical} />
            {vertical ?
              <XAxis type="number" allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
              :
              <XAxis type="category" dataKey="label" tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
            }
            {vertical ?
              <YAxis type="category" dataKey="label" width={118} tick={{ fill: "hsl(var(--foreground))", fontSize: 12 }} axisLine={false} tickLine={false} />
              :
              <YAxis type="number" allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
            }
            <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10, color: "hsl(var(--popover-foreground))", fontSize: 12 }} />
            <Bar dataKey="real" name="Real" stackId="s" fill={REAL} cursor="pointer" onClick={(d: { key?: string }) => d?.key && onPick(d.key)} radius={showDemo ? 0 : 4} maxBarSize={44} />
            {showDemo && <Bar dataKey="demo" name="Demo data" stackId="s" fill={DEMO} cursor="pointer" onClick={(d: { key?: string }) => d?.key && onPick(d.key)} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={44} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {showDemo && (
        <div className="mt-1 flex gap-4 text-[11.5px] text-muted-foreground" aria-hidden="true">
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: REAL }} />Real</span>
          <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: DEMO }} />Demo data</span>
        </div>
      )}
      <ul className="mt-3 grid gap-1.5" aria-label={caption}>
        {data.map((d) => (
          <li key={d.key}>
            <button type="button" onClick={() => onPick(d.key)} aria-pressed={active === d.key} data-testid={`${testid}-open-${d.key}`}
              className={cn("flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active === d.key ? "border-primary bg-secondary" : "border-border")}>
              <span className="font-medium">{d.label}</span>
              {d.note && <span className="text-[11.5px] text-muted-foreground">{d.note}</span>}
              <span className="ml-auto font-mono text-[12.5px] font-semibold tabular-nums">{d.real + d.demo}</span>
              {showDemo && <span className="font-mono text-[11px] text-muted-foreground">{d.real} real · {d.demo} demo</span>}
              <span className="sr-only">View records</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAY = 86_400_000;
const fmtUTC = (t: number) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** Registrations per persisted UTC date on a true numeric time axis: gaps between dates stay visible, nothing is interpolated. */
export function TimeColumns({ days, onPick, active, testid }: {
  days: { day: string; sources: number; prototypes: number }[]; onPick: (day: string) => void; active?: string | null; testid: string;
}) {
  const data = days.map((d) => ({ t: dayEpoch(d.day), key: d.day, total: d.sources + d.prototypes }));
  const min = data[0].t, max = data[data.length - 1].t;
  const pad = Math.max(2 * DAY, (max - min) * 0.04);
  const spanDays = (max - min) / DAY;
  const minWidth = Math.min(4000, Math.max(0, spanDays * 8, data.length * 22));
  const pick = (d: { key?: string; payload?: { key?: string } }) => { const k = d?.key ?? d?.payload?.key; if (k) onPick(k); };
  return (
    <div data-testid={testid}>
      <div className="overflow-x-auto" aria-hidden="true">
        <div style={{ height: 210, minWidth }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis type="number" dataKey="t" scale="time" domain={[min - pad, max + pad]} tickFormatter={(t: number) => fmtUTC(t)} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
              <YAxis type="number" allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} labelFormatter={(t) => fmtUTC(Number(t)) + " UTC"} formatter={(v) => [String(v), "Registrations"]}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10, color: "hsl(var(--popover-foreground))", fontSize: 12 }} />
              <Bar dataKey="total" name="Registrations" fill="hsl(var(--primary))" barSize={10} radius={[3, 3, 0, 0]} cursor="pointer" onClick={pick} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">Dates in UTC. Spacing follows elapsed time.</p>
      <ul className="mt-3 grid max-h-64 gap-1.5 overflow-y-auto" aria-label="Registrations by date, open records">
        {days.map((d) => (
          <li key={d.day}>
            <button type="button" onClick={() => onPick(d.day)} aria-pressed={active === d.day} data-testid={`${testid}-open-${d.day}`}
              className={cn("flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active === d.day ? "border-primary bg-secondary" : "border-border")}>
              <span className="font-medium">{fmtUTC(dayEpoch(d.day))}</span>
              <span className="text-[11.5px] text-muted-foreground">{d.sources} source{d.sources === 1 ? "" : "s"} · {d.prototypes} prototype{d.prototypes === 1 ? "" : "s"}</span>
              <span className="ml-auto font-mono text-[12.5px] font-semibold tabular-nums">{d.sources + d.prototypes}</span>
              <span className="sr-only">View records</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
