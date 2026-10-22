import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { getListCompositionsQueryKey, type Composition } from "@workspace/api-client-react";
import {
  acceptKeyFor, caseCompositionOptions, compKeys,
  useAcceptSuggestion, useApplyRefinement, useSavePlan, useUndoComposition,
} from "./composition";

const fixture = (revision = 1, caseId: string | null = "case-cache-test"): Composition => ({
  id: "cmp-cache-test", revision, caseId, caseKind: caseId ? "case" : "proposal",
  sources: [{ solutionId: "base", version: "1" }], sourceEvidence: [],
  sourceFingerprint: "test", baseline: {}, provenance: {},
  desiredOutcome: "Goal", targetGroup: "", comparisonContext: "",
  executable: !!caseId, canUndo: revision > 1, limitations: [],
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  plan: {
    title: "Plan", goal: "Goal", goalInferred: false, baseSolutionId: "base", rationale: "",
    decisions: [{ solutionId: "base", disposition: "included", reason: "" }],
    flow: [{ sourceSolutionId: "base", capabilityId: "base-cap", reason: "" }],
    overlapDecisions: [], dependencies: [], integrationGaps: [], clarifications: [],
    librarySuggestions: [], capabilityGaps: [],
  },
});

function hooks(qc: QueryClient) {
  let result!: {
    accept: ReturnType<typeof useAcceptSuggestion>;
    apply: ReturnType<typeof useApplyRefinement>;
    save: ReturnType<typeof useSavePlan>;
    undo: ReturnType<typeof useUndoComposition>;
  };
  function Harness() {
    result = { accept: useAcceptSuggestion(), apply: useApplyRefinement(), save: useSavePlan(), undo: useUndoComposition() };
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
  return result;
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// Compile-time regression guard: neither of the app's single-plan keys accepts a list.
function assertCacheTypes(qc: QueryClient, c: Composition) {
  // @ts-expect-error The detail query holds a Composition, never Composition[].
  qc.setQueryData(compKeys.one(c.id), [c]);
  // @ts-expect-error The linked query holds a Composition or null, never Composition[].
  qc.setQueryData(compKeys.forCase("case"), [c]);
}
void assertCacheTypes;

test("case reads cache one object or null, separate from the generated array query", async (t) => {
  const qc = client();
  t.after(() => qc.clear());
  let response: unknown = [fixture()];
  let status = 200;
  t.mock.method(globalThis, "fetch", async () => json(response, status));
  const options = caseCompositionOptions("case-cache-test");
  assert.deepEqual(await qc.fetchQuery(options), fixture());
  assert.notDeepEqual(options.queryKey, getListCompositionsQueryKey({ caseId: "case-cache-test" }));
  response = [];
  assert.equal(await qc.fetchQuery(options), null);
  for (status of [401, 404]) assert.equal(await qc.fetchQuery(options), null);
  qc.setQueryData(options.queryKey, fixture());
  status = 500;
  await assert.rejects(qc.fetchQuery(options));
  assert.deepEqual(qc.getQueryData(options.queryKey), fixture(), "failed reads preserve the last valid plan");
});

for (const operation of ["accept", "apply", "save", "undo"] as const) {
  for (const linked of [true, false]) {
    test(`${operation} keeps detail and ${linked ? "linked" : "proposal-only"} caches object-shaped`, async (t) => {
      const qc = client();
      t.after(() => qc.clear());
      const old = fixture(1, linked ? "case-cache-test" : null);
      const saved = { ...old, revision: 2, canUndo: true };
      qc.setQueryData(compKeys.one(old.id), old);
      if (old.caseId) qc.setQueryData(compKeys.forCase(old.caseId), null);
      const caseKey = ["/api/cases/case-cache-test"];
      qc.setQueryData(caseKey, { title: "case" });
      qc.setQueryData(["unrelated"], "unchanged");
      const listKey = getListCompositionsQueryKey();
      qc.setQueryData(listKey, [old]);
      t.mock.method(globalThis, "fetch", async () => json(saved));
      const m = hooks(qc);
      const vars = { id: old.id, expectedRevision: 1, suggestionId: "donor", previewId: "preview", plan: old.plan };
      assert.deepEqual(await m[operation].mutateAsync(vars), saved);
      assert.deepEqual(qc.getQueryData(compKeys.one(old.id)), saved);
      if (old.caseId) assert.deepEqual(qc.getQueryData(compKeys.forCase(old.caseId)), saved);
      assert.deepEqual(qc.getQueryData(listKey), [old], "ordinary list caches remain arrays");
      assert.equal(qc.getQueryState(caseKey)?.isInvalidated, linked);
      assert.equal(qc.getQueryState(["unrelated"])?.isInvalidated, false);
    });
  }
}

test("accept, retry and undo replace complete saved snapshots without appending donors", async (t) => {
  const qc = client();
  t.after(() => qc.clear());
  const before = fixture();
  const accepted: Composition = {
    ...fixture(2), sources: [...before.sources, { solutionId: "donor", version: "1" }],
    acceptedSuggestions: [{ suggestionId: "suggestion", sourceSolutionId: "donor", acceptedRevision: 2, executable: false }],
    plan: { ...before.plan, integrationGaps: ["Donor is proposed, not executed"] },
  };
  let response = accepted;
  t.mock.method(globalThis, "fetch", async () => json(response));
  const m = hooks(qc);
  const vars = { id: before.id, expectedRevision: 1, suggestionId: "suggestion" };
  await m.accept.mutateAsync(vars);
  await m.accept.mutateAsync(vars);
  assert.deepEqual(qc.getQueryData(compKeys.forCase(before.caseId!)), accepted);
  assert.equal(acceptKeyFor(before.id, "suggestion", 1), acceptKeyFor(before.id, "suggestion", 1));
  response = { ...before, revision: 3 };
  await m.undo.mutateAsync({ id: before.id, expectedRevision: 2 });
  assert.deepEqual(qc.getQueryData(compKeys.forCase(before.caseId!)), response);
});

for (const operation of ["accept", "apply", "save", "undo"] as const) {
  test(`${operation} rejects failures without replacing data and refreshes only the conflicted plan`, async (t) => {
    const qc = client();
    t.after(() => qc.clear());
    const before = fixture();
    qc.setQueryData(compKeys.one(before.id), before);
    qc.setQueryData(compKeys.forCase(before.caseId!), before);
    const other: Composition = { ...before, id: "other" };
    qc.setQueryData(compKeys.forCase("other"), other);
    let status = 500;
    t.mock.method(globalThis, "fetch", async () => json({ error: "Rejected" }, status));
    const m = hooks(qc);
    const vars = { id: before.id, expectedRevision: 1, suggestionId: "donor", previewId: "preview", plan: before.plan };
    await assert.rejects(m[operation].mutateAsync(vars));
    assert.deepEqual(qc.getQueryData(compKeys.forCase(before.caseId!)), before);
    assert.equal(qc.getQueryState(compKeys.one(before.id))?.isInvalidated, false);
    status = 409;
    await assert.rejects(m[operation].mutateAsync(vars));
    assert.deepEqual(qc.getQueryData(compKeys.one(before.id)), before);
    assert.equal(qc.getQueryState(compKeys.one(before.id))?.isInvalidated, true);
    assert.equal(qc.getQueryState(compKeys.forCase(before.caseId!))?.isInvalidated, true);
    assert.equal(qc.getQueryState(compKeys.forCase("other"))?.isInvalidated, false);
  });
}

test("a pending older linked read cannot overwrite a successful mutation", async (t) => {
  const qc = client();
  t.after(() => qc.clear());
  const before = fixture();
  const saved = fixture(2);
  qc.setQueryData(compKeys.forCase(before.caseId!), before);
  let finish!: (value: Composition) => void;
  const observer = new QueryObserver(qc, {
    queryKey: compKeys.forCase(before.caseId!),
    queryFn: () => new Promise<Composition>((resolve) => { finish = resolve; }),
  });
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  t.mock.method(globalThis, "fetch", async () => json(saved));
  await hooks(qc).accept.mutateAsync({ id: before.id, suggestionId: "donor", expectedRevision: 1 });
  finish(before);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(qc.getQueryData(compKeys.forCase(before.caseId!)), saved);
});

test("409 reloads an observed linked plan from the server without reporting mutation success", async (t) => {
  const qc = client();
  t.after(() => qc.clear());
  const before = fixture();
  const latest = fixture(4);
  qc.setQueryData(compKeys.forCase(before.caseId!), before);
  t.mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "POST" ? json({ error: "Revision changed" }, 409) : json([latest]));
  const observer = new QueryObserver(qc, { ...caseCompositionOptions(before.caseId!), staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  t.after(unsubscribe);
  let successes = 0;
  await hooks(qc).accept.mutateAsync({ id: before.id, expectedRevision: 1, suggestionId: "donor" })
    .then(() => { successes++; }, () => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(successes, 0);
  assert.deepEqual(qc.getQueryData(compKeys.forCase(before.caseId!)), latest);
});
