import type { SearchCriteria } from "../domain/search.ts";
import type { SearchMode } from "../domain/fuzzy.ts";

const EXAMPLES: { q: string; note: string }[] = [
  { q: "borel parts", note: "supplier typo" },
  { q: "praire servces", note: "two typos, two words" },
  { q: "bp 100", note: "punctuation ignored" },
  { q: "PS-204", note: "close invoice number" },
  { q: "qxzvlm", note: "nonsense, no results" },
];

interface Props { criteria: SearchCriteria; onChange: (c: SearchCriteria) => void }

export function SearchHero({ criteria: c, onChange }: Props) {
  const set = (patch: Partial<SearchCriteria>) => onChange({ ...c, ...patch });
  const modes: { m: SearchMode; label: string; hint: string }[] = [
    { m: "fuzzy", label: "Fuzzy", hint: "tolerates typos" },
    { m: "exact", label: "Exact", hint: "exact or partial words only" },
  ];
  return (
    <section className="hero" aria-label="Fuzzy invoice search">
      <div className="hero-label">
        <span className="source-tag" data-testid="text-source-label">Source A</span>
        <span className="standout">Standout capability: typo-tolerant, explainable search</span>
      </div>
      <div className="hero-row">
        <label className="hero-input">
          <span className="sr-only">Search supplier names, invoice numbers or IDs</span>
          <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden><circle cx="14" cy="14" r="8" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M20 20l7 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
          <input data-testid="input-text" value={c.text} autoFocus placeholder="Supplier or invoice number, typos welcome"
            onChange={(e) => set({ text: e.target.value })} />
          {c.text && <button className="link-btn" data-testid="button-clear-search" onClick={() => set({ text: "" })}>Clear</button>}
        </label>
        <div className="mode" role="radiogroup" aria-label="Match mode">
          {modes.map(({ m, label, hint }) => (
            <button key={m} role="radio" aria-checked={c.mode === m} data-testid={`toggle-mode-${m}`} title={hint}
              className="mode-btn" onClick={() => set({ mode: m })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="examples">
        <span className="muted small">Try an example:</span>
        {EXAMPLES.map((e) => (
          <button key={e.q} className="example" data-testid={`button-example-${e.q.replace(/\W+/g, "-").toLowerCase()}`}
            onClick={() => set({ text: e.q, mode: "fuzzy" })}>
            <span className="mono">{e.q}</span><span className="ex-note">{e.note}</span>
          </button>
        ))}
      </div>
      <p className="hero-help muted small">
        Case and punctuation are ignored; every word must match. Exact hits always rank first. A word only falls back to
        typo tolerance (1 edit at 4-6 letters, 2 at 7+; invoice numbers 1) when nothing in the ledger matches it exactly.
        Words under 4 letters never match approximately.
      </p>
    </section>
  );
}
