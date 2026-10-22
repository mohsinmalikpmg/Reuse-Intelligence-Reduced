import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { invoiceAnalysis, invoiceAnalysisOptions } from "../src/lib/invoice-analysis";
import { analyze } from "../src/lib/ai-analysis";
import { financeRepositoryRoot } from "../src/lib/finance-wiring";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

try {
  const { rows } = await pool.query("SELECT id,user_id FROM consolidation_cases WHERE snapshot->>'recipeId'='invoice' ORDER BY updated_at DESC LIMIT 1");
  if (!rows[0] && process.argv.includes("--provider-only")) {
    const root = financeRepositoryRoot();
    const manifest = JSON.parse(await readFile(join(root, "artifacts/approval-desk/capability-manifest.json"), "utf8"));
    const result = await analyze({
      purpose: "invoice-provider-smoke", promptVersion: "invoice-provider-smoke-v1", force: true,
      instructions: 'Explain one evidenced Approval Desk capability from this authentic manifest. Return JSON {"capabilityId":"exact manifest capability key","explanation":"one grounded sentence"}. Do not claim runtime verification.',
      input: { manifest },
      schema: z.object({
        capabilityId: z.string().refine(id => Object.hasOwn(manifest.capabilities, id)),
        explanation: z.string().min(1),
      }).strict(),
    });
    console.log(JSON.stringify({ ok: true, providerOnly: true, model: result.provenance.model, capabilityId: result.data.capabilityId, limitation: "No owned invoice case exists; full module smoke requires one." }));
  } else {
  assert.ok(rows[0], "Create an owned invoice case before running this explicit real-model smoke check.");
  const { id, user_id: userId } = rows[0];
  const before = await invoiceAnalysis(userId, id);
  assert.ok(before.analysis === null || before.provenance?.cached === true);
  await assert.rejects(() => invoiceAnalysis("not-the-owner", id), /not found/);
  const result = await invoiceAnalysis(userId, id, true);
  assert.ok(result.analysis && result.provenance && !result.provenance.cached);
  const saved = await invoiceAnalysis(userId, id);
  assert.equal(saved.provenance?.id, result.provenance.id);
  assert.equal(saved.provenance?.cached, true);
  const { options } = await invoiceAnalysisOptions(userId, id);
  const invalidId = structuredClone(result.analysis);
  invalidId.proposals[0].rowId = "invented-feature";
  assert.equal(options.schema.safeParse(invalidId).success, false);
  const invalidCitation = structuredClone(result.analysis);
  invalidCitation.proposals[0].citations[0].sha256 = "fabricated";
  assert.equal(options.schema.safeParse(invalidCitation).success, false);
  console.log(JSON.stringify({ ok: true, model: result.provenance.model, rows: result.analysis.proposals.length, cachedRead: saved.provenance.cached, invalidIdsRejected: true, evidenceHash: result.evidenceHash }));
  }
} finally {
  await pool.end();
}
