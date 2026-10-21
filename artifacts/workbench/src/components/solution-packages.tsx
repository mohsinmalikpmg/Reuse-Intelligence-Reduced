import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileArchive, LogIn, Plus, RefreshCw, ShieldAlert, Trash2, Upload } from "lucide-react";
import {
  getListSolutionPackagesQueryKey, useCreateSolutionPackageUploadUrl, useInspectSolutionPackage,
  useListSolutionPackages, useReviewSolutionPackage,
  type ListSolutionPackages200SolutionsItem, type SolutionPackage,
} from "@workspace/api-client-react";
import { Empty, Skel, Tag, btn } from "@/components/bits";
import { cn } from "@/lib/utils";
import { reviewDecisions, type MappingRow } from "@/lib/package-review";

const REQ = { credentials: "include" as const };
const STATUS: Record<SolutionPackage["status"], { label: string; tone: "muted" | "sienna" | "green" | "sky" | "slate" }> = {
  awaiting_upload: { label: "Awaiting upload", tone: "muted" },
  inspected: { label: "Inspected · awaiting human review", tone: "sky" },
  reviewed: { label: "Human reviewed", tone: "green" },
  failed: { label: "Inspection failed", tone: "sienna" },
};
const errStatus = (e: unknown) => (e && typeof e === "object" && "status" in e ? Number((e as { status: unknown }).status) : 0);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const loginHref = () => `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
const inputCls = "h-11 w-full rounded-xl border border-input bg-card px-3 text-[15px]";

export function usePackagesQuery() {
  return useListSolutionPackages({ query: { queryKey: getListSolutionPackagesQueryKey(), staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, retry: (n, e) => errStatus(e) !== 401 && errStatus(e) !== 403 && n < 2 }, request: REQ });
}

function putFile(url: string, file: File, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", "application/zip");
    x.timeout = 120_000;
    x.ontimeout = () => reject(new Error("Upload timed out. Please try uploading again."));
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Storage rejected the file (HTTP ${x.status}).`)));
    x.onerror = () => reject(new Error("Network error while sending the file to storage."));
    x.send(file);
  });
}

export function SolutionPackagesPanel() {
  const q = usePackagesQuery();
  const [solutionFilter, setSolutionFilter] = useState("");
  const [openId, setOpenId] = useState("");
  if (q.isLoading) return <div className="mt-6 space-y-3" role="status"><Skel className="h-40" /><Skel className="h-24" /></div>;
  if (q.isError) {
    if (errStatus(q.error) === 401) return (
      <div className="card-soft mt-6 max-w-xl p-6" data-testid="packages-signin">
        <h2 className="text-[19px] font-semibold">Sign in to see solution ZIPs</h2>
        <p className="mt-2 text-[14px] text-muted-foreground">Uploaded source packages and their current reviews are only visible to signed-in colleagues.</p>
        <a href={loginHref()} className={cn(btn.primary, "mt-4")} data-testid="link-packages-signin"><LogIn className="h-4 w-4" /> Sign in</a>
      </div>
    );
    return <div className="card-soft mt-6 p-5" role="alert"><p>Solution packages could not load. {errMsg(q.error)}</p><button className={cn(btn.secondary, "mt-3")} onClick={() => q.refetch()} data-testid="button-packages-retry"><RefreshCw className="h-4 w-4" /> Retry</button></div>;
  }
  const data = q.data!;
  const pkgs = data.packages.filter((p) => !solutionFilter || p.solutionId === solutionFilter);
  const bySolution = new Map<string, SolutionPackage[]>();
  for (const p of pkgs) bySolution.set(p.solutionId, [...(bySolution.get(p.solutionId) ?? []), p]);
  return (
    <div className="mt-6 max-w-5xl space-y-5" data-testid="view-packages">
      <div className="card-soft border-l-4 border-l-sienna p-5">
        <div className="eyebrow mb-1 !text-siennaink">Solution ZIP intake</div>
        <p className="text-[14px]">Real source packages for live solutions. Each upload is statically inspected (files, hashes, dependencies), then a person in IT approves which files evidence which capability. <strong>Uploads are never run or sandbox tested here.</strong></p>
      </div>
      {data.canManage ? <UploadForm solutions={data.solutions} /> : (
        <div className="card-soft flex gap-3 p-5" data-testid="packages-readonly">
          <ShieldAlert className="h-5 w-5 shrink-0 text-siennaink" />
          <div><h3 className="font-semibold">Read-only access</h3><p className="mt-1 text-[14px] text-muted-foreground">You are signed in, but uploading and reviewing packages needs the IT library-management grant on your account. Ask IT governance to add it; you can still browse versions, hashes and approved mappings.</p></div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[18px] font-semibold">Versions</h2>
        <select value={solutionFilter} onChange={(e) => setSolutionFilter(e.target.value)} className="h-10 rounded-xl border border-input bg-card px-3 text-[14px]" data-testid="select-package-solution">
          <option value="">All solutions</option>
          {data.solutions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-[13px] text-muted-foreground" data-testid="text-package-count">{pkgs.length} package{pkgs.length === 1 ? "" : "s"}</span>
      </div>
      {pkgs.length === 0 ? <Empty title="No solution ZIPs yet" sub={data.canManage ? "Upload the first source package above." : "IT has not uploaded any source packages for these solutions."} /> : (
        [...bySolution.entries()].map(([sid, list]) => (
          <section key={sid} className="space-y-2" data-testid={`package-group-${sid}`}>
            <h3 className="flex items-center gap-3 text-[14px] font-bold uppercase tracking-[0.08em] text-primary"><span className="h-2 w-2 rounded-full bg-primary" />{list[0].solutionName}<span className="h-px flex-1 bg-border" /></h3>
            {[...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => (
              <PackageCard key={p.id} pkg={p} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? "" : p.id)} canManage={data.canManage} solution={data.solutions.find((s) => s.id === p.solutionId)} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function UploadForm({ solutions }: { solutions: ListSolutionPackages200SolutionsItem[] }) {
  const qc = useQueryClient();
  const create = useCreateSolutionPackageUploadUrl({ request: REQ });
  const inspect = useInspectSolutionPackage({ request: REQ });
  const [solutionId, setSolutionId] = useState("");
  const [version, setVersion] = useState("");
  const [claims, setClaims] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "inspecting" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: getListSolutionPackagesQueryKey() });

  const runInspect = async (id: string) => {
    setPhase("inspecting"); setError("");
    try { await inspect.mutateAsync({ id }); setPhase("done"); setPendingId(""); setFile(null); setVersion(""); setClaims(""); }
    catch (e) { setPhase("error"); setError(`Inspection failed: ${errMsg(e)}`); if (errStatus(e) === 422 || errStatus(e) === 409) setPendingId(""); }
    finally { refresh(); }
  };
  const submit = async () => {
    if (!file || !solutionId || !version.trim()) return;
    if (!/\.zip$/i.test(file.name)) { setPhase("error"); setError("Choose a .zip file."); return; }
    setError(""); setProgress(0); setPhase("uploading");
    try {
      const r = await create.mutateAsync({ data: { solutionId, version: version.trim(), filename: file.name, claims: claims.split("\n").map((c) => c.trim()).filter(Boolean) } });
      setPendingId(r.id); refresh();
      await putFile(r.uploadURL, file, setProgress);
      await runInspect(r.id);
    } catch (e) { setPhase("error"); setError(`Upload failed: ${errMsg(e)}`); refresh(); }
  };
  const busy = phase === "uploading" || phase === "inspecting";
  return (
    <div className="card-soft space-y-3 p-5" data-testid="form-package-upload">
      <h3 className="flex items-center gap-2 text-[17px] font-semibold"><Upload className="h-4 w-4" /> Upload a solution ZIP</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block"><span className="eyebrow mb-1 block">Live solution</span>
          <select value={solutionId} onChange={(e) => setSolutionId(e.target.value)} className={inputCls} data-testid="select-upload-solution" disabled={busy}>
            <option value="">Choose…</option>{solutions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="block"><span className="eyebrow mb-1 block">Version</span>
          <input value={version} maxLength={100} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2.4.1" className={inputCls} data-testid="input-upload-version" disabled={busy} /></label>
      </div>
      <label className="block"><span className="eyebrow mb-1 block">Uploader claims (one per line, unverified)</span>
        <textarea value={claims} onChange={(e) => setClaims(e.target.value)} rows={3} placeholder="Summarizes maintenance work orders" className="w-full rounded-xl border border-input bg-card p-3 text-[14px]" data-testid="input-upload-claims" disabled={busy} /></label>
      <input type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-[14px]" data-testid="input-upload-file" disabled={busy} />
      <p className="text-[12.5px] text-muted-foreground">Maximum 20 MiB ZIP. Rejected archives require a new upload; they cannot be retried.</p>
      {phase === "uploading" && <div role="status" data-testid="status-upload-progress"><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-transform" style={{ width: "100%", transform: `translateX(${progress - 100}%)` }} /></div><p className="mt-1 text-[13px] text-muted-foreground">Sending to storage… {progress}%</p></div>}
      {phase === "inspecting" && <p role="status" className="text-[13px] text-muted-foreground">Inspecting files, hashes and dependencies…</p>}
      {phase === "done" && <p role="status" className="text-[13px] text-ok" data-testid="status-upload-done">Inspected. Review the proposed mappings below.</p>}
      {phase === "error" && <div role="alert" className="text-[13px] text-bad" data-testid="status-upload-error">{error}
        {pendingId && <button className={cn(btn.quiet, "ml-2")} onClick={() => runInspect(pendingId)} data-testid="button-retry-inspect"><RefreshCw className="h-4 w-4" /> Retry inspection</button>}</div>}
      <div className="flex gap-2">
        <button className={btn.primary} disabled={busy || !file || !solutionId || !version.trim()} onClick={submit} data-testid="button-upload-package">{phase === "error" && !pendingId ? "Try upload again" : "Upload & inspect"}</button>
      </div>
    </div>
  );
}

type Row = MappingRow;

function PackageCard({ pkg, open, onToggle, canManage, solution }: { pkg: SolutionPackage; open: boolean; onToggle: () => void; canManage: boolean; solution?: ListSolutionPackages200SolutionsItem }) {
  const qc = useQueryClient();
  const inspect = useInspectSolutionPackage({ request: REQ });
  const st = STATUS[pkg.status];
  const approved = pkg.mappings.filter((m) => m.decision === "approved");
  return (
    <article className="card-soft p-4" data-testid={`card-package-${pkg.id}`}>
      <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={onToggle} aria-expanded={open} data-testid={`button-toggle-package-${pkg.id}`}>
        <FileArchive className="h-4 w-4 text-primary" />
        <span className="font-semibold">v{pkg.version}</span>
        <span className="break-all text-[13px] text-muted-foreground">{pkg.filename}</span>
        <Tag tone={st.tone} testid={`status-package-${pkg.id}`}>{st.label}</Tag>
        <Tag tone="muted">Not sandbox tested</Tag>
        <span className="ml-auto text-[12.5px] text-muted-foreground">{new Date(pkg.createdAt).toLocaleString()} · {approved.length} approved mapping{approved.length === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4 border-t border-border pt-4 text-[14px]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="break-all font-mono text-[12px]" data-testid={`text-package-sha-${pkg.id}`}>SHA-256: {pkg.sha256 ?? "not computed yet"}</span>
            {pkg.sha256 && <a className={btn.secondary} href={`/api/library/solution-packages/${encodeURIComponent(pkg.id)}/download`} data-testid={`link-download-package-${pkg.id}`}>Download ZIP</a>}
            {canManage && pkg.status === "awaiting_upload" && (
              <button className={btn.secondary} disabled={inspect.isPending} onClick={() => inspect.mutate({ id: pkg.id }, { onSettled: () => qc.invalidateQueries({ queryKey: getListSolutionPackagesQueryKey() }) })} data-testid={`button-reinspect-${pkg.id}`}><RefreshCw className="h-4 w-4" /> {inspect.isPending ? "Inspecting…" : "Retry inspection"}</button>
            )}
          </div>
          {inspect.isError && <p role="alert" className="text-bad">{errMsg(inspect.error)}</p>}
          {pkg.warnings.length > 0 && <div className="rounded-xl bg-accent p-3 text-accent-foreground"><div className="font-semibold">Inspection warnings</div><ul className="list-disc pl-5">{pkg.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <div className="grid gap-4 md:grid-cols-3">
            <Col title="Uploader claims" sub="Stated by the uploader. Not verified.">
              {pkg.claims.length ? <ul className="list-disc pl-5">{pkg.claims.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="text-muted-foreground">No claims made.</p>}
            </Col>
            <Col title="Human-approved mappings" sub="Static file evidence approved by IT review.">
              {approved.length ? <ul className="space-y-1">{approved.map((m, i) => <li key={i}><span className="font-semibold">{m.capabilityName}</span><br /><span className="break-all font-mono text-[12px]">{m.file}</span></li>)}</ul> : <p className="text-muted-foreground">None approved yet.</p>}
            </Col>
            <Col title="Sandbox tested" sub="Execution in an isolated sandbox.">
              <Tag tone="muted">Not tested</Tag><p className="mt-1 text-muted-foreground">Uploaded packages are never executed here.</p>
            </Col>
          </div>
          <details><summary className="cursor-pointer font-semibold text-primary">Dependencies ({pkg.dependencies.length})</summary>
            <p className="mt-2 text-muted-foreground">Static declarations from package.json and requirements*.txt only. Other manifests, indirect dependencies, licenses and vulnerabilities require separate review.</p>
            {pkg.dependencies.length ? <ul className="mt-2 space-y-1">{pkg.dependencies.map((d, i) => <li key={i} className="break-all font-mono text-[12px]">{d.name}@{d.version} <span className="text-muted-foreground">· {d.source}</span></li>)}</ul> : <p className="mt-2 text-muted-foreground">No supported dependency declarations detected; this does not mean the package has no dependencies.</p>}
          </details>
          <details><summary className="cursor-pointer font-semibold text-primary">File manifest ({pkg.files.length})</summary>
            <ul className="mt-2 max-h-72 space-y-1 overflow-auto">{pkg.files.map((f) => <li key={f.path} className="break-all font-mono text-[12px]">{f.path} <span className="text-muted-foreground">· {f.size.toLocaleString()} B · {f.sha256.slice(0, 16)}…</span></li>)}</ul>
          </details>
          {pkg.reviewNote && <p><span className="font-semibold">Review note: </span>{pkg.reviewNote}</p>}
          {canManage && (pkg.status === "inspected" || pkg.status === "reviewed") && <ReviewEditor pkg={pkg} solution={solution} />}
        </div>
      )}
    </article>
  );
}

function Col({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-border p-3"><div className="font-semibold">{title}</div><p className="mb-2 text-[12.5px] text-muted-foreground">{sub}</p>{children}</div>;
}

function ReviewEditor({ pkg, solution }: { pkg: SolutionPackage; solution?: ListSolutionPackages200SolutionsItem }) {
  const qc = useQueryClient();
  const review = useReviewSolutionPackage({ request: REQ });
  const caps = solution?.capabilities ?? [];
  const files = useMemo(() => pkg.files.map((f) => f.path), [pkg.files]);
  const [rows, setRows] = useState<Row[]>(() => pkg.mappings.map((m) => ({ capabilityId: m.capabilityId, file: m.file, decision: m.decision, note: m.note })));
  const [note, setNote] = useState(pkg.reviewNote);
  const [done, setDone] = useState("");
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const valid = rows.every((r) => r.capabilityId && r.file && r.decision !== "proposed");
  const submit = (all?: "approved" | "rejected") => {
    if (rows.some(r => !r.capabilityId || !r.file || (!all && r.decision === "proposed"))) return;
    const mappings = reviewDecisions(all ? rows.map((r) => ({ ...r, decision: all })) : rows);
    if (all) setRows(mappings);
    review.mutate({ id: pkg.id, data: { note, mappings } }, {
      onSuccess: () => setDone("Review saved."),
      onSettled: () => qc.invalidateQueries({ queryKey: getListSolutionPackagesQueryKey() }),
    });
  };
  return (
    <div className="rounded-xl border border-primary/30 bg-secondary/40 p-4" data-testid={`review-editor-${pkg.id}`}>
      <h4 className="font-semibold">Human review · file-to-capability mappings</h4>
      <p className="text-[12.5px] text-muted-foreground">Proposed mappings came from static inspection. Pick files from this package and capabilities from {pkg.solutionName}.</p>
      <ul className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_130px_1fr_auto]" data-testid={`row-mapping-${i}`}>
            <select value={r.capabilityId} onChange={(e) => set(i, { capabilityId: e.target.value })} className="h-10 rounded-lg border border-input bg-card px-2 text-[13px]" data-testid={`select-mapping-cap-${i}`}>
              <option value="">Capability…</option>{caps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={r.file} onChange={(e) => set(i, { file: e.target.value })} className="h-10 rounded-lg border border-input bg-card px-2 font-mono text-[12px]" data-testid={`select-mapping-file-${i}`}>
              <option value="">File…</option>{files.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={r.decision} onChange={(e) => set(i, { decision: e.target.value as Row["decision"] })} className="h-10 rounded-lg border border-input bg-card px-2 text-[13px]" data-testid={`select-mapping-decision-${i}`}>
              <option value="proposed">Decide…</option><option value="approved">Approve</option><option value="rejected">Reject</option>
            </select>
            <input value={r.note} maxLength={2000} onChange={(e) => set(i, { note: e.target.value })} placeholder="Note" className="h-10 rounded-lg border border-input bg-card px-2 text-[13px]" data-testid={`input-mapping-note-${i}`} />
            <button className={btn.quiet} onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove mapping" data-testid={`button-remove-mapping-${i}`}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>
      <button className={cn(btn.quiet, "mt-2")} onClick={() => setRows([...rows, { capabilityId: "", file: "", decision: "proposed", note: "" }])} disabled={!caps.length || !files.length} data-testid="button-add-mapping"><Plus className="h-4 w-4" /> Add mapping</button>
      <textarea value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Review note" className="mt-3 w-full rounded-xl border border-input bg-card p-3 text-[14px]" data-testid="input-review-note" />
      {!valid && <p className="text-[13px] text-bad">Every mapping needs a capability, a file and an explicit approve or reject decision.</p>}
      {review.isError && <p role="alert" className="text-[13px] text-bad">Review could not be saved: {errMsg(review.error)}</p>}
      {done && !review.isError && <p role="status" className="text-[13px] text-ok">{done}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btn.primary} disabled={!valid || review.isPending} onClick={() => submit()} data-testid="button-save-review">{review.isPending ? "Saving…" : "Save review"}</button>
        <button className={btn.secondary} disabled={rows.some(r => !r.capabilityId || !r.file) || review.isPending || !rows.length} onClick={() => submit("approved")} data-testid="button-approve-all">Approve all</button>
        <button className={btn.secondary} disabled={rows.some(r => !r.capabilityId || !r.file) || review.isPending || !rows.length} onClick={() => submit("rejected")} data-testid="button-reject-all">Reject all</button>
      </div>
    </div>
  );
}

/** Approved, human-reviewed mappings from uploaded ZIPs for one solution. Static evidence only, never executed. */
export function UploadedSourceEvidence({ solutionId }: { solutionId: string }) {
  const q = usePackagesQuery();
  if (q.isLoading) return <Skel className="mt-3 h-16" />;
  if (q.isError) {
    if (errStatus(q.error) === 401) return <p className="mt-3 text-[13px] text-muted-foreground" data-testid="uploaded-evidence-signin"><a href={loginHref()} className="font-semibold text-primary underline">Sign in</a> to see human-approved evidence from uploaded source ZIPs.</p>;
    return <p role="alert" className="mt-3 text-[13px] text-bad">Uploaded source evidence could not load. <button className="underline" onClick={() => q.refetch()}>Retry</button></p>;
  }
  const pkgs = (q.data?.packages ?? []).filter((p) => p.solutionId === solutionId && p.mappings.some((m) => m.decision === "approved"));
  return (
    <div className="card-soft mt-3 p-5 text-[14px]" data-testid="uploaded-source-evidence">
      <h3 className="font-semibold">Uploaded source ZIPs · human-approved evidence</h3>
      <p className="text-[12.5px] text-muted-foreground">Static file-to-capability mappings approved by IT. Not sandbox tested and not part of the assessment above.</p>
      {pkgs.length === 0 ? <p className="mt-2 text-muted-foreground">No approved mappings from uploaded packages.</p> : pkgs.map((p) => (
        <div key={p.id} className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">v{p.version}</span><Tag tone="muted">Not sandbox tested</Tag><a className="text-primary underline" href={`/api/library/solution-packages/${encodeURIComponent(p.id)}/download`}>Download</a></div>
          <p className="break-all font-mono text-[11.5px] text-muted-foreground">SHA-256: {p.sha256 ?? "—"}</p>
          <ul className="mt-1 space-y-1">{p.mappings.filter((m) => m.decision === "approved").map((m, i) => <li key={i}><span className="font-semibold">{m.capabilityName}</span> · <span className="break-all font-mono text-[12px]">{m.file}</span>{m.note && <span className="text-muted-foreground"> · {m.note}</span>}</li>)}</ul>
        </div>
      ))}
    </div>
  );
}
