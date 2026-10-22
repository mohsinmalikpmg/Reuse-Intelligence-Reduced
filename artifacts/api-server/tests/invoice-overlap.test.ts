import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { financeRepositoryRoot } from "../src/lib/finance-wiring";
import { currentConsolidationSourceHash } from "../src/lib/consolidation-recipes";
// Host-only integration check, intentionally outside the API production source root.
import { deriveInvoiceOverlap, invoiceApps, invoiceInventory, reviewedInvoiceHashes } from "../../workbench/src/lib/invoice-overlap";

const config = {
  selectedSources: invoiceApps.map(a => ({ id: a.id, sha256: reviewedInvoiceHashes[a.id] })),
  capabilityIds: ["fuzzy-search", "bulk-decisions", "spend-tracing"],
  wiring: { edgeIds: ["invoice-to-search", "invoice-to-decisions", "invoice-to-spend"] },
};

test("granular saved exclusions override enabled broad capabilities in coverage", () => {
  const result = deriveInvoiceOverlap({ ...config, config: { schemaVersion: 1, featureIds: ["invoice-details", "budget-positions"] } });
  for (const id of ["fuzzy", "structured-filters", "duplicates", "bulk", "queue", "lines", "audit"]) {
    const row = result.rows.find(r => r.id === id)!;
    assert.equal(row.enabled, false, id);
    assert.equal(row.action, "keep separate", id);
  }
  assert.equal(result.rows.find(r => r.id === "budgets")!.enabled, true);
});

test("inventory evidence belongs to unchanged reviewed source archives", async () => {
  for (const app of invoiceApps) {
    assert.equal(await currentConsolidationSourceHash(app.id), reviewedInvoiceHashes[app.id], `${app.id} needs a new source review`);
    const folder = join(financeRepositoryRoot(), "artifacts", app.id);
    const allowlist: string[] = JSON.parse(await readFile(join(folder, "package-files.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(folder, "capability-manifest.json"), "utf8"));
    const mapped = new Set<string>([
      "capability-manifest.json",
      ...Object.values(manifest.capabilities).flat().map(p => String(p).split("#")[0]),
      ...(manifest.tests ?? []),
    ]);
    for (const row of invoiceInventory) for (const path of row.cells[app.id]?.paths ?? []) {
      assert.ok(allowlist.includes(path), `${app.id}/${path} is not registered`);
      assert.ok(mapped.has(path), `${app.id}/${path} is not manifest-backed`);
      assert.ok((await readFile(join(folder, path))).length > 0);
    }
  }
});

test("counts reconcile to normalized rows without claiming retired implementations or savings", () => {
  const { rows, counts } = deriveInvoiceOverlap(config);
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  assert.equal(counts.groups, rows.length);
  assert.equal(counts.overlapGroups + counts.uniqueGroups + counts.unknownGroups, counts.groups);
  assert.equal(counts.proposedGroups, rows.filter(r => r.action !== "keep separate").length);
  assert.equal(counts.verifiedReplacements, 0);
  assert.equal(counts.retiredApps, 0);
  assert.equal(rows.find(r => r.id === "duplicates")?.action, "combine");
  assert.equal(rows.find(r => r.id === "payment")?.action, "keep separate");
  assert.equal(rows.find(r => r.id === "search-url")?.action, "combine");
  assert.equal(rows.find(r => r.id === "search-explanations")?.action, "keep separate");
  assert.equal(rows.find(r => r.id === "actions")?.action, "replace");
  assert.equal(rows.find(r => r.id === "summary")?.action, "combine");
  assert.equal(rows.find(r => r.id === "fuzzy")?.action, "retain");
});

test("saved capability, source and wiring choices drive decisions, including after JSON reopen", () => {
  for (const [cap, edge, source, rows] of [
    ["fuzzy-search", "invoice-to-search", "invoice-finder", ["search", "fuzzy", "structured-filters"]],
    ["bulk-decisions", "invoice-to-decisions", "approval-desk", ["actions", "bulk", "queue"]],
    ["spend-tracing", "invoice-to-spend", "spend-tracker", ["summary", "budgets", "overrun", "lines", "trace-navigation"]],
  ] as const) {
    const disabled = { ...config, capabilityIds: config.capabilityIds.filter(x => x !== cap), wiring: { edgeIds: config.wiring.edgeIds.filter(x => x !== edge) } };
    for (const change of [disabled, { ...config, selectedSources: config.selectedSources.filter(s => s.id !== source) }, { ...config, wiring: disabled.wiring }]) {
      const actual = deriveInvoiceOverlap(change);
      assert.deepEqual(actual, deriveInvoiceOverlap(JSON.parse(JSON.stringify(change))));
      for (const id of rows) {
        assert.equal(actual.rows.find(r => r.id === id)?.action, "keep separate");
        assert.equal(actual.rows.find(r => r.id === id)?.enabled, false);
      }
      const replaySelected = change.selectedSources.some(s => s.id === "approval-desk");
      assert.equal(actual.rows.find(r => r.id === "records")?.action, replaySelected ? "combine" : "keep separate");
      if (!replaySelected) {
        assert.equal(actual.rows.find(r => r.id === "summary")?.action, "keep separate");
        assert.ok(actual.rows.filter(r => r.requiresReplay).every(r => r.action === "keep separate"));
        assert.match(actual.rows.find(r => r.id === "records")!.implementation, /withheld/);
      }
    }
  }
});

test("source review inventories secondary screens and explicit remaining gaps", () => {
  for (const id of [
    "structured-filters", "search-explanations", "search-url", "detail", "duplicates",
    "budgets", "overrun", "queue", "audit", "records", "lines", "trace-navigation",
    "storage", "reset", "payment", "production-auth",
  ]) assert.ok(invoiceInventory.some(row => row.id === id), `missing reviewed feature group ${id}`);
  const { rows } = deriveInvoiceOverlap(config);
  assert.match(rows.find(r => r.id === "payment")!.differences, /no mark-paid command/);
  assert.match(rows.find(r => r.id === "search-explanations")!.differences, /Remaining gap/);
  assert.match(rows.find(r => r.id === "search-url")!.differences, /independently implements/);
  assert.match(rows.find(r => r.id === "duplicates")!.differences, /independently implemented/);
  assert.match(rows.find(r => r.id === "audit")!.differences, /not durable audit retention/);
  assert.match(rows.find(r => r.id === "budgets")!.differences, /not Finder\/Desk totals functions/);
});

test("search and spend panels disable as units, while duplicate/detail baseline remains", () => {
  const noFeatures = deriveInvoiceOverlap({ ...config, capabilityIds: [], wiring: { edgeIds: [] } });
  for (const row of noFeatures.rows) if (row.capabilityId) {
    assert.equal(row.enabled, false, `${row.id} must not imply a visible disabled-capability feature`);
    assert.equal(row.action, "keep separate");
  }
  for (const id of ["duplicates", "detail", "records", "audit", "storage", "reset", "search-url"]) {
    assert.equal(noFeatures.rows.find(row => row.id === id)?.enabled, true, `${id} is baseline`);
  }
  for (const id of ["payment", "search-explanations", "production-auth"]) {
    assert.equal(noFeatures.rows.find(row => row.id === id)?.enabled, false, `${id} remains a gap`);
  }
  assert.equal(noFeatures.rows.find(row => row.id === "queue")?.enabled, false, "stage/queue controls are bulk-gated, unlike stage display");
  assert.equal(noFeatures.rows.find(row => row.id === "queue")?.capabilityId, "bulk-decisions");
});

test("omitting pinned replay source never certifies dependent baseline or spend functions", () => {
  const result = deriveInvoiceOverlap({
    ...config, selectedSources: config.selectedSources.filter(s => s.id !== "approval-desk"),
  });
  for (const row of result.rows.filter(row => row.requiresReplay)) {
    assert.equal(row.enabled, false, row.id);
    assert.equal(row.action, "keep separate", row.id);
    assert.match(row.implementation, /withheld/);
    assert.match(row.rationale, /runtime adapter still imports Approval Desk replay/);
  }
  assert.equal(result.counts.verifiedReplacements, 0);
});

test("changed source hashes invalidate proposals rather than laundering stale evidence", () => {
  const changed = deriveInvoiceOverlap({ ...config, selectedSources: config.selectedSources.map(s => ({ ...s, sha256: "changed" })) });
  assert.equal(changed.counts.unknownGroups, changed.counts.groups);
  assert.equal(changed.counts.proposedGroups, 0);
  assert.ok(changed.rows.every(r => !r.enabled));
});
