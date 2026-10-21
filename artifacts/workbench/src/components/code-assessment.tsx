import { Link } from "wouter";
import {
  getGetCodeAssessmentQueryKey, getGetIntakeSessionQueryKey,
  useGetCodeAssessment, useGetIntakeSession, useGetLibraryCodePackage,
  type CodeCapabilityEvidence, type CodeRequirementAssessment, type LibraryCodePackage,
} from "@workspace/api-client-react";
import { Skel, Tag, btn } from "@/components/bits";

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

export function CodeAssessment({ briefId }: { briefId: string }) {
  const query = useGetCodeAssessment(briefId, { query: { queryKey: getGetCodeAssessmentQueryKey(briefId), enabled: !!briefId } });
  if (query.isLoading) return <section className="mt-10" aria-label="Code-grounded assessment" role="status"><p className="mb-3 text-[14px] text-muted-foreground">Assessing indexed source implementations…</p><Skel className="h-44" /></section>;
  if (query.isError || !query.data) return <section className="card-soft mt-10 p-5" role="alert"><h2 className="font-semibold">Code-grounded assessment unavailable</h2><p className="mt-2 text-[14px]">Source evidence could not load. Catalog descriptions below are not a substitute.</p><button className={`${btn.secondary} mt-3`} onClick={() => query.refetch()}>Retry</button></section>;
  const report = query.data;
  const best = report.candidates.find((candidate) => candidate.solutionId === report.bestSolutionId);
  const gaps = report.requirements.filter((item) => item.status === "missing" || item.status === "partial");
  const sources = new Map<string, { name: string; items: Set<string> }>();
  for (const item of report.requirements) {
    if (item.status !== "borrow" && item.status !== "partial") continue;
    for (const match of item.matches) {
      if (match.solutionId === report.bestSolutionId) continue;
      const source = sources.get(match.solutionId) ?? { name: match.solutionName, items: new Set<string>() };
      source.items.add(match.capabilityName);
      sources.set(match.solutionId, source);
    }
  }
  return (
    <section className="mt-10 space-y-5" data-testid="code-assessment">
      <div className="card-soft border-l-4 border-l-sienna p-6">
        <div className="eyebrow mb-2 !text-siennaink">Code-grounded assessment</div>
        <h2 className="text-[24px] font-semibold">{best ? `Best starting solution: ${best.name}` : "No suitable code-backed base"}</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">Covered means a matching implementation exists in the demo base configuration, not proof it meets your full need. Borrow means proposed composition; integration is not verified.</p>
        {best && <Link href={`/solutions/${best.solutionId}`} className={`${btn.primary} mt-4`}>Explore starting solution</Link>}
        {!best && <p className="mt-3 text-[14px]">Review the gaps below before choosing a base. A catalog suggestion is not code evidence.</p>}
      </div>
      <div>
        <h3 className="mb-3 text-[18px] font-semibold">Capability coverage by priority</h3>
        {report.requirements.length ? <ol className="space-y-3">{report.requirements.map((item) => <Requirement key={item.id} item={item} />)}</ol> : <p className="text-[14px] text-muted-foreground">No requirements were available to assess.</p>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card-soft p-5">
          <h3 className="text-[17px] font-semibold">Borrow from source products</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">Proposed composition only. Review the integration notes in each citation; cross-product integration has not been verified.</p>
          {sources.size ? <ul className="mt-3 space-y-3">{Array.from(sources, ([id, source]) => <li key={id}><Link href={`/solutions/${id}`} className="font-semibold text-primary underline">{source.name}</Link><p className="text-[14px]">{Array.from(source.items).join(", ")}</p></li>)}</ul> : <p className="mt-3 text-[14px] text-muted-foreground">No additional source products proposed.</p>}
        </div>
        <div className="card-soft p-5">
          <h3 className="text-[17px] font-semibold">Still need to build or complete</h3>
          {gaps.length ? <ul className="mt-3 space-y-3">{gaps.map((item) => <li key={item.id} className="text-[14px]"><span className="font-semibold">Priority {item.priority} · {item.status === "partial" ? "Partial" : "Missing"}:</span> {item.text}<p className="mt-1 text-muted-foreground">{item.note}</p></li>)}</ul> : <p className="mt-3 text-[14px] text-muted-foreground">No missing or partial requirements identified in this assessment. This is not full-needs verification.</p>}
        </div>
      </div>
      {report.limitations.length > 0 && <div className="card-soft p-5"><h3 className="font-semibold">Assessment limitations</h3><ul className="mt-2 list-disc pl-5 text-[14px]">{report.limitations.map((text, i) => <li key={i}>{text}</li>)}</ul></div>}
      <PackageMetadata pkg={report.package} />
    </section>
  );
}

export function SolutionCodePackage({ solutionId }: { solutionId: string }) {
  const query = useGetLibraryCodePackage();
  if (query.isLoading) return <section className="mt-8" role="status"><p className="mb-2 text-[14px] text-muted-foreground">Loading code package index…</p><Skel className="h-24" /></section>;
  if (query.isError || !query.data) return <section className="card-soft mt-8 p-5" role="alert"><p>Code package index could not load.</p><button className={`${btn.secondary} mt-3`} onClick={() => query.refetch()}>Retry</button></section>;
  const pkg = query.data;
  const config = pkg.configurations.find((item) => item.solutionId === solutionId);
  if (!config) return <section className="card-soft mt-8 p-5" data-testid="no-code-package"><h2 className="text-[18px] font-semibold">No code package indexed</h2><p className="mt-2 text-[14px] text-muted-foreground">This entry is not backed by an indexed configuration. Catalog descriptions and previews remain unverified, not source evidence.</p></section>;
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
    </section>
  );
}
