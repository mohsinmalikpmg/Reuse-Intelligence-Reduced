import { Router, type IRouter, type Response } from "express";
import {
  CreateTestSessionBody,
  ListSampleInputsQueryParams,
  RecordEvaluationBody,
  RespondToTestSessionBody,
  RunCaseComparisonBody,
  RunWorkflowBody,
  type ABComparison,
  type Case,
  type EvaluationList,
  type TestSession,
} from "@workspace/api-zod";
import type { TestSessionRow } from "@workspace/db";
import { sampleInputById, sampleInputs, sampleInputsFor } from "../engine/workorders";
import { getCase, updateCaseRow } from "../lib/store";
import { WorkbenchError, buildComparison, buildSolutionWorkbench, currentFingerprints, latestPairs, pairRejection, runCaseVersion, runComparison, runSolution, solutionOr404, toSampleInput } from "../lib/workbench";
import {
  decodePairs,
  getRun,
  getTestSessionRow,
  insertEvaluation,
  insertTestSession,
  listEvaluations,
  listTestSessionRows,
  splitByFingerprint,
  summarizeEvaluations,
  type SessionPair,
} from "../lib/workbench-store";

const router: IRouter = Router();

function fail(res: Response, err: unknown): void {
  if (err instanceof WorkbenchError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

async function loadCase(id: string, res: Response): Promise<Case | null> {
  const c = await getCase(id);
  if (!c) res.status(404).json({ error: "Case not found" });
  return c;
}

router.get("/solutions/:solutionId/workbench", (req, res) => {
  try {
    res.json(buildSolutionWorkbench(solutionOr404(String(req.params["solutionId"]))));
  } catch (err) {
    fail(res, err);
  }
});

router.get("/sample-inputs", (req, res) => {
  const parsed = ListSampleInputsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const list = parsed.data.solutionId ? sampleInputsFor(parsed.data.solutionId) : sampleInputs;
  res.json(list.map(toSampleInput));
});

router.post("/runs", async (req, res) => {
  const parsed = RunWorkflowBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { solutionId, caseId, version, sampleInputId, inputText } = parsed.data;
  try {
    if (caseId) {
      const c = await loadCase(caseId, res);
      if (!c) return;
      res.status(201).json(await runCaseVersion(c, version, sampleInputId, inputText));
      return;
    }
    if (!solutionId) {
      res.status(400).json({ error: "Provide a solutionId or a caseId." });
      return;
    }
    res.status(201).json(await runSolution(solutionOr404(solutionId), sampleInputId, inputText));
  } catch (err) {
    fail(res, err);
  }
});

router.get("/runs/:runId", async (req, res) => {
  const run = await getRun(String(req.params["runId"]));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});

async function comparisonsFor(c: Case): Promise<ABComparison[]> {
  const pairs = await latestPairs(c.id);
  const evaluations = (await listEvaluations(c.id)).filter((e) => !e.blind);
  return pairs.map(({ runA, runB }) => buildComparison(c, runA, runB, evaluations.find((e) => e.runAId === runA.id && e.runBId === runB.id) ?? null));
}

router.get("/cases/:caseId/compare", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  res.json(await comparisonsFor(c));
});

router.post("/cases/:caseId/compare", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = RunCaseComparisonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const { runA, runB } = await runComparison(c, parsed.data.sampleInputId, parsed.data.inputText);
    // A real run on both versions is what makes a case "tested".
    const updated = c.status === "draft" ? await updateCaseRow(c.id, { status: "tested" }) : c;
    res.json(buildComparison(updated, runA, runB, null));
  } catch (err) {
    fail(res, err);
  }
});

/** Votes against the current Version B count; votes against earlier configurations are reported as set aside, never merged. */
async function evaluationList(c: Case): Promise<EvaluationList> {
  const current = currentFingerprints(c);
  const split = splitByFingerprint(await listEvaluations(c.id), current.b);
  const items = split.current.filter((e) => e.fingerprintA === current.a);
  return { summary: summarizeEvaluations(items), items, currentFingerprint: current.b, setAside: split.setAside.length + (split.current.length - items.length) };
}

router.get("/cases/:caseId/evaluations", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  res.json(await evaluationList(c));
});

router.post("/cases/:caseId/evaluations", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = RecordEvaluationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { runAId, runBId, choice, reason, rating, role, evaluator } = parsed.data;
  const runA = await getRun(runAId);
  const runB = await getRun(runBId);
  if (!runA || !runB) {
    res.status(400).json({ error: "Both runs must belong to this case." });
    return;
  }
  // A vote only counts as evidence for the configuration it was cast on, so stale pairs are refused outright.
  const rejection = pairRejection(c, runA, runB);
  if (rejection) {
    res.status(409).json({ error: rejection });
    return;
  }
  await insertEvaluation({
    caseId: c.id,
    sessionId: null,
    sampleInputId: runA.sampleInputId,
    inputHash: runA.inputHash,
    runAId,
    runBId,
    fingerprintA: runA.configFingerprint,
    fingerprintB: runB.configFingerprint,
    choice,
    reason: reason?.trim() || null,
    rating: rating ?? null,
    evaluator,
    role,
    blind: false,
    demo: false,
  });
  res.status(201).json(await evaluationList(c));
});

// ---------- Blind sessions ----------

async function serializeSession(row: TestSessionRow, c: Case): Promise<TestSession> {
  const pairs = decodePairs(row);
  const current = currentFingerprints(c);
  const all = (await listEvaluations(row.caseId)).filter((e) => e.sessionId === row.id);
  const evaluations = all.filter((e) => e.fingerprintA === current.a && e.fingerprintB === current.b);
  const out: TestSession["pairs"] = [];
  for (const p of pairs) {
    const runA = await getRun(p.runAId);
    const runB = await getRun(p.runBId);
    if (!runA || !runB) continue;
    const sample = sampleInputById.get(p.sampleInputId);
    out.push({
      sampleInputId: p.sampleInputId,
      inputName: sample?.name ?? "Custom input",
      inputText: runA.inputText,
      left: p.left === "A" ? runA.output : runB.output,
      right: p.left === "A" ? runB.output : runA.output,
      responses: all.filter((e) => e.runAId === p.runAId && e.runBId === p.runBId).length,
      expired: pairRejection(c, runA, runB) !== null,
    });
  }
  return {
    id: row.id,
    caseId: row.caseId,
    createdBy: row.createdBy,
    title: row.title,
    closed: row.closed,
    pairs: out,
    responseCount: evaluations.length,
    results: evaluations.length > 0 ? summarizeEvaluations(evaluations) : null,
    setAside: all.length - evaluations.length,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/cases/:caseId/test-sessions", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const rows = await listTestSessionRows(c.id);
  res.json(await Promise.all(rows.map((row) => serializeSession(row, c))));
});

router.post("/cases/:caseId/test-sessions", async (req, res) => {
  const c = await loadCase(String(req.params["caseId"]), res);
  if (!c) return;
  const parsed = CreateTestSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Only pairs of the governed baseline and the current Version B go to testers.
  const pairs = (await latestPairs(c.id)).filter((p) => p.runA.sampleInputId && pairRejection(c, p.runA, p.runB) === null);
  if (pairs.length === 0) {
    res.status(400).json({ error: "Run both versions of the current configuration on at least one sample input before inviting testers." });
    return;
  }
  // Left/right is decided once per pair from the run id so the mapping is stable but not guessable from order.
  const sessionPairs: SessionPair[] = pairs.map((p) => ({
    sampleInputId: p.runA.sampleInputId!,
    runAId: p.runA.id,
    runBId: p.runB.id,
    left: parseInt(p.runB.id.slice(-2), 36) % 2 === 0 ? "B" : "A",
  }));
  const row = await insertTestSession({ caseId: c.id, createdBy: parsed.data.createdBy, title: parsed.data.title ?? `${c.title}: blind test`, pairs: sessionPairs });
  res.status(201).json(await serializeSession(row, c));
});

router.get("/test-sessions/:sessionId", async (req, res) => {
  const row = await getTestSessionRow(String(req.params["sessionId"]));
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const c = await loadCase(row.caseId, res);
  if (!c) return;
  res.json(await serializeSession(row, c));
});

router.post("/test-sessions/:sessionId/responses", async (req, res) => {
  const row = await getTestSessionRow(String(req.params["sessionId"]));
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const parsed = RespondToTestSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const pair = decodePairs(row).find((p) => p.sampleInputId === parsed.data.sampleInputId);
  if (!pair) {
    res.status(400).json({ error: "That input is not part of this session." });
    return;
  }
  const c = await loadCase(row.caseId, res);
  if (!c) return;
  const runA = await getRun(pair.runAId);
  const runB = await getRun(pair.runBId);
  if (!runA || !runB) {
    res.status(400).json({ error: "The runs for this pair no longer exist." });
    return;
  }
  if (pairRejection(c, runA, runB)) {
    res.status(409).json({ error: "This pair has expired: Version B changed after these outputs were produced. Ask the owner for a fresh test." });
    return;
  }
  const { pick, rating, comment, tester, demo } = parsed.data;
  const choice = pick === "neither" ? "neither" : pick === "left" ? pair.left : pair.left === "A" ? "B" : "A";
  await insertEvaluation({
    caseId: row.caseId,
    sessionId: row.id,
    sampleInputId: pair.sampleInputId,
    inputHash: runA.inputHash,
    runAId: pair.runAId,
    runBId: pair.runBId,
    fingerprintA: runA.configFingerprint,
    fingerprintB: runB.configFingerprint,
    choice,
    reason: comment?.trim() || null,
    rating: rating ?? null,
    evaluator: tester,
    role: "seeker",
    blind: true,
    demo: demo ?? false,
  });
  res.status(201).json(await serializeSession(row, c));
});

export default router;
