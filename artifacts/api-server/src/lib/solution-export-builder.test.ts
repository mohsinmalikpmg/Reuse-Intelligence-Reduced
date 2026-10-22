import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import yauzl from "yauzl";
import { capabilities } from "../data/catalog";
import { buildSolutionExport, getExportSourceFingerprint, SolutionExportBuildError, type SolutionExportSnapshot } from "./solution-export-builder";

const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function snapshot(baseSolutionId = "sol-workorder-insight", ids = ["cap-wo-ingest", "cap-summarize", "cap-recurring", "cap-review-queue", "cap-routing", "cap-notify", "cap-approval", "cap-audit"]): SolutionExportSnapshot {
  const selected = ids.map(id => capabilities.find(c => c.id === id)!);
  return {
    caseId: "case-export-test", title: "Trusted case <script>alert(1)</script>", baseSolutionId, parentVersion: "3.2",
    capabilities: selected, configValues: Object.fromEntries(selected.filter(c => c.controlType === "configurable").map(c => [c.id, c.defaultOption!])),
    unresolvedRequests: [{ text: "DO_NOT_INCLUDE_REQUEST_SECRET", code: "throw Error('UNTRUSTED')" }],
    requirements: [{ text: "DO_NOT_INCLUDE_REQUIREMENT_SECRET" }],
  };
}
async function unpack(bytes: Buffer): Promise<Map<string, Buffer>> {
  const result = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      zip.on("error", reject); zip.on("end", resolve);
      zip.on("entry", entry => zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return reject(error);
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => { result.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
      }));
      zip.readEntry();
    });
  });
  return result;
}

test("deterministic artifact includes exact trusted sources, hashes, runnable code and explicit gaps", { timeout: 90_000 }, async () => {
  const input = snapshot();
  const first = await buildSolutionExport(input);
  const second = await buildSolutionExport({ ...input, capabilities: [...input.capabilities].reverse(), configValues: Object.fromEntries(Object.entries(input.configValues).reverse()) });
  assert.equal(first.sha256, second.sha256);
  assert.ok(first.bytes.equals(second.bytes));
  assert.equal(first.sha256, digest(first.bytes));
  assert.ok(first.checks.every(c => c.passed));
  assert.ok(first.checks.some(c => c.name === "exported-tests" && c.detail.includes("fail 0")));
  assert.ok(first.checks.some(c => c.name === "exported-startup-http"));
  assert.ok(first.gaps.some(g => g.includes("DO_NOT_INCLUDE_REQUEST_SECRET") && g.includes("not implemented")));
  assert.ok(first.gaps.some(g => g.includes("cap-audit")));
  const entries = await unpack(first.bytes);
  for (const file of first.files) assert.equal(file.sha256, digest(entries.get(file.path)!));
  assert.equal(first.files.length, entries.size);
  const all = [...entries.values()].map(b => b.toString()).join("\n");
  assert.ok(all.includes("DO_NOT_INCLUDE_REQUEST_SECRET"));
  assert.ok(all.includes("DO_NOT_INCLUDE_REQUIREMENT_SECRET"));
  assert.ok(!all.includes("throw Error('UNTRUSTED')"));
  assert.deepEqual(JSON.parse(entries.get("package.json")!.toString()).dependencies, {});
  const source = await readFile(join(process.cwd(), process.cwd().endsWith("api-server") ? "src/engine/steps.ts" : "artifacts/api-server/src/engine/steps.ts"));
  assert.ok(entries.get("source/engine/steps.ts")!.equals(source));
  assert.equal(JSON.parse(entries.get("source-manifest.json")!.toString()).sourceFingerprint, await getExportSourceFingerprint());
  const manifest = JSON.parse(entries.get("source-manifest.json")!.toString());
  assert.deepEqual(manifest.requiredEnvironmentVariables, []);
  assert.deepEqual(manifest.optionalEnvironmentVariables, ["PORT"]);
  assert.equal(manifest.selectedCapabilities.find((c: { id: string }) => c.id === "cap-summarize").sourceSolutionId, "sol-workorder-insight");
  assert.ok(manifest.selectedCapabilities.every((c: { version: string }) => c.version));

  // Independent second extraction, with no parent node_modules, confirms the shipped tests really execute.
  const clean = await mkdtemp(join(tmpdir(), "export-independent-test-"));
  try {
    for (const [path, body] of entries) {
      const destination = join(clean, path); await mkdir(join(destination, ".."), { recursive: true }); await writeFile(destination, body);
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--max-old-space-size=128", "--test", "test/workflow.test.mjs"], { cwd: clean, env: { TZ: "UTC" }, stdio: "ignore" });
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Independent tests timed out")); }, 15_000);
      child.on("error", reject);
      child.on("close", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Independent test exit ${code}`)); });
    });
  } finally { await rm(clean, { recursive: true, force: true }); }
});

test("exports procedure, incident, handover and alias demo engines", { timeout: 90_000 }, async () => {
  for (const [base, ids] of [
    ["sol-sop-chat", ["cap-proc-index", "cap-proc-answers"]],
    ["sol-incident-commander", ["cap-safety-signals", "cap-incident-actions"]],
    ["sol-handover-notes", ["cap-handover-summary"]],
    ["sol-site-pattern-finder", ["cap-csv-ingest", "cap-b-summarize", "cap-clustering", "cap-similarity"]],
  ] as [string, string[]][]) {
    const result = await buildSolutionExport(snapshot(base, ids));
    assert.ok(result.checks.every(c => c.passed), base);
  }
});

test("rejects unsupported, dependency-invalid, incompatible, duplicate and injected configuration selections", async () => {
  const input = snapshot();
  for (const bad of [
    { ...input, baseSolutionId: "sol-finance" },
    { ...input, capabilities: [{ ...input.capabilities[0]!, id: "uploaded-executor" }] },
    { ...input, capabilities: [capabilities.find(c => c.id === "cap-recurring")!] },
    { ...input, capabilities: [input.capabilities[0]!, input.capabilities[0]!] },
    { ...input, configValues: { ...input.configValues, API_KEY: "do-not-export" } },
    { ...input, configValues: { ...input.configValues, "cap-summarize": "execute evil code" } },
    { ...input, configValues: {} },
  ]) {
    await assert.rejects(buildSolutionExport(bad), (error: unknown) => {
      assert.ok(error instanceof SolutionExportBuildError);
      assert.equal(error.sha256, undefined);
      assert.ok(error.checks.some(c => !c.passed));
      return true;
    });
  }
});

test("untrusted capability metadata is never used to generate source", async () => {
  const input = snapshot("sol-handover-notes", ["cap-handover-summary"]);
  input.capabilities[0] = { ...input.capabilities[0]!, name: "DO_NOT_INCLUDE_METADATA_SECRET", sourceSolutionId: "uploaded-solution" };
  const result = await buildSolutionExport(input);
  assert.ok(!result.bytes.includes(Buffer.from("DO_NOT_INCLUDE_METADATA_SECRET")));
});

test("failure evidence preserves an artifact hash and failed checks when bytes exist", () => {
  const bytes = Buffer.from("failed artifact");
  const error = new SolutionExportBuildError("Fixture failure", digest(bytes), [{ name: "exported-tests", passed: false, detail: "Expected failure" }], bytes);
  assert.equal(error.sha256, digest(error.bytes!));
  assert.equal(error.checks[0]!.passed, false);
});
