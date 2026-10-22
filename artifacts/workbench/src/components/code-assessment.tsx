import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  createBriefWorkbench, getGetBriefQueryKey, getGetCodeAssessmentQueryKey, useGetBrief, getGetIntakeSessionQueryKey,
  useGetCodeAssessment, useGetIntakeSession, useGetLibraryCodePackage,
  useOpenIntakeCombination, useGetCurrentAuthUser,
  type Brief, type CodeCapabilityEvidence, type CodeRequirementAssessment, type LibraryCodePackage,
} from "@workspace/api-client-react";
import { Skel, Tag, btn } from "@/components/bits";
import { errMsg, useCurrentCase } from "@/lib/case";
import { UploadedSourceEvidence } from "@/components/solution-packages";
import { AcceptanceChecks } from "@/components/acceptance-checks";

const labels = { covered: "Source reviewed", borrow: "Needs integration", partial: "Partial · build needed", missing: "Missing · investigate or build", constraint: "Constraint · validate" } as const;

function SourceEvidence({ evidence }: { evidence: CodeCapabilityEvidence }) {
  return (
    <div className="mt-2 space-y-2 text-[13px]">
      <p className="break-words font-mono">{evidence.file} · {evidence.symbol} · lines {evidence.lines.join("–") || "not recorded"}</p>
      <Tag tone={evidence.tested ? "green" : "slate"}>{evidence.tested ? "Indexed test coverage" : "Source reviewed"}</Tag>
      {evidence.limitations.length > 0 && (
        <ul className="list-disc pl-5">{evidence.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul>
      )}
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
        <summary className="cursor-pointer font-semibold text-primary">Source &amp; integration details ({item.matches.length})</summary>
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
      <p className="mt-3 break-words text-[13px]">{pkg.packageId} · v{pkg.version} · Created {new Date(pkg.createdAt).toLocaleString()}</p>
      <p className="mt-1 break-all font-mono text-[12px]">SHA-256: {pkg.sha256}</p>
      <div className="mt-4"><PackageDownload packageId={pkg.packageId} /></div>
      <details className="mt-4 text-[14px]">
        <summary className="cursor-pointer font-semibold text-primary">Recorded package checks &amp; file manifest</summary>
        {pkg.checks.length ? <ul className="mt-2 space-y-1">{pkg.checks.map((check, i) => <li key={i}><Tag tone={check.passed ? "green" : "sienna"}>{check.passed ? "Passed" : "Failed"}</Tag> {check.name}</li>)}</ul> : <p className="mt-2">No executed package checks recorded.</p>}
        <ul className="mt-3 space-y-2">{pkg.files.map((file) => <li key={file.path} className="break-all font-mono text-[12px]">{file.path}<br /><span className="text-muted-foreground">SHA-256: {file.sha256}</span></li>)}</ul>
      </details>
    </div>
  );
}

function OpenProposal({ briefId, enabled, label }: { briefId: string; enabled: boolean; label: string }) {
  const [, navigate] = useLocation();
  const { setCaseId } = useCurrentCase();
  // Idempotent on the server: going back and pressing again reopens the same case.
  const open = useMutation({
    mutationFn: () => createBriefWorkbench(briefId),
    onSuccess: (c) => { setCaseId(c.id); navigate(`/workbench/${c.id}?view=proposal`); },
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className={btn.primary} data-testid="button-open-proposed-workflow" disabled={!enabled || open.isPending} onClick={() => open.mutate()}>
        {open.isPending ? "Opening…" : label} <ArrowRight className="h-5 w-5" />
      </button>
      {open.isError && <span role="alert" className="text-[14px] text-bad" data-testid="error-open-proposed-workflow">{errMsg(open.error)} <button className="underline" onClick={() => open.mutate()}>Retry</button></span>}
    </div>
  );
}

export function CodeAssessment({ briefId }: { briefId: string }) {
  const brief = useGetBrief(briefId, { query: { queryKey: getGetBriefQueryKey(briefId), enabled: !!briefId } });
  if (brief.isLoading) return <Skel className="mt-10 h-44" />;
  if (!brief.data) return <div role="alert" className="mt-10">Intake could not load. <button className={btn.quiet} onClick={() => void brief.refetch()}>Retry</button></div>;
  const b = brief.data;
  const text = [b.rawText, b.today, b.better, b.valueStatement, b.clarification, ...b.requirements.map(r => r.text)].filter(Boolean).join(" ");
  const recipe = FINANCE_RE.test(text) ? "finance" : INVOICE_RE.test(text) ? "invoice" : null;
  return recipe ? <CombineShortcut brief={b} recipe={recipe} /> : <MaintenanceAssessment briefId={briefId} />;
}

function MaintenanceAssessment({ briefId }: { briefId: string }) {
  const query = useGetCodeAssessment(briefId, { query: { queryKey: getGetCodeAssessmentQueryKey(briefId), enabled: !!briefId } });
  const [tech, setTech] = useState(false);
  if (query.isLoading) return <section className="mt-10" aria-label="Code-grounded assessment" role="status"><p className="mb-3 text-[14px] text-muted-foreground">Checking which existing code fits your need…</p><Skel className="h-44" /></section>;
  if (query.isError || !query.data) return <section className="card-soft mt-10 p-5" role="alert"><h2 className="font-semibold">Recommendation unavailable</h2><p className="mt-2 text-[14px]">Source evidence could not load.</p><button className={`${btn.secondary} mt-3`} onClick={() => query.refetch()}>Retry</button></section>;
  const report = query.data;
  const best = report.candidates.find((c) => c.solutionId === report.bestSolutionId);
  const alts = report.candidates.filter((c) => c.solutionId !== report.bestSolutionId).sort((a, b) => b.weightedCoverage - a.weightedCoverage).slice(0, 2);
  return (
    <section className="mt-10 space-y-5" data-testid="code-assessment">
      <div className="card-soft border-l-4 border-l-primary p-6">
        <div className="eyebrow mb-2">Proposed workflow</div>
        <h2 className="text-[26px] font-semibold">{best ? `Start from ${best.name}` : "No existing solution fits as a base"}</h2>
        {best && <p className="mt-2 text-[14.5px] text-muted-foreground" data-testid="proposal-summary">See how the pieces fit together.</p>}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <OpenProposal briefId={briefId} enabled={!!best} label="Open proposed workflow" />
          {best && <Link href={`/solutions/${best.solutionId}`} className={btn.quiet}>See examples</Link>}
        </div>
        {!best && <p className="mt-3 text-[14px] text-muted-foreground" data-testid="text-no-base">Nothing indexed covers your top needs. See technical details for the gaps.</p>}
      </div>
      {alts.length > 0 && <div>
        <h3 className="mb-2 text-[15px] font-semibold text-muted-foreground">Other starting points</h3>
        <ul className="grid gap-3 md:grid-cols-2">{alts.map((a) => <li key={a.solutionId} className="card-soft flex items-center gap-3 p-4" data-testid={`alt-${a.solutionId}`}>
          <span className="min-w-0 flex-1 font-semibold">{a.name}</span>
          <Link href={`/solutions/${a.solutionId}`} className={btn.secondary}>Explore</Link>
        </li>)}</ul>
      </div>}

      <button className={btn.quiet} onClick={() => setTech(!tech)} aria-expanded={tech} data-testid="button-technical-details">{tech ? "Hide" : "Show"} technical details</button>
      {tech && <>
        <div><h3 className="mb-3 text-[17px] font-semibold">Every requirement, by priority</h3>
          {report.requirements.length ? <ol className="space-y-3">{report.requirements.map((item) => <Requirement key={item.id} item={item} />)}</ol> : <p className="text-[14px] text-muted-foreground">No requirements were available to assess.</p>}</div>
        <PackageMetadata pkg={report.package} />
        <AcceptanceChecks briefId={briefId} />
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
  if (!config) return <section className="mt-8" data-testid="no-code-package"><div className="card-soft p-5"><h2 className="text-[18px] font-semibold">No code package indexed</h2></div><UploadedSourceEvidence solutionId={solutionId} /></section>;
  const evidence = pkg.capabilities.filter((item) => config.capabilityIds.includes(item.capabilityId));
  return (
    <section className="mt-8" data-testid="solution-code-package">
      <h2 className="text-[18px] font-semibold">Library package · demo configuration</h2>
      <PackageMetadata pkg={pkg} />
      <details className="card-soft mt-3 p-5 text-[14px]">
        <summary className="cursor-pointer font-semibold text-primary">Configuration capabilities &amp; source evidence ({config.capabilityIds.length})</summary>
        <ul className="mt-3 space-y-3">{config.capabilityIds.map((id) => <li key={id} className="border-t border-border pt-3"><span className="font-semibold">{id}</span>{evidence.filter((item) => item.capabilityId === id).map((item, i) => <SourceEvidence key={i} evidence={item} />)}{!evidence.some((item) => item.capabilityId === id) && <p className="text-muted-foreground">No source citation indexed for this capability.</p>}</li>)}</ul>
      </details>
      <UploadedSourceEvidence solutionId={solutionId} />
    </section>
  );
}

const FINANCE_RE = /\b(forecast|budget|management report|reporting|cost cent(re|er)s?|q4|p&l)\b/i;
const INVOICE_RE = /\b(invoices?|suppliers?|approv(al|e|als)|spend|line items?|purchase)\b/i;

/** When the brief reads like invoices or finance, offer the existing-source combination instead of a maintenance no-match. */
function CombineShortcut({ brief: b, recipe }: { brief: Brief; recipe: "invoice" | "finance" }) {
  const [, navigate] = useLocation();
  const open = useOpenIntakeCombination();
  const auth = useGetCurrentAuthUser();
  const label = recipe === "finance" ? "Forecast to Report" : "Invoice Operations";
  return (
    <div className="card-soft mt-10 border-l-4 border-l-sienna p-6" data-testid={`shortcut-combine-${recipe}`}>
      <div className="eyebrow mb-2">Proposed workflow</div>
      <h2 className="text-[22px] font-semibold">Combine them as {label}</h2>
      <p className="mt-2 text-[14.5px] text-muted-foreground">Your confirmed requirements go with you. Adjust the capabilities and wiring in Workbench.</p>
      {!auth.isLoading && !auth.data?.user ? <a href={`/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`} className={`${btn.accent} mt-4`}>Sign in to open Workbench</a> :
        <button className={`${btn.accent} mt-4`} data-testid="button-open-proposed-workflow" disabled={auth.isLoading || !b.confirmed || open.isPending} onClick={() => open.mutate({ briefId: b.id, data: { recipeId: recipe } }, { onSuccess: c => navigate(`/workbench/${c.id}`) })}>
          {open.isPending ? "Opening…" : "Open proposed workflow"} <ArrowRight className="h-4 w-4" />
        </button>}
      {open.isError && <p role="alert" className="mt-3 text-sm text-bad">{errMsg(open.error)}</p>}
    </div>
  );
}
