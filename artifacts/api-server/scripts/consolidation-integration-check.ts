import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import {
  registerConsolidationSources, registeredConsolidationSources, consolidationSourceDownload,
  saveConsolidationCase, ownedConsolidationCase, listConsolidationCases,
  validateConsolidationCase, consolidationFingerprint, recipeCatalog,
} from "../src/lib/consolidation-recipes";

const temporary: string[] = [];
try {
  if (process.env.NODE_ENV === "production") throw new Error("Development integration check refuses production.");
  // Select only an existing granted actor. Never print identifiers or personal details.
  const {rows} = await pool.query("SELECT id FROM users WHERE can_manage_solution_packages=true ORDER BY created_at LIMIT 1");
  if (!rows[0]) throw new Error("BLOCKED: no existing IT package-management account. No users or permissions changed.");
  const actor: string = rows[0].id;
  const before = await registerConsolidationSources(actor);
  const after = await registerConsolidationSources(actor);
  assert.equal(before.length,5);
  assert.deepEqual(before,after);
  for (const source of after) {
    const download = await consolidationSourceDownload(source.id);
    assert.equal(download.bytes.length,source.size);
  }
  console.info("PASS: privileged idempotent registration; all five private source downloads verify.");
  const two = {
    recipeId: "invoice" as const, title:"Integration test only", need:"Synthetic invoice search and approval consolidation.",
    baseSolutionId:"invoice-finder",selectedSourceIds:["invoice-finder","approval-desk"],
    capabilityIds:["fuzzy-search","bulk-decisions"],config:{schemaVersion:1},
    wiring:{edgeIds:["invoice-to-search","invoice-to-decisions"]},
  };
  const three = {...two,selectedSourceIds:[...two.selectedSourceIds,"spend-tracker"],
    capabilityIds:[...two.capabilityIds,"spend-tracing"],wiring:{edgeIds:[...two.wiring.edgeIds,"invoice-to-spend"]}};
  const original = await saveConsolidationCase(actor,two); temporary.push(original.id);
  assert.deepEqual(await ownedConsolidationCase(actor,original.id),original);
  const updated = await saveConsolidationCase(actor,three,original.id,original.revision);
  assert.equal(updated.revision,2); assert.notEqual(updated.fingerprint,original.fingerprint);
  const undo = await saveConsolidationCase(actor,two,original.id,updated.revision);
  assert.equal(undo.revision,3); assert.equal(undo.fingerprint,original.fingerprint);
  await assert.rejects(saveConsolidationCase(actor,three,original.id,updated.revision),/revision is stale/);
  await assert.rejects(saveConsolidationCase(actor,{...two,wiring:{edgeIds:["unsupported"]}},original.id,undo.revision),/Wiring must connect/);
  assert.deepEqual(await ownedConsolidationCase(actor,original.id),undo);
  const other = `integration-nonexistent-${randomUUID()}`;
  await assert.rejects(ownedConsolidationCase(other,original.id),/not found/);
  await assert.rejects(saveConsolidationCase(other,two,original.id,undo.revision),/not found/);
  assert.equal((await listConsolidationCases(other)).length,0);
  console.info("PASS: persisted two/three-source cases, reload, undo, stale updates, unsupported wiring, owner isolation.");

  // Tamper only this temporary case's pinned source receipt; originals and registry remain unchanged.
  // Restoration is guaranteed even on assertion failure. This exercises persisted drift rejection/recovery.
  const drift = {...undo,selectedSources:undo.selectedSources.map((s,i)=>i ? s : {...s,sha256:"0".repeat(64)})};
  drift.fingerprint = consolidationFingerprint(drift);
  try {
    await pool.query("UPDATE consolidation_cases SET snapshot=$1 WHERE id=$2 AND user_id=$3",[drift,undo.id,actor]);
    await assert.rejects(validateConsolidationCase(await ownedConsolidationCase(actor,undo.id)),/hash changed/);
  } finally {
    await pool.query("UPDATE consolidation_cases SET snapshot=$1 WHERE id=$2 AND user_id=$3",[undo,undo.id,actor]);
  }
  await validateConsolidationCase(await ownedConsolidationCase(actor,undo.id));
  console.info("PASS: persisted source-pin drift blocks validation; restoring exact receipt recovers.");

  const catalog = await recipeCatalog();
  const financeRecipe = catalog.find(r=>r.id==="finance")!;
  const finance = {recipeId:"finance" as const,title:"Integration finance test",need:"Synthetic forecast-to-report consolidation.",
    baseSolutionId:"budget-and-forecast",selectedSourceIds:["budget-and-forecast","management-reporting"],
    capabilityIds:["forecast-projection","management-reporting"],wiring:{edgeIds:["forecast-to-report"]},
    config:financeRecipe.defaultConfig as Record<string,unknown>};
  const initialFinance = await saveConsolidationCase(actor,finance); temporary.push(initialFinance.id);
  const changedFinance = await saveConsolidationCase(actor,{...finance,config:{...finance.config,adjustment:0}},initialFinance.id,1);
  assert.notEqual(changedFinance.fingerprint,initialFinance.fingerprint);
  assert.match(changedFinance.runUrl,/^\/finance-demo\/\?consolidationCaseId=cc_/);
  assert.deepEqual((await ownedConsolidationCase(actor,changedFinance.id)).config,changedFinance.config);
  await validateConsolidationCase(changedFinance);
  console.info("PASS: persisted finance config changes invalidate fingerprint and route to actual finance app.");

  const seeds = [
    {...two,title:"Invoice Operations · Search + Approvals (registered demo)"},
    {...three,title:"Invoice Operations · Search + Approvals + Spend (registered demo)"},
    {...finance,title:"Forecast to Report · Registered finance demo"},
  ];
  const existing = await listConsolidationCases(actor);
  let added = 0;
  for (const seed of seeds) {
    if (!existing.some(c=>c.title===seed.title && c.recipeId===seed.recipeId)) {
      await saveConsolidationCase(actor,seed); added++;
    }
  }
  assert.equal((await registeredConsolidationSources()).length,5);
  console.info(`PASS: three named starter combinations discoverable for the existing IT actor (${added} newly added); existing cases never overwritten.`);
} catch (error) {
  // Do not dump DB objects, actor IDs, or environment configuration.
  console.error(error instanceof Error ? error.message : "Consolidation integration check failed.");
  process.exitCode = 1;
} finally {
  for (const id of temporary) await pool.query("DELETE FROM consolidation_cases WHERE id=$1",[id]);
  await pool.end();
}
