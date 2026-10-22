import { useState } from "react";
import {
  getGetBriefQueryKey, useGetBrief, getGetIntakeSessionQueryKey,
  useGetIntakeSession, useGetLibraryCodePackage,
  type CodeCapabilityEvidence, type LibraryCodePackage,
} from "@workspace/api-client-react";
import { Skel, Tag, btn } from "@/components/bits";
import { UploadedSourceEvidence } from "@/components/solution-packages";
import { DiscoveryPlan } from "@/components/discovery-plan";

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

export function CodeAssessment({ briefId }: { briefId: string }) {
  const brief = useGetBrief(briefId, { query: { queryKey: getGetBriefQueryKey(briefId), enabled: !!briefId } });
  if (brief.isLoading) return <Skel className="mt-10 h-44" />;
  if (!brief.data) return <div role="alert" className="mt-10">Intake could not load. <button className={btn.quiet} onClick={() => void brief.refetch()}>Retry</button></div>;
  return <DiscoveryPlan key={briefId} briefId={briefId} confirmed={!!brief.data.confirmed} />;
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
