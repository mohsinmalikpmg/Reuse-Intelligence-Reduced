import { useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import {
  getGetCodeAssessmentQueryKey, getGetIntakeSessionQueryKey,
  useGetCodeAssessment, useGetIntakeSession, useGetLibraryCodePackage,
  type CodeCapabilityEvidence, type CodeRequirementAssessment, type LibraryCodePackage,
} from "@workspace/api-client-react";
import { Skel, Tag, btn } from "@/components/bits";
import { AcceptanceChecks } from "./acceptance-checks";
import { UploadedSourceEvidence } from "@/components/solution-packages";

const labels = { covered: "Covered in demo base", borrow: "Borrow · integration proposed", partial: "Partial · build needed", missing: "Missing · investigate or build", constraint: "Constraint · validate" } as const;
const scopeNote = "This shared package is a runnable deterministic demo workflow engine and reusable elements, not a set of full independent enterprise applications. Preview-only catalog entries without indexed code remain unverified.";

function SourceEvidence({ evidence }: { evidence: CodeCapabilityEvidence }) {
  return (
    <div className="mt-2 space-y-2 text-[13px]">
      <p className="break-words font-mono">{evidence.file} · {evidence.symbol} · lines {evidence.lines.join("–") || "not recorded"}</p>
      <Tag tone={evidence.tested ? "green" : "slate"}>{evidence.tested ? "Indexed test coverage" : "Code-inspected only"}</Tag>
      <p className="text-muted-foreground">Test coverage is not proof that the full requirement or proposed integration has been verified.</p>
      {evidence.limitations.length > 0 ? (
        <ul className="list-disc pl-5">{evidence.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>
      ) : <p className="text-muted-foreground">No additional limitations recorded in this citation.</p>}
    </div>
  );
}

function Requirement({ item }: { item: CodeRequirementAssessment }) {
  return (
    <li className="card-soft p-4" data-testid={`code-requirement-${item.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag>Priority {item.priority}</Tag>
        <Tag tone={item.status === "covered" ? "green" : item.status === "borrow" ? "sky" : "sienna"}>{labels[item.status]}</Tag>
      </div>
      <h4 className="mt-2 text-[15px] font-semibold">{item.text}</h4>
      <p className="mt-1 text-[14px] text-muted-foreground">{item.note}</p>
      <details className="mt-3 text-[14px]">
        <summary className="cursor-pointer font-semibold text-primary">Source citations, integration &amp; limitations ({item.matches.length})</summary>
        {item.matches.length ? item.matches.map((match, i) => (
          <div key={`${match.solutionId}-${match.capabilityId}-${i}`} className="mt-3 border-t border-border pt-3">
            <Link href={`/solutions/${match.solutionId}`} className="font-semibold text-primary underline">{match.solutionName}</Link>
            <span> · {match.capabilityName}</span>
            <SourceEvidence evidence={match.evidence} />
            <p className="mt-2"><span className="font-semibold">Integration: </span>{match.integration || "No integration instructions recorded."}</p>
          </div>
        )) : <p className="mt-2 text-muted-foreground">No matching source implementation indexed for this requirement.</p>}
      </details>
    </li>
  );
}

function PackageDownload({ packageId }: { packageId: string }) {
  const session = useGetIntakeSession({
    query: { queryKey: getGetIntakeSessionQueryKey(), staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, retry: 1 },
    request: { credentials: "same-origin" },
  });
  if (session.isLoading) return <p role="status" className="text-[14px] text-muted-foreground">Checking sign-in for download…</p>;
  if (session.isError || !session.data) return <p role="alert" className="text-[14px] text-bad">Could not check download access. <button className="underline" onClick={() => session.refetch()}>Retry</button></p>;
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  return session.data.user ? (
    <a className={btn.secondary} href={`/api/library/code-packages/${encodeURIComponent(packageId)}/download`} data-testid="download-code-package">Download ZIP</a>
  ) : (
    <a className={btn.secondary} href={`/api/login?returnTo=${encodeURIComponent(returnTo)}`} data-testid="signin-code-package">Sign in to download ZIP</a>
  );
}

function PackageMetadata({ pkg }: { pkg: LibraryCodePackage }) {
  return (
    <div className="card-soft mt-5 p-5" data-testid="code-package-metadata">
      <h3 className="text-[17px] font-semibold">Indexed library code package</h3>
      <p className="mt-1 text-[14px]">{pkg.scope}</p>
      <p className="mt-2 text-[13px] text-muted-foreground">{scopeNote}</p>
      <p className="mt-3 break-words text-[13px]">{pkg.packageId} · v{pkg.version} · Created {new Date(pkg.createdAt).toLocaleString()}</p>
      <p className="mt-1 break-all font-mono text-[12px]">SHA-256: {pkg.sha256}</p>
      <div className="mt-4"><PackageDownload packageId={pkg.packageId} /></div>
      <details className="mt-4 text-[14px]">
        <summary className="cursor-pointer font-semibold text-primary">Recorded package checks &amp; file manifest</summary>
        <p className="mt-2 text-[13px] text-muted-foreground">Recorded run checks on this package, not new checks run on your input. Source inspection alone is not an executed check.</p>
        {pkg.checks.length ? <ul className="mt-2 space-y-1">{pkg.checks.map((check, i) => <li key={i}><Tag tone={check.passed ? "green" : "sienna"}>{check.passed ? "Passed" : "Failed"}</Tag> {check.name}</li>)}</ul> : <p className="mt-2">No executed package checks recorded.</p>}
        <ul className="mt-3 space-y-2">{pkg.files.map((file) => <li key={file.path} className="break-all font-mono text-[12px]">{file.path}<br /><span className="text-muted-foreground">SHA-256: {file.sha256}</span></li>)}</ul>
      </details>
    </div>
  );
}

type Step = { kind: "borrow" | "gap"; item: CodeRequirementAssessment };

export function CodeAssessment({ briefId }: { briefId: string }) {
  const query = useGetCodeAssessment(briefId, { query: { queryKey: getGetCodeAssessmentQueryKey(briefId), enabled: !!briefId } });
  const [phase, setPhase] = useState<"choose" | "walk" | "overview" | "check">("choose");
  const [i, setI] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [tech, setTech] = useState(false);
  if (query.isLoading) return <section className="mt-10" aria-label="Code-grounded assessment" role="status"><p className="mb-3 text-[14px] text-muted-foreground">Checking which existing code fits your need…</p><Skel className="h-44" /></section>;
  if (query.isError || !query.data) return <section className="card-soft mt-10 p-5" role="alert"><h2 className="font-semibold">Recommendation unavailable</h2><p className="mt-2 text-[14px]">Source evidence could not load. Catalog descriptions are not a substitute.</p><button className={`${btn.secondary} mt-3`} onClick={() => query.refetch()}>Retry</button></section>;
  const report = query.data;
  const best = report.candidates.find((c) => c.solutionId === report.bestSolutionId);
  const alts = report.candidates.filter((c) => c.solutionId !== report.bestSolutionId).sort((a, b) => b.weightedCoverage - a.weightedCoverage).slice(0, 2);
  const helps = report.requirements.filter((r) => r.status === "covered");
  const remains = report.requirements.filter((r) => r.status !== "covered");
  const steps: Step[] = [
    ...report.requirements.filter((r) => r.status === "borrow").map((item) => ({ kind: "borrow" as const, item })),
    ...report.requirements.filter((r) => r.status === "partial" || r.status === "missing" || r.status === "constraint").map((item) => ({ kind: "gap" as const, item })),
  ];
  const cur = steps[i];
  const next = () => (i + 1 < steps.length ? setI(i + 1) : setPhase("overview"));
  const limits = (
    <div className="rounded-xl border-l-4 border-l-sienna bg-secondary/60 p-4 text-[14px]" data-testid="assessment-limitations">
      <span className="font-semibold">Keep in mind: </span>"Covered" means matching code exists in the demo base, not that your full need is met. Borrowed parts are proposals; integration is not verified.
      {report.limitations.length > 0 && <ul className="mt-2 list-disc pl-5 text-muted-foreground">{report.limitations.map((t, k) => <li key={k}>{t}</li>)}</ul>}
    </div>
  );
  return (
    <section className="mt-10 space-y-5" data-testid="code-assessment">
      {phase === "choose" && <>
        <div className="card-soft border-l-4 border-l-primary p-6">
          <div className="eyebrow mb-2">Our recommendation</div>
          <h2 className="text-[26px] font-semibold">{best ? `Start from ${best.name}` : "No existing code is a good starting point"}</h2>
          {best ? <div className="mt-4 grid gap-4 md:grid-cols-3 text-[14.5px]">
            <div><div className="font-semibold text-primary">What it already helps with</div><p className="mt-1">{helps.length ? helps.slice(0, 3).map((r) => r.text).join("; ") : "Nothing fully covered yet."}{helps.length > 3 ? ` and ${helps.length - 3} more` : ""}</p></div>
            <div><div className="font-semibold text-siennaink">What remains</div><p className="mt-1">{remains.length ? `${remains.length} requirement${remains.length === 1 ? "" : "s"} to borrow, build or validate` : "No open requirements found in this check."}</p></div>
            <div><div className="font-semibold text-primary">Why this one</div><p className="mt-1">It has the most matching code for your highest-priority needs.</p></div>
          </div> : <p className="mt-2 text-[14.5px]">Review the gaps before choosing anything. A catalog suggestion is not code evidence.</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            {best ? <button className={btn.primary} data-testid="button-continue-recommendation" onClick={() => { setI(0); setPhase(steps.length ? "walk" : "overview"); }}>Continue with {best.name} <ArrowRight className="h-5 w-5" /></button>
              : <button className={btn.primary} onClick={() => { setI(0); setPhase(steps.length ? "walk" : "overview"); }}>Review the gaps <ArrowRight className="h-5 w-5" /></button>}
            {best && <Link href={`/solutions/${best.solutionId}`} className={btn.quiet}>See examples</Link>}
          </div>
        </div>
        {alts.length > 0 && <div>
          <h3 className="mb-2 text-[15px] font-semibold text-muted-foreground">Other possible starting points</h3>
          <ul className="grid gap-3 md:grid-cols-2">{alts.map((a) => <li key={a.solutionId} className="card-soft flex items-center gap-3 p-4" data-testid={`alt-${a.solutionId}`}>
            <span className="min-w-0 flex-1"><span className="block font-semibold">{a.name}</span><span className="text-[13px] text-muted-foreground">Another code-backed option. Explore it to see examples.</span></span>
            <Link href={`/solutions/${a.solutionId}`} className={btn.secondary}>Explore</Link>
          </li>)}</ul>
          <p className="mt-2 text-[12.5px] text-muted-foreground">Exploring an alternative does not re-run this assessment from a different base.</p>
        </div>}
      </>}

      {phase === "walk" && cur && <div className="card-soft p-6" data-testid="assessment-step">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground"><span>{i + 1} of {steps.length}</span><span>·</span><span>{cur.kind === "borrow" ? "Proposed to borrow" : "Still a gap"}</span><span className="flex-1" /><button className="underline" onClick={() => setPhase("overview")}>Review overview</button></div>
        <h3 className="mt-3 text-[22px] font-semibold">{cur.item.text}</h3>
        <p className="mt-2 text-[15px]">{cur.kind === "borrow" && cur.item.matches[0] ? `Borrow "${cur.item.matches[0].capabilityName}" from ${cur.item.matches[0].solutionName}.` : labels[cur.item.status]}</p>
        <p className="mt-1 text-[14px] text-muted-foreground">{cur.item.note}</p>
        <details className="mt-4 text-[14px]"><summary className="cursor-pointer font-semibold text-primary">Show source evidence ({cur.item.matches.length})</summary>
          {cur.item.matches.length ? cur.item.matches.map((m, k) => <div key={k} className="mt-3 border-t border-border pt-3"><Link href={`/solutions/${m.solutionId}`} className="font-semibold text-primary underline">{m.solutionName}</Link> · {m.capabilityName}<SourceEvidence evidence={m.evidence} /><p className="mt-2"><span className="font-semibold">Integration: </span>{m.integration || "No integration instructions recorded."}</p></div>) : <p className="mt-2 text-muted-foreground">No matching source implementation indexed.</p>}
        </details>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className={btn.primary} onClick={() => { setSkipped(skipped.filter((x) => x !== cur.item.id)); next(); }}>{cur.kind === "borrow" ? "Noted, next" : "Understood, next"} <ArrowRight className="h-5 w-5" /></button>
          <button className={btn.quiet} onClick={() => (i > 0 ? setI(i - 1) : setPhase("choose"))}><ArrowLeft className="h-4 w-4" /> Back</button>
          <button className={btn.quiet} onClick={() => { setSkipped([...new Set([...skipped, cur.item.id])]); next(); }}>Skip for now</button>
        </div>
      </div>}

      {phase === "overview" && <div className="card-soft p-6" data-testid="assessment-overview">
        <h3 className="text-[22px] font-semibold">{best ? `Your plan starting from ${best.name}` : "Your open gaps"}</h3>
        {steps.length ? <ol className="mt-4 space-y-2">{steps.map((st, k) => <li key={st.item.id}><button className="flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:border-primary/50" onClick={() => { setI(k); setPhase("walk"); }}>
          <Tag tone={st.kind === "borrow" ? "sky" : "sienna"}>{st.kind === "borrow" ? "Borrow" : "Gap"}</Tag>
          <span className="min-w-0 flex-1 text-[14.5px]">{st.item.text}</span>
          {skipped.includes(st.item.id) && <span className="text-[12.5px] text-muted-foreground">Skipped</span>}
        </button></li>)}</ol> : <p className="mt-2 text-[14px] text-muted-foreground">Nothing to borrow and no gaps identified. This is not full-needs verification.</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button className={btn.primary} data-testid="button-to-acceptance" onClick={() => setPhase("check")}>Check it against my requirements <ArrowRight className="h-5 w-5" /></button>
          <button className={btn.quiet} onClick={() => setPhase("choose")}><ArrowLeft className="h-4 w-4" /> Back to recommendation</button>
        </div>
      </div>}

      {phase === "check" && <>
        <button className={btn.quiet} onClick={() => setPhase("overview")}><ArrowLeft className="h-4 w-4" /> Back to overview</button>
        <AcceptanceChecks briefId={briefId} />
      </>}

      {limits}
      <button className={btn.quiet} onClick={() => setTech(!tech)} aria-expanded={tech} data-testid="button-technical-details">{tech ? "Hide" : "Show"} technical details</button>
      {tech && <>
        <div><h3 className="mb-3 text-[17px] font-semibold">Every requirement, by priority</h3>
          {report.requirements.length ? <ol className="space-y-3">{report.requirements.map((item) => <Requirement key={item.id} item={item} />)}</ol> : <p className="text-[14px] text-muted-foreground">No requirements were available to assess.</p>}</div>
        <PackageMetadata pkg={report.package} />
      </>}
    </section>
  );
}

/** Code package evidence; IT sees it directly, seekers open it on request. */
export function SolutionCodePackageToggle({ solutionId, open: initial }: { solutionId: string; open: boolean }) {
  const [open, setOpen] = useState(initial);
  if (open) return <SolutionCodePackage solutionId={solutionId} />;
  return <button className={`${btn.quiet} mt-6`} onClick={() => setOpen(true)} data-testid="button-show-code-evidence">Show code evidence and download</button>;
}

export function SolutionCodePackage({ solutionId }: { solutionId: string }) {
  const query = useGetLibraryCodePackage();
  if (query.isLoading) return <section className="mt-8" role="status"><p className="mb-2 text-[14px] text-muted-foreground">Loading code package index…</p><Skel className="h-24" /></section>;
  if (query.isError || !query.data) return <section className="card-soft mt-8 p-5" role="alert"><p>Code package index could not load.</p><button className={`${btn.secondary} mt-3`} onClick={() => query.refetch()}>Retry</button></section>;
  const pkg = query.data;
  const config = pkg.configurations.find((item) => item.solutionId === solutionId);
  if (!config) return <section className="mt-8" data-testid="no-code-package"><div className="card-soft p-5"><h2 className="text-[18px] font-semibold">No code package indexed</h2><p className="mt-2 text-[14px] text-muted-foreground">This entry is not backed by an indexed configuration. Catalog descriptions and previews remain unverified, not source evidence.</p></div><UploadedSourceEvidence solutionId={solutionId} /></section>;
  const evidence = pkg.capabilities.filter((item) => config.capabilityIds.includes(item.capabilityId));
  return (
    <section className="mt-8" data-testid="solution-code-package">
      <h2 className="text-[18px] font-semibold">Library package · demo configuration</h2>
      <PackageMetadata pkg={pkg} />
      <details className="card-soft mt-3 p-5 text-[14px]">
        <summary className="cursor-pointer font-semibold text-primary">Configuration capabilities &amp; source evidence ({config.capabilityIds.length})</summary>
        <p className="mt-2 text-[13px] text-muted-foreground">Matching implementation in the demo configuration, not verification of a full enterprise product or your full need.</p>
        <ul className="mt-3 space-y-3">{config.capabilityIds.map((id) => <li key={id} className="border-t border-border pt-3"><span className="font-semibold">{id}</span>{evidence.filter((item) => item.capabilityId === id).map((item, i) => <SourceEvidence key={i} evidence={item} />)}{!evidence.some((item) => item.capabilityId === id) && <p className="text-muted-foreground">No source citation indexed for this capability.</p>}</li>)}</ul>
      </details>
      <UploadedSourceEvidence solutionId={solutionId} />
    </section>
  );
}
