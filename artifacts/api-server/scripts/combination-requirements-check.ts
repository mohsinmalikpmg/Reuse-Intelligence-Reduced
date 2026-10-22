import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { consolidationCaseInput, saveConsolidationCase, ownedConsolidationCase, openIntakeCombination } from "../src/lib/consolidation-recipes";

const actor = `requirements-check-${randomUUID()}`;
const briefId = `requirements-check-${randomUUID()}`;
const requirements = [
  { id: "search", text: "Search invoices" },
  { id: "approval", text: "Approve multiple invoices" },
  { id: "payments", text: "Pay suppliers through SAP" },
];
try {
  assert.equal(process.env.NODE_ENV, "development");
  await pool.query("INSERT INTO briefs(id,raw_text,fields,source,value_statement,requirements,confirmed) VALUES($1,$2,'{}','text',$2,$3,false)", [briefId, "Invoice integration test", JSON.stringify(requirements)]);
  const input = {
    briefId, recipeId: "invoice" as const, title: "Temporary requirements check", need: "Search and approve invoices",
    baseSolutionId: "invoice-finder", selectedSourceIds: ["invoice-finder", "approval-desk"],
    capabilityIds: ["fuzzy-search", "bulk-decisions"], config: { schemaVersion: 1 },
    wiring: { edgeIds: ["invoice-to-search", "invoice-to-decisions"] },
  };
  await assert.rejects(saveConsolidationCase(actor, input), /Confirm the intake/);
  assert.equal(consolidationCaseInput.safeParse({ ...input, requirements: [] }).success, false);
  await pool.query("UPDATE briefs SET confirmed=true WHERE id=$1", [briefId]);
  const created = await saveConsolidationCase(actor, input);
  assert.equal(created.briefId, briefId);
  assert.deepEqual(created.assessment?.map(r => r.status), ["covered", "covered", "missing"]);
  assert.deepEqual(await ownedConsolidationCase(actor, created.id), created);
  const removed = await saveConsolidationCase(actor, { ...input, capabilityIds: ["fuzzy-search"], wiring: { edgeIds: ["invoice-to-search"] } }, created.id, created.revision);
  assert.equal(removed.assessment?.[1].status, "missing");
  const [reopened, concurrent] = await Promise.all([openIntakeCombination(actor, briefId, "invoice"), openIntakeCombination(actor, briefId, "invoice")]);
  assert.equal(reopened.id, created.id);
  assert.equal(concurrent.id, created.id);
  assert.deepEqual(reopened.capabilityIds, ["fuzzy-search"]);
  const restored = await saveConsolidationCase(actor, input, removed.id, removed.revision);
  assert.equal(restored.assessment?.[1].status, "covered");
  // A later intake edit must not silently rewrite the agreed snapshot.
  await pool.query("UPDATE briefs SET requirements='[]' WHERE id=$1", [briefId]);
  assert.equal((await saveConsolidationCase(actor, input, restored.id, restored.revision)).requirements?.length, 3);
  const { briefId: _, ...legacyInput } = input;
  const legacy = await saveConsolidationCase(actor, legacyInput);
  assert.deepEqual(legacy.assessment, []);
  await pool.query("UPDATE briefs SET requirements=$2 WHERE id=$1", [briefId, JSON.stringify(requirements)]);
  const linked = await saveConsolidationCase(actor, input, legacy.id, legacy.revision);
  assert.equal(linked.requirements?.length, 3);
  await assert.rejects(ownedConsolidationCase("another-owner", linked.id), /not found/);
  await pool.query("DELETE FROM consolidation_cases WHERE user_id=$1", [actor]);
  const [automatic, duplicate] = await Promise.all([openIntakeCombination(actor, briefId, "invoice"), openIntakeCombination(actor, briefId, "invoice")]);
  assert.equal(automatic.id, duplicate.id);
  assert.equal(automatic.briefId, briefId);
  assert.equal(automatic.requirements?.length, 3);
  assert.equal(automatic.selectedSources.length, 3);
  console.info("PASS: automatic intake handoff, concurrent idempotence, preservation of edits, confirmed snapshot, persistence, remove/restore and owner isolation.");
} finally {
  await pool.query("DELETE FROM consolidation_cases WHERE user_id=$1", [actor]);
  await pool.query("DELETE FROM briefs WHERE id=$1", [briefId]);
  await pool.end();
}
