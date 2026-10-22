import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Download, ExternalLink, Link2, Package, RefreshCw, Trash2, X } from "lucide-react";
import {
  getGetCaseQueryKey, getListSolutionExportsQueryKey, useCreateSolutionExport, useGetCurrentAuthUser, useListSolutionExports, useSaveSolutionExportLink,
  type Case, type SolutionExport,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skel, Tag, btn, useUndoToast } from "@/components/bits";
import { errMsg, httpStatus } from "@/lib/case";
import { cn } from "@/lib/utils";

const loginHref = () => `/api/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
const WS_RE = /^https:\/\/replit\.com\/(@[\w-]+|t\/[\w-]+)\/[\w-]+\/?$/;
const PUB_RE = /^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.replit\.app\/?$/;

const STATUS: Record<SolutionExport["status"], { l: string; tone: "green" | "sienna" | "sky" | "muted" }> = {
  ready: { l: "Ready", tone: "green" },
  incomplete: { l: "Incomplete", tone: "sienna" },
  failed: { l: "Failed", tone: "sienna" },
  building: { l: "Building", tone: "sky" },
};

function short(h: string | null | undefined, n = 12) { return h ? h.slice(0, n) : "none"; }

function useExports(params: { caseId?: string; solutionId?: string }) {
  const q = useListSolutionExports(params, {
    query: {
      queryKey: getListSolutionExportsQueryKey(params),
      enabled: !!(params.caseId || params.solutionId),
      refetchOnWindowFocus: true,
      refetchInterval: (query) => (query.state.data?.some((e) => e.status === "building") ? 4000 : false),
      retry: (n, e) => httpStatus(e) !== 401 && n < 2,
    },
  });
  return q;
}

/** Export action plus the version history for one experiment. */
export function CaseExports({ theCase, configPending, compact }: { theCase: Case; configPending: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const say = useUndoToast();
  const auth = useGetCurrentAuthUser();
  const signedIn = !!auth.data?.user;
  const create = useCreateSolutionExport();
  const params = { caseId: theCase.id };
  const q = useExports(params);
  const canBuild = signedIn;
  const build = () =>
    create.mutate({ data: { caseId: theCase.id, expectedUpdatedAt: theCase.updatedAt } }, {
      onSuccess: (x) => {
        qc.invalidateQueries({ queryKey: ["/api/solution-exports"] });
        say(x.status === "ready" ? `Export ${short(x.fingerprint, 8)} ready to download.` : x.status === "building" ? "Export is building." : `Export recorded as ${x.status}.`);
      },
      onError: (e) => {
        if (httpStatus(e) === 409) { qc.invalidateQueries({ queryKey: getGetCaseQueryKey(theCase.id) }); say("The experiment changed since this page loaded. Refreshed; try the export again."); }
        else say(errMsg(e));
      },
    });
  return (
    <section className={cn("card-soft p-5", !compact && "mt-4")} data-testid="panel-solution-exports">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[17px] font-semibold"><Package className="h-4 w-4 text-primary" /> Export solution</h3>
          <p className="mt-1 max-w-xl text-[13.5px] text-muted-foreground">Packages the current Version B configuration as a versioned ZIP with its checks and known gaps. Building the same snapshot twice returns the same record.</p>
        </div>
        {auth.isLoading ? <Skel className="h-11 w-40" /> : !signedIn ? (
          <a href={loginHref()} className={btn.secondary} data-testid="link-signin-export">Sign in to export</a>
        ) : (
          <button data-testid="button-export-solution" onClick={build} disabled={!canBuild || configPending || create.isPending} className={btn.primary}>
            <Package className="h-4 w-4" /> {create.isPending ? "Building…" : configPending ? "Saving configuration…" : "Export solution"}
          </button>
        )}
      </div>
      <ExportHistory q={q} params={params} signedIn={signedIn} />
    </section>
  );
}

/** Export records across every experiment on a library solution. */
export function SolutionExportsPanel({ solutionId }: { solutionId: string }) {
  const auth = useGetCurrentAuthUser();
  const signedIn = !!auth.data?.user;
  const params = { solutionId };
  const q = useExports(params);
  return (
    <section className="mt-8" data-testid="panel-solution-exports-library">
      <h2 className="mb-2 flex items-center gap-2 text-[16px] font-semibold"><Package className="h-4 w-4 text-primary" /> Exports and linked Replit apps</h2>
      <div className="card-soft p-5">
        <p className="text-[13.5px] text-muted-foreground">Versioned ZIPs built from experiments on this product. A recorded link is never verified by FUSEBOX.</p>
        {!signedIn && !auth.isLoading ? (
          <a href={loginHref()} className={cn(btn.secondary, "mt-3")} data-testid="link-signin-exports">Sign in to see exports</a>
        ) : <ExportHistory q={q} params={params} signedIn={signedIn} />}
      </div>
    </section>
  );
}

function ExportHistory({ q, params, signedIn }: { q: ReturnType<typeof useExports>; params: { caseId?: string; solutionId?: string }; signedIn: boolean }) {
  if (q.isLoading) return <div className="mt-4 space-y-2" data-testid="state-exports-loading"><Skel className="h-20" /><Skel className="h-20" /></div>;
  if (q.isError) {
    if (httpStatus(q.error) === 401 || !signedIn) return <a href={loginHref()} className={cn(btn.secondary, "mt-4")} data-testid="link-signin-history">Sign in to see export history</a>;
    return <div role="alert" className="mt-4 flex items-center gap-3 rounded-xl bg-accent px-4 py-3 text-[14px] text-siennaink" data-testid="state-exports-error">Export history could not load. <button className={btn.quiet} onClick={() => void q.refetch()} data-testid="button-retry-exports"><RefreshCw className="h-4 w-4" /> Retry</button></div>;
  }
  const list = q.data ?? [];
  if (!list.length) return <div className="mt-4 rounded-xl border border-dashed border-input px-4 py-5 text-center text-[14px] text-muted-foreground" data-testid="state-exports-empty">No exports yet. The first one records its source version, fingerprint and checks.</div>;
  return <ol className="mt-4 space-y-3">{list.map((x) => <ExportRow key={x.id} x={x} params={params} />)}</ol>;
}

function ExportRow({ x, params }: { x: SolutionExport; params: { caseId?: string; solutionId?: string } }) {
  const st = STATUS[x.status];
  const failedChecks = x.checks.filter((c) => !c.passed).length;
  const [editing, setEditing] = useState(false);
  return (
    <li className="rounded-xl border border-border bg-card p-4" data-testid={`export-${x.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{x.title}</span>
        <Tag tone={st.tone} testid={`status-export-${x.id}`}>{st.l}</Tag>
        <Tag tone="slate">v{x.sourceVersion}</Tag>
        <span className="text-[12.5px] text-muted-foreground">{new Date(x.createdAt).toLocaleString()} · {x.createdBy}</span>
      </div>
      <dl className="mt-2 grid gap-x-6 gap-y-1 font-mono text-[12px] text-muted-foreground sm:grid-cols-2">
        <div className="break-all">fingerprint <span className="text-foreground" data-testid={`text-fingerprint-${x.id}`}>{x.fingerprint}</span></div>
        <div className="break-all">sha256 <span className="text-foreground" data-testid={`text-sha-${x.id}`}>{x.sha256 ?? "Not built yet"}</span></div>
      </dl>
      {x.error && <p className="mt-2 rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid={`text-export-error-${x.id}`}>{x.error}</p>}
      {x.checks.length > 0 && (
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-muted-foreground">{x.checks.length - failedChecks} of {x.checks.length} checks passed</summary>
          <ul className="mt-1.5 space-y-1">{x.checks.map((c) => (
            <li key={c.name} className="flex gap-2">{c.passed ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-siennaink" />}<span><span className="font-medium">{c.name}</span>{c.detail ? ` · ${c.detail}` : ""}</span></li>
          ))}</ul>
        </details>
      )}
      {x.gaps.length > 0 && <div className="mt-2 text-[13px]"><span className="font-medium">Known gaps:</span><ul className="list-disc pl-5 text-muted-foreground">{x.gaps.map((g) => <li key={g}>{g}</li>)}</ul></div>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {x.status !== "building" && x.status !== "failed" && x.sha256 && <a href={`/api/solution-exports/${x.id}/download`} className={btn.secondary} data-testid={`link-download-export-${x.id}`}><Download className="h-4 w-4" /> Download ZIP</a>}
        {x.status !== "building" && x.status !== "failed" && <a href="https://replit.com/import" target="_blank" rel="noopener noreferrer" className={btn.quiet} data-testid={`link-open-replit-${x.id}`}><ExternalLink className="h-4 w-4" /> Open in Replit</a>}
        {x.canEdit && ["ready", "incomplete"].includes(x.status) && <button className={btn.quiet} onClick={() => setEditing(true)} data-testid={`button-edit-link-${x.id}`}><Link2 className="h-4 w-4" /> {x.workspaceUrl || x.publishedUrl ? "Edit link" : "Save app link"}</button>}
      </div>
      {x.status !== "building" && x.status !== "failed" && <p className="mt-1.5 text-[12.5px] text-muted-foreground">Open in Replit opens the importer only: choose the downloaded ZIP, upload it, and approve setup there. Nothing here confirms an import happened.</p>}
      <div className="mt-3 border-t border-border pt-3 text-[13px]" data-testid={`import-state-${x.id}`}>
        <span className="eyebrow">Import</span>{" "}
        {x.verificationState === "awaiting_import" ? <span className="text-muted-foreground">Awaiting import · no link recorded</span> : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Tag tone="muted">Link recorded · unverified</Tag>
            {x.workspaceUrl && <span>Workspace: <a href={x.workspaceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline-offset-2 hover:underline" data-testid={`link-workspace-${x.id}`}>{x.workspaceUrl}</a></span>}
            {x.publishedUrl && <span>Published URL: <a href={x.publishedUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline-offset-2 hover:underline" data-testid={`link-published-${x.id}`}>{x.publishedUrl}</a></span>}
            <span className="font-mono text-[11.5px] text-muted-foreground">rev {x.linkRevision}</span>
          </span>
        )}
      </div>
      {editing && <LinkDialog x={x} params={params} onClose={() => setEditing(false)} />}
    </li>
  );
}

function LinkDialog({ x, params, onClose }: { x: SolutionExport; params: { caseId?: string; solutionId?: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const say = useUndoToast();
  const save = useSaveSolutionExportLink();
  const [ws, setWs] = useState(x.workspaceUrl);
  const [pub, setPub] = useState(x.publishedUrl);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setErr(null); }, [ws, pub]);
  const removing = !ws.trim() && !pub.trim();
  const wsBad = !!ws.trim() && !WS_RE.test(ws.trim());
  const pubBad = !!pub.trim() && !PUB_RE.test(pub.trim());
  const needsWs = !ws.trim() && !!pub.trim();
  const refresh = () => qc.invalidateQueries({ queryKey: ["/api/solution-exports"] });
  const submit = () => {
    if (wsBad || pubBad || needsWs) return;
    if (removing && !confirmRemove) { setConfirmRemove(true); return; }
    save.mutate({ id: x.id, data: { workspaceUrl: ws.trim(), publishedUrl: pub.trim(), expectedRevision: x.linkRevision } }, {
      onSuccess: () => { refresh(); say(removing ? "Link removed." : "Link recorded. It stays unverified."); onClose(); },
      onError: (e) => {
        if (httpStatus(e) === 409) { refresh(); setErr("Someone else changed this link. The latest version has been loaded; close and try again."); }
        else setErr(errMsg(e));
      },
    });
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid="dialog-export-link">
        <DialogHeader>
          <DialogTitle className="text-primary">Record the Replit app</DialogTitle>
          <DialogDescription>Paste the workspace you imported this ZIP into. FUSEBOX stores it as stated; it does not check it.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="block text-[13.5px] font-medium">Workspace URL
            <input value={ws} onChange={(e) => { setWs(e.target.value); setConfirmRemove(false); }} placeholder="https://replit.com/@owner/slug" className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-[14px]" data-testid="input-workspace-url" />
            {wsBad && <span className="mt-1 block text-[12.5px] text-siennaink">Use https://replit.com/@owner/slug or https://replit.com/t/team/slug</span>}
          </label>
          <label className="block text-[13.5px] font-medium">Published URL <span className="font-normal text-muted-foreground">(optional)</span>
            <input value={pub} onChange={(e) => { setPub(e.target.value); setConfirmRemove(false); }} placeholder="https://name.replit.app" className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-[14px]" data-testid="input-published-url" />
            {pubBad && <span className="mt-1 block text-[12.5px] text-siennaink">Only https://*.replit.app addresses.</span>}
            {needsWs && <span className="mt-1 block text-[12.5px] text-siennaink">Add the workspace URL too.</span>}
          </label>
          {confirmRemove && <p className="rounded-lg bg-accent px-3 py-2 text-[13px] text-siennaink" data-testid="text-confirm-remove">Both fields are empty: this removes the recorded link. Press Remove link to confirm.</p>}
          {err && <p role="alert" className="text-[13px] text-siennaink" data-testid="text-link-error">{err}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {(x.workspaceUrl || x.publishedUrl) && !removing && <button type="button" className={btn.quiet} onClick={() => { setWs(""); setPub(""); setConfirmRemove(true); }} data-testid="button-clear-link"><Trash2 className="h-4 w-4" /> Clear</button>}
            <button type="button" className={btn.quiet} onClick={onClose} data-testid="button-cancel-link">Cancel</button>
            <button type="submit" className={removing ? btn.accent : btn.primary} disabled={save.isPending || wsBad || pubBad || needsWs || (removing && !x.workspaceUrl && !x.publishedUrl)} data-testid="button-save-link">
              {save.isPending ? "Saving…" : removing ? "Remove link" : "Save link"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reusable export action and history for any case id (including combined cc_ proposals). */
export function CaseExportHistory({ caseId, updatedAt, pending, onConflict, title = "Export the combination", note }: {
  caseId: string; updatedAt: string; pending?: boolean; onConflict?: () => void; title?: string; note?: string;
}) {
  const qc = useQueryClient();
  const say = useUndoToast();
  const auth = useGetCurrentAuthUser();
  const signedIn = !!auth.data?.user;
  const create = useCreateSolutionExport();
  const params = { caseId };
  const q = useExports(params);
  const build = () =>
    create.mutate({ data: { caseId, expectedUpdatedAt: updatedAt } }, {
      onSuccess: (x) => {
        qc.invalidateQueries({ queryKey: ["/api/solution-exports"] });
        say(x.status === "ready" ? `Export ${short(x.fingerprint, 8)} ready to download.` : x.status === "building" ? "Export is building." : `Export recorded as ${x.status}.`);
      },
      onError: (e) => {
        if (httpStatus(e) === 409) { onConflict?.(); say("The combination changed since this page loaded. Refreshed; try the export again."); }
        else say(errMsg(e));
      },
    });
  return (
    <section className="card-soft p-5" data-testid="panel-solution-exports">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-[17px] font-semibold"><Package className="h-4 w-4 text-primary" /> {title}</h3>
          <p className="mt-1 max-w-xl text-[13.5px] text-muted-foreground">{note ?? "Packages exactly what is saved as a versioned ZIP with its checks and known gaps. The same snapshot always gives the same record."}</p>
        </div>
        {auth.isLoading ? <Skel className="h-11 w-40" /> : !signedIn ? (
          <a href={loginHref()} className={btn.secondary} data-testid="link-signin-export">Sign in to export</a>
        ) : (
          <button data-testid="button-export-solution" onClick={build} disabled={pending || create.isPending} className={btn.primary}>
            <Package className="h-4 w-4" /> {create.isPending ? "Building…" : pending ? "Saving…" : "Export"}
          </button>
        )}
      </div>
      <ExportHistory q={q} params={params} signedIn={signedIn} />
    </section>
  );
}
