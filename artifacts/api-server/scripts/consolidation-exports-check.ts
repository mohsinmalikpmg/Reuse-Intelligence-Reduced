import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { financeCatalog } from "../src/lib/finance-wiring";
import { buildConsolidationExport, getConsolidationExportFingerprint } from "../src/lib/consolidation-export-builder";
import { consolidationFingerprint, type ConsolidationCase } from "../src/lib/consolidation-recipes";

async function check(recipeId: "invoice" | "finance", sourceIds: string[], capabilityIds: string[], edgeIds: string[], config: Record<string, unknown>) {
  const c: ConsolidationCase = {id:"cc_export_check",recipeId,title:"Export verification",need:"Verify the selected actual application",baseSolutionId:sourceIds[0],
    selectedSources:sourceIds.map(id=>({id,solutionId:id,version:"fixture",sha256:"fixture"})),capabilityIds,wiring:{edgeIds},config,revision:1,createdAt:"",updatedAt:"",fingerprint:"",runUrl:""};
  c.fingerprint=consolidationFingerprint(c);
  const source=await getConsolidationExportFingerprint(recipeId);
  const output=await buildConsolidationExport(c,source);
  assert(output.checks.every(c=>c.passed));
  assert(output.bytes.length>0);
  console.log(`${recipeId} ${capabilityIds.join("+")}: ${output.sha256} (${output.bytes.length} bytes)`);
  await assert.rejects(buildConsolidationExport(c,"stale-source"),/source changed/);
}
try {
  await check("invoice",["invoice-finder","approval-desk","spend-tracker"],["fuzzy-search","bulk-decisions","spend-tracing"],["invoice-to-search","invoice-to-decisions","invoice-to-spend"],{schemaVersion:1});
  await check("invoice",["invoice-finder","spend-tracker"],["spend-tracing"],["invoice-to-spend"],{schemaVersion:1});
  const catalog=await financeCatalog();
  await check("finance",["budget-and-forecast","management-reporting"],["forecast-projection","management-reporting"],["forecast-to-report"],{...catalog.defaultConfig,adjustment:360});
} finally { await pool.end(); }
