import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Loader2, RotateCcw, Play, FileCode2 } from 'lucide-react';
import { applyForecast, type FinanceResult, type ReportLine } from './finance-api';
import { SavedFinanceCase } from './SavedFinanceCase';

const MIN = -600;
const MAX = 6000;

function validate(raw: string): string | null {
  if (raw.trim() === '') return 'Enter a whole-dollar amount.';
  if (!/^-?\d+$/.test(raw.trim())) return 'Use a whole number of US dollars, no decimals or separators.';
  const n = Number(raw);
  if (n < MIN || n > MAX) return `Must be between -600 and 6,000.`;
  if (n % 6 !== 0) return 'Must be a multiple of 6 so it splits evenly across months and segments.';
  return null;
}

function fmt(v: string): string {
  const neg = v.trim().startsWith('-');
  const body = v.replace(/^[-+]/, '');
  const [i, d] = body.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${grouped}${d !== undefined ? '.' + d : ''}`;
}

function diffTone(v: string, id: string) {
  const t = v.trim();
  if (/^-?0*(\.0*)?$/.test(t.replace('-', ''))) return 'text-muted-foreground';
  const favourable = id === '1' || id === 'opex' ? t.startsWith('-') : !t.startsWith('-');
  return favourable ? 'text-[hsl(150_45%_28%)]' : 'text-[hsl(4_66%_42%)]';
}

function LinesTable({ lines, id }: { lines: ReportLine[]; id: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={`table-${id}`}>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b">
            <th className="py-2 pr-3 font-medium">Line</th>
            <th className="py-2 px-3 font-medium text-right">Baseline</th>
            <th className="py-2 px-3 font-medium text-right">Current</th>
            <th className="py-2 pl-3 font-medium text-right">Difference</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-border/60 last:border-0" data-testid={`row-${id}-${l.id}`}>
              <td className="py-2.5 pr-3">{l.name}</td>
              <td className="py-2.5 px-3 text-right num whitespace-nowrap">{fmt(l.baseline)}</td>
              <td className="py-2.5 px-3 text-right num whitespace-nowrap font-medium">{fmt(l.current)}</td>
              <td className={`py-2.5 pl-3 text-right num whitespace-nowrap font-semibold ${diffTone(l.difference, l.id)}`}>{fmt(l.difference)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3" data-testid="status-loading">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-4"><div className="skel h-5 flex-1" /><div className="skel h-5 w-20" /><div className="skel h-5 w-20" /><div className="skel h-5 w-16" /></div>
      ))}
    </div>
  );
}

function Home() {
  const [input, setInput] = useState('360');
  const [result, setResult] = useState<FinanceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<{ amount: number; reset: boolean }>({ amount: 0, reset: false });
  const [showSource, setShowSource] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const run = useCallback(async (amount: number, reset = false) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setError(null);
    setLastRequest({ amount, reset });
    try {
      const r = await applyForecast(amount, c.signal);
      if (c.signal.aborted) return;
      setResult(r);
      if (reset) setInput('0');
    } catch (e) {
      if (c.signal.aborted) return;
      setError(e instanceof Error ? e.message : 'The calculation could not be completed. Please retry.');
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    run(0);
    return () => ctrl.current?.abort();
  }, [run]);

  const validation = validate(input);
  const pending = !validation && result !== null && Number(input) !== result.adjustment;

  return (
    <div className="min-h-[100dvh] w-full">
      <header className="border-b bg-card/60">
        <div className="max-w-5xl mx-auto px-5 py-8 md:py-12">
          <p className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Integration proof · synthetic data</p>
          <h1 className="font-serif text-4xl md:text-5xl mt-2">Forecast to Report</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            Change the Q4 contractor forecast for two synthetic FY2026 segments, Service Delivery and Supply Chain, and see the
            management report recomputed by reused Python source on the server. These are forecast figures, not actuals. An
            expense increase reduces profit.
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-8 grid gap-8 md:grid-cols-[300px_1fr]">
        <aside className="space-y-4">
          <form
            className="rounded-lg border bg-card p-5 space-y-4"
            onSubmit={(e) => { e.preventDefault(); if (!validation && !loading) run(Number(input)); }}
          >
            <div>
              <label htmlFor="adj" className="text-sm font-medium">Total Q4 contractor adjustment (USD)</label>
              <p className="text-xs text-muted-foreground mt-1">Whole multiple of 6, from -600 to 6,000. Try 360.</p>
            </div>
            <input
              id="adj"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-invalid={!!validation}
              aria-describedby="adj-msg"
              className="w-full rounded-md border border-input bg-background px-3 py-2.5 num text-lg focus:outline-none focus:ring-2 focus:ring-ring"
              data-testid="input-adjustment"
            />
            <div id="adj-msg" className="min-h-5 text-xs" data-testid="status-validation">
              {validation ? (
                <span className="text-destructive">{validation}</span>
              ) : pending ? (
                <span className="text-accent-foreground bg-accent px-2 py-0.5 rounded">Not applied. Report still shows {fmt(String(result!.adjustment))}.</span>
              ) : result ? (
                <span className="text-muted-foreground">Report reflects this amount.</span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!!validation || loading}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:opacity-90"
                data-testid="button-apply"
              >
                {loading && !lastRequest.reset ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Apply
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => run(0, true)}
                className="inline-flex items-center gap-2 rounded-md border px-4 py-2.5 text-sm disabled:opacity-50 hover:bg-muted"
                data-testid="button-reset"
              >
                {loading && lastRequest.reset ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Reset
              </button>
            </div>
          </form>

          <div className="rounded-lg border bg-card p-5 text-sm space-y-2 text-muted-foreground leading-relaxed">
            <h2 className="text-foreground font-medium">What this proves</h2>
            <p>A narrow reuse of aggregation logic: Budget &amp; Forecast calculations feed Management Reporting line builders.</p>
            <p>It is not a full merger of the two apps, is not wired into the exporter, and is not published.</p>
            <p>All figures come from the server. This page only formats them.</p>
          </div>
        </aside>

        <section className="space-y-6 min-w-0">
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex gap-3" data-testid="status-error">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 text-sm">
                <p className="font-medium">Calculation failed</p>
                <p className="text-muted-foreground mt-1">{error}</p>
                {result && <p className="text-muted-foreground mt-1">Showing the last successful result below.</p>}
              </div>
              <button
                onClick={() => run(lastRequest.amount, lastRequest.reset)}
                className="self-start rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                data-testid="button-retry"
              >Retry</button>
            </div>
          )}

          <div className={`rounded-lg border bg-card p-5 transition-opacity ${loading && result ? 'opacity-60' : ''}`} aria-busy={loading}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <h2 className="font-serif text-2xl">Report lines</h2>
              {result && (
                <p className="text-xs text-muted-foreground" data-testid="text-result-label">
                  {error ? 'Last successful result · ' : ''}{result.period} · {result.currency} · adjustment <span className="num">{fmt(String(result.adjustment))}</span>
                </p>
              )}
            </div>
            {!result ? (error ? <p className="text-sm text-muted-foreground">No result yet. Retry above.</p> : <Skeleton />) : (
              <>
                <LinesTable lines={result.lines} id="total" />
                {result.note && <p className="mt-4 text-xs text-muted-foreground leading-relaxed" data-testid="text-note">{result.note}</p>}
              </>
            )}
          </div>

          {result && (
            <div className={`rounded-lg border bg-card p-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <h2 className="font-serif text-2xl mb-4">Monthly breakdown</h2>
              <div className="space-y-6">
                {result.months.map((m) => (
                  <div key={m.period}>
                    <h3 className="text-xs uppercase tracking-wider font-semibold text-primary mb-1">{m.period}</h3>
                    <LinesTable lines={m.lines} id={`month-${m.period}`} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border bg-card">
            <button
              onClick={() => setShowSource((s) => !s)}
              aria-expanded={showSource}
              className="w-full flex items-center justify-between gap-3 p-5 text-left"
              data-testid="button-toggle-source"
            >
              <span className="flex items-center gap-2 font-medium"><FileCode2 className="h-4 w-4 text-primary" />Reused source files</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showSource ? 'rotate-180' : ''}`} />
            </button>
            {showSource && (
              <div className="px-5 pb-5 text-sm space-y-3">
                <p className="text-muted-foreground">Original files executed unmodified: Budget &amp; Forecast <code className="num">calculations.py</code> and <code className="num">data.py</code>; Management Reporting <code className="num">reporting.py</code> and <code className="num">data.py</code>. Hashes are reported by the server.</p>
                {result ? (
                  <ul className="divide-y border rounded-md">
                    {result.sourceHashes.map((h) => (
                      <li key={h.path} className="p-3" data-testid={`text-hash-${h.path}`}>
                        <p className="num text-xs font-medium break-all">{h.path}</p>
                        <p className="num text-[11px] text-muted-foreground break-all mt-1">sha256 {h.sha256}</p>
                      </li>
                    ))}
                  </ul>
                ) : <div className="skel h-16" />}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('consolidationCaseId')) {
    return (
      <SavedFinanceCase
        caseId={params.get('consolidationCaseId') ?? ''}
        renderLines={(lines, id) => <LinesTable lines={lines} id={id} />}
      />
    );
  }
  return <Home />;
}

export default App;
