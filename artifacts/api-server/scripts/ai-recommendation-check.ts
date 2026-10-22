import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { z } from "zod";
import { analyze, analysisFingerprint, AnalysisError } from "../src/lib/ai-analysis";
import { getCase } from "../src/lib/store";
import { caseContext } from "../src/lib/configuration";
import { buildRecommendation } from "../src/lib/analysis";

try {
  assert.equal(analysisFingerprint({ a: 1, b: 2 }), analysisFingerprint({ b: 2, a: 1 }));
  assert.notEqual(analysisFingerprint({ a: 1 }), analysisFingerprint({ a: 2 }));
  const options = { purpose: "connection-verification", promptVersion: "v1", instructions: 'Return JSON {"connected":true}.', input: { check: "server connectivity" }, schema: z.object({ connected: z.literal(true) }) };
  const first = await analyze({ ...options, force: true });
  const cached = await analyze(options);
  assert.equal(cached.provenance.id, first.provenance.id);
  assert.equal(cached.provenance.cached, true);
  console.info("PASS real provider request, validated output, persisted unchanged-analysis cache");
  const c = await getCase("case_demo");
  assert.ok(c);
  const recommendation = await buildRecommendation(c, caseContext(c), null);
  assert.ok(recommendation.summary);
  assert.ok(recommendation.rationale.some(s => s.includes("AI analysis")));
  assert.equal(recommendation.retirementCandidates.length, 0);
  console.info("PASS real workbench recommendation with model provenance");
  const previous = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  delete process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  await assert.rejects(() => analyze({ ...options, force: true }), AnalysisError);
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = previous;
  console.info("PASS missing configuration fails explicitly with no canned result");
} finally { await pool.end(); }
