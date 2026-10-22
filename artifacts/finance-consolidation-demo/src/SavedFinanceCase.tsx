import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2, Play } from 'lucide-react';
import { getConsolidationCase, runFinanceWiring } from '../../../lib/api-client-react/src/generated/api';
import { ApiError } from '../../../lib/api-client-react/src/custom-fetch';
import type {
  ConsolidationCase,
  FinanceWiringConfig,
  FinanceWiringResult,
} from '../../../lib/api-client-react/src/generated/api.schemas';
import type { ReportLine } from './finance-api';

type Props = {
  caseId: string;
  renderLines: (lines: ReportLine[], id: string) => ReactNode;
};

export function SavedFinanceCase({ caseId, renderLines }: Props) {
  const [savedCase, setSavedCase] = useState<ConsolidationCase | null>(null);
  const [result, setResult] = useState<FinanceWiringResult | null>(null);
  const [phase, setPhase] = useState<'loading' | 'running' | 'done' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAndRun() {
      setSavedCase(null);
      setResult(null);
      setError(null);
      setPhase('loading');
      try {
        if (!/^cc_[A-Za-z0-9_-]+$/.test(caseId)) {
          throw new Error('Invalid consolidation case ID. Open a saved finance case from Reuse Workbench.');
        }
        // This authenticated direct-case endpoint also checks registered sources,
        // their versions, the saved fingerprint, and the recipe configuration.
        const saved = await getConsolidationCase(caseId, {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (saved.id !== caseId || saved.recipeId !== 'finance') {
          throw new Error('This is not the requested finance consolidation case. Open a finance case from Reuse Workbench.');
        }
        setSavedCase(saved);
        setPhase('running');
        // GET validated the finance schema. Send the persisted object unchanged:
        // no demo defaults, adjustment-only adapter, or client financial math.
        // This endpoint executes finance.wiring.run_config, also used by
        // export-wiring.py and the standalone export's server.
        const calculated = await runFinanceWiring(
          { config: saved.config as unknown as FinanceWiringConfig },
          { credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setResult(calculated);
        setPhase('done');
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof ApiError && cause.status === 401
          ? 'Sign in to Reuse Workbench, then retry opening this saved case. Your authenticated session is required.'
          : cause instanceof Error ? cause.message : 'The saved finance case could not be loaded or executed.');
        setPhase('error');
      }
    }
    void loadAndRun();
    return () => controller.abort();
  }, [caseId, attempt]);

  const busy = phase === 'loading' || phase === 'running';

  return (
    <div className="min-h-[100dvh] w-full">
      <header className="border-b bg-card/60">
        <div className="max-w-5xl mx-auto px-5 py-8 md:py-12">
          <p className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Saved consolidation case · synthetic data</p>
          <h1 className="font-serif text-4xl md:text-5xl mt-2">Forecast to Report</h1>
          <p className="mt-4 max-w-2xl text-muted-foreground leading-relaxed">
            Execute the saved finance wiring through the reviewed Budget &amp; Forecast and Management Reporting engines.
            This uses the same source adapter and configuration contract as the standalone finance export.
            Figures are forecasts, not actuals.
          </p>
          <a href="/" className="inline-block mt-4 text-sm text-primary underline" data-testid="link-workbench">Back to Reuse Workbench</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm num break-all" data-testid="text-consolidation-case-id">{caseId || 'Missing case ID'}</p>
          <button
            onClick={retry}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:opacity-90"
            data-testid="button-run-saved-finance"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {phase === 'error' ? 'Retry saved case' : 'Run saved configuration'}
          </button>
        </div>

        {busy && (
          <p role="status" className="text-sm text-muted-foreground" data-testid="status-saved-finance-loading">
            {phase === 'loading' ? 'Loading and validating your saved case and registered sources…' : 'Executing the saved configuration with the reviewed finance sources…'}
          </p>
        )}

        {error && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 flex gap-3" data-testid="status-saved-finance-error">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Saved finance case could not run</p>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-muted-foreground">No demonstration configuration or substitute results have been used.</p>
            </div>
          </div>
        )}

        {savedCase && (
          <section className="rounded-lg border bg-card p-5 space-y-4">
            <div>
              <h2 className="font-serif text-2xl" data-testid="text-saved-finance-title">{savedCase.title}</h2>
              <p className="text-sm text-muted-foreground mt-1" data-testid="text-saved-finance-need">{savedCase.need}</p>
              <p className="text-xs text-muted-foreground mt-2" data-testid="text-saved-finance-revision">Saved revision {savedCase.revision} · recipe {savedCase.recipeId}</p>
            </div>
            <div>
              <h3 className="font-medium text-sm mb-2">Saved configuration (read-only)</h3>
              <pre className="rounded-md border bg-background p-3 text-xs num overflow-x-auto" data-testid="text-saved-finance-config">{JSON.stringify(savedCase.config, null, 2)}</pre>
            </div>
            <p className="text-xs text-muted-foreground break-all num" data-testid="text-saved-case-fingerprint">Case fingerprint: {savedCase.fingerprint}</p>
            <p className="text-xs text-muted-foreground">To change this configuration, edit and save the case in Reuse Workbench, then run it again here.</p>
          </section>
        )}

        {result && (
          <>
            <section className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
                <h2 className="font-serif text-2xl">Report lines</h2>
                <p className="text-xs text-muted-foreground" data-testid="text-result-label">
                  {result.period} · {result.currency} · total Q4 adjustment {result.adjustment}
                </p>
              </div>
              {renderLines(result.lines, 'total')}
              <p className="mt-4 text-xs text-muted-foreground leading-relaxed" data-testid="text-note">{result.note}</p>
            </section>
            <section className="rounded-lg border bg-card p-5">
              <h2 className="font-serif text-2xl mb-4">Monthly breakdown</h2>
              <div className="space-y-6">
                {result.months.map((month) => (
                  <div key={month.period}>
                    <h3 className="text-xs uppercase tracking-wider font-semibold text-primary mb-1">{month.period}</h3>
                    {renderLines(month.lines, `month-${month.period}`)}
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-lg border bg-card p-5 space-y-3">
              <h2 className="font-serif text-2xl">Executed source receipt</h2>
              <p className="text-xs text-muted-foreground break-all num" data-testid="text-finance-wiring-fingerprint">Source/configuration fingerprint: {result.fingerprint}</p>
              <ul className="divide-y border rounded-md">
                {result.sourceHashes.map((source) => (
                  <li key={source.path} className="p-3" data-testid={`text-hash-${source.path}`}>
                    <p className="num text-xs font-medium break-all">{source.path}</p>
                    <p className="num text-[11px] text-muted-foreground break-all mt-1">sha256 {source.sha256}</p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
