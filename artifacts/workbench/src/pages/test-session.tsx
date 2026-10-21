import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff } from "lucide-react";
import { getGetTestSessionQueryKey, useGetTestSession, useRespondToTestSession, type TestResponseInputPick } from "@workspace/api-client-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorView, LoadingView, Page, Tag, btn, useUndoToast } from "@/components/bits";
import { OutputView } from "@/components/output-view";
import { SummaryCounts } from "@/components/wb-parts";
import { errMsg, useMe } from "@/lib/case";
import { cn } from "@/lib/utils";

export default function TestSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const q = useGetTestSession(sessionId, { query: { enabled: !!sessionId, queryKey: getGetTestSessionQueryKey(sessionId) } });
  const respond = useRespondToTestSession();
  const qc = useQueryClient();
  const say = useUndoToast();
  const me = useMe();
  const [idx, setIdx] = useState(0);
  const [pick, setPick] = useState<TestResponseInputPick | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [tester, setTester] = useState("");
  const [demo, setDemo] = useState(false);
  const [answered, setAnswered] = useState<string[]>([]);

  if (q.isLoading) return <LoadingView />;
  if (q.isError || !q.data) return <ErrorView onRetry={() => q.refetch()} message="This test session could not load." />;
  const s = q.data;
  const pair = s.pairs[idx];
  const expired = pair?.expired ?? false;
  const name = tester.trim() || me?.name || "";
  const submit = () => {
    if (!pick || !pair) return;
    respond.mutate({ sessionId, data: { sampleInputId: pair.sampleInputId, pick, rating: rating ?? undefined, comment: comment.trim() || undefined, tester: name || "Anonymous tester", demo } }, {
      onSuccess: (next) => {
        qc.setQueryData(getGetTestSessionQueryKey(sessionId), next);
        setAnswered((a) => [...a, pair.sampleInputId]); setPick(null); setRating(null); setComment("");
        say("Response recorded.");
        if (idx < s.pairs.length - 1) setIdx(idx + 1);
      },
      onError: (e) => say(errMsg(e)),
    });
  };

  return (
    <Page>
      <div className="eyebrow flex items-center gap-1.5"><EyeOff className="h-3.5 w-3.5" /> Blind test</div>
      <h1 data-testid="text-headline" className="mt-1 text-[28px] font-bold md:text-[34px]">{s.title}</h1>
      <p className="mt-1 text-[15px] text-muted-foreground">Two outputs from the same input. You are not told which version made which. Pick the one that better solves the problem.</p>

      {s.pairs.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-2">{s.pairs.map((p, i) => (
          <button key={p.sampleInputId} data-testid={`pair-${i}`} onClick={() => { setIdx(i); setPick(null); }} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13.5px] font-medium", i === idx ? "border-primary bg-primary text-white" : "border-input bg-card")}>
            {answered.includes(p.sampleInputId) && <Check className="h-3.5 w-3.5" />}Pair {i + 1}: {p.inputName}{p.expired ? " (expired)" : ""}
          </button>
        ))}</div>
      )}

      {pair ? (
        <>
          {expired && <p className="mt-5 rounded-xl bg-accent/70 px-4 py-3 text-[14px] text-accent-foreground" data-testid="text-pair-expired">This pair has expired: Version B changed after these outputs were produced, so responses are no longer accepted. The owner can start a fresh test.</p>}
          <details className="mt-5 rounded-xl bg-muted/60 p-4 text-[14px]"><summary className="cursor-pointer font-semibold text-primary">Input: {pair.inputName}</summary><pre className="mt-2 whitespace-pre-wrap font-mono text-[12.5px]">{pair.inputText}</pre></details>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {(["left", "right"] as const).map((side) => (
              <button key={side} data-testid={`card-${side}`} disabled={expired} onClick={() => setPick(side)}
                className={cn("card-soft p-5 text-left transition-[border-color,box-shadow]", expired ? "opacity-60" : pick === side ? "border-sienna shadow-[0_0_0_3px_hsl(var(--sienna)/.25)]" : "hover:border-primary/40")}>
                <div className="mb-3 flex items-center gap-2"><span className="text-[15px] font-bold uppercase tracking-wide text-primary">{side}</span>{pick === side && <Tag tone="sienna">Your pick</Tag>}</div>
                <OutputView output={pair[side]} testid={`output-${side}`} />
              </button>
            ))}
          </div>
          {!expired && <section className="card-soft mt-5 p-5">
            <div className="grid gap-2 sm:grid-cols-3">
              {(["left", "right", "neither"] as const).map((p) => (
                <button key={p} data-testid={`pick-${p}`} onClick={() => setPick(p)} className={cn("min-h-12 rounded-xl border-2 text-[15.5px] font-semibold", pick === p ? "border-sienna bg-accent text-accent-foreground" : "border-input bg-card text-primary hover:border-primary")}>
                  {p === "neither" ? "Neither is good enough" : `${p[0].toUpperCase()}${p.slice(1)} is better`}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px]">
              <span className="text-muted-foreground">Usefulness (optional)</span>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} data-testid={`rating-${n}`} onClick={() => setRating(rating === n ? null : n)} className={cn("grid h-9 w-9 place-items-center rounded-lg border font-semibold", rating === n ? "border-primary bg-primary text-white" : "border-input bg-card")}>{n}</button>)}
            </div>
            <input data-testid="input-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" className="mt-3 h-11 w-full rounded-xl border border-input px-3 outline-none focus:border-primary" />
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <input data-testid="input-tester" value={tester} onChange={(e) => setTester(e.target.value)} placeholder={me?.name ? `Your name (default ${me.name})` : "Your name"} className="h-11 w-64 rounded-xl border border-input px-3 outline-none focus:border-primary" />
              <label className="inline-flex items-center gap-2 text-[14px]"><Checkbox data-testid="checkbox-demo" checked={demo} onCheckedChange={(v) => setDemo(v === true)} /> This is a demo account vote</label>
              <button data-testid="button-submit-response" disabled={!pick || respond.isPending} onClick={submit} className={cn(btn.primary, "ml-auto")}>Submit response</button>
            </div>
          </section>}
        </>
      ) : <p className="mt-6 text-muted-foreground">This session has no pairs to compare.</p>}

      <section className="mt-8" data-testid="panel-results">
        <h2 className="mb-3 text-[18px] font-semibold">Results</h2>
        {s.results && (answered.length > 0 || s.responseCount > 0) ? (
          <div className="card-soft p-5">
            <SummaryCounts s={s.results} testid="summary-session" />
            <p className="mt-2 text-[12.5px] text-muted-foreground">Left and right were randomised per pair; the counts above are mapped back to A and B. Demo votes are labelled as demonstration data.</p>
            {s.setAside > 0 && <p className="mt-1 text-[12.5px] text-muted-foreground" data-testid="text-session-set-aside">{s.setAside} response{s.setAside === 1 ? "" : "s"} from earlier configurations (set aside, not counted above).</p>}
          </div>
        ) : s.setAside > 0 ? (
          <p className="text-[14px] text-muted-foreground" data-testid="text-session-set-aside">No responses yet for the current Version B. {s.setAside} response{s.setAside === 1 ? "" : "s"} from earlier configurations (set aside).</p>
        ) : <p className="text-[14px] text-muted-foreground">Results stay hidden until responses are collected.</p>}
      </section>
    </Page>
  );
}
