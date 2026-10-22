import { ArrowRight } from 'lucide-react';
import type { ReportLine } from './finance-api';
import { SavedFinanceCase } from './SavedFinanceCase';

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

function LibraryEntry() {
  return (
    <div className="min-h-[100dvh] w-full grid place-items-center px-5">
      <section className="rise max-w-xl rounded-xl border bg-card p-7 md:p-9" data-testid="state-no-case">
        <p className="text-[11px] uppercase tracking-[0.2em] text-accent font-semibold">Forecast to Report · combined app</p>
        <h1 className="font-serif text-3xl md:text-4xl mt-2 text-primary">Open a saved combination to run it.</h1>
        <p className="mt-4 text-muted-foreground leading-relaxed">
          This app runs one saved Forecast to Report combination exactly as it was saved: method, period, centres,
          account mapping and adjustment. It has no default configuration of its own. Choose or create the finance
          combination in the Library, then use Try it.
        </p>
        <a href="/library?recipe=finance#combine" className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90" data-testid="link-library-finance">
          Go to Library finance combination <ArrowRight className="h-4 w-4" />
        </a>
      </section>
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
  return <LibraryEntry />;
}

export default App;
