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
  assert.equal(rows.find(r => r.id === "duplicates")?.action, "keep separate");
  assert.equal(rows.find(r => r.id === "actions")?.action, "replace");
  assert.equal(rows.find(r => r.id === "summary")?.action, "combine");
  assert.equal(rows.find(r => r.id === "fuzzy")?.action, "retain");
});

test("saved capability, source and wiring choices drive decisions, including after JSON reopen", () => {
  for (const [cap, edge, source, rows] of [
    ["fuzzy-search", "invoice-to-search", "invoice-finder", ["search", "fuzzy"]],
    ["bulk-decisions", "invoice-to-decisions", "approval-desk", ["actions", "bulk"]],
    ["spend-tracing", "invoice-to-spend", "spend-tracker", ["summary", "lines"]],
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
        assert.equal(actual.counts.proposedGroups, 3);
        assert.match(actual.rows.find(r => r.id === "records")!.implementation, /withheld/);
      }
    }
  }
});

test("changed source hashes invalidate proposals rather than laundering stale evidence", () => {
  const changed = deriveInvoiceOverlap({ ...config, selectedSources: config.selectedSources.map(s => ({ ...s, sha256: "changed" })) });
  assert.equal(changed.counts.unknownGroups, changed.counts.groups);
  assert.equal(changed.counts.proposedGroups, 0);
  assert.ok(changed.rows.every(r => !r.enabled));
});
