/**
 * Manual publisher: node artifacts/api-server/scripts/package-demo-engine.mjs
 * Requires existing App Storage configuration, Python 3 stdlib and esbuild.
 * Only the literal allowlists below can enter the ZIP. No database is read.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const api = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(api, "../..");
const temporary = await mkdtemp(join(tmpdir(), "solution-code-"));
const stage = join(temporary, "package");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const solutionIds = ["sol-workorder-insight", "sol-site-pattern-finder", "sol-action-tracker", "sol-incident-commander"];
const sourceAllowlist = [
  "engine/run.ts", "engine/steps.ts", "engine/workorders.ts", "engine/types.ts", "engine/diff.ts",
  "data/catalog.ts", "data/catalog-enterprise.ts",
];
const referenceAllowlist = ["output-view.tsx", "wb-compare.tsx", "wb-reuse.tsx"];
const checks = [];
async function put(path, bytes) {
  await mkdir(dirname(join(stage, path)), { recursive: true });
  await writeFile(join(stage, path), bytes);
}
async function bundle(entry, output) {
  await build({ entryPoints: [entry], outfile: output, absWorkingDir: dirname(entry), bundle: true,
    platform: "node", format: "esm", target: "node20", legalComments: "none", logLevel: "silent" });
}

// Capability-specific statements describe actual code, not seeded marketing claims.
const limitations = {
  readNotes: "Parses local pipe-delimited or free-text lines; no CMMS connection and not a general CSV parser.",
  readCsvNotes: "Reads normalized local work-order records with the shared note parser; not a general CSV parser or enterprise connector.",
  summarize: "First matching regex issue label plus leading sentence; no LLM. Uses its own capability configuration key.",
  patternSummarize: "Shared local summarizer factory using Pattern Finder's capability identity and configuration; no LLM.",
  identifyConcerns: "Counts exact site/tag/regex-issue groups; ignores untagged notes; not predictive detection.",
  clusterIssues: "Groups exact equipment class and regex issue with two reports, even within one site; skips general, wear and facility categories.",
  rankPatterns: "Sorts existing clusters by count then latest date; no semantic similarity or historical retrieval.",
  safetySignals: "Fixed keyword/regex lexicon with blanket not-safety-critical exclusion; not a safety assessment.",
  humanReview: "In-memory queue using a parsed numeric threshold; safety grouping uses tag and issue, not site; no human task system.",
  approvalGate: "Adds approval-required text only; does not enforce authorization or block downstream actions.",
  routeFindings: "Produces textual queue labels only; no dispatch or planner integration.",
  notify: "Produces a digest sentence only; sends no notifications.",
  followUpActions: "Generates Open actions with templated owners and latest-report-plus-14-day due dates; no persistence, closure or enforced approval.",
  weeklyReport: "Produces a single totals line; no scheduled reporting or export.",
  execDigest: "Produces one templated headline from existing findings/clusters; no narrative generation.",
  incidentActions: "Regex-splits commitment sentences into Open action text; no lifecycle tracking, owners or system of record.",
};

try {
  await mkdir(stage);
  for (const path of sourceAllowlist) await put(path, await readFile(join(api, "src", path)));
  for (const name of referenceAllowlist) {
    await put(`reference-ui/${name}`, await readFile(join(workspace, "artifacts/workbench/src/components", name)));
  }
  // Bundle only source catalog exports; no runtime service, secrets, uploads or persisted versions.
  const catalogModule = join(temporary, "catalog.mjs");
  await bundle(join(api, "src/data/catalog.ts"), catalogModule);
  const { capabilities, catalogSolutions, CATALOG_VERSION } = await import(pathToFileURL(catalogModule).href);
  const stepsText = await readFile(join(api, "src/engine/steps.ts"), "utf8");
  const registry = [...stepsText.matchAll(/\{ capabilityId: "([^"]+)", run: (\w+) \}/g)]
    .map(([, capabilityId, symbol]) => ({ capabilityId, symbol }));
  if (new Set(registry.map((r) => r.capabilityId)).size !== registry.length || !registry.length) {
    throw new Error("Could not uniquely map executor registry.");
  }
  const registryIds = new Set(registry.map((r) => r.capabilityId));
  const selected = capabilities.filter((c) => solutionIds.includes(c.sourceSolutionId) && registryIds.has(c.id));
  const configurations = solutionIds.map((solutionId) => {
    const solution = catalogSolutions.find((s) => s.id === solutionId);
    if (!solution) throw new Error(`Missing seed solution: ${solutionId}`);
    return { solutionId, capabilityIds: solution.capabilityIds.filter((id) => registryIds.has(id)) };
  });
  const configDocuments = configurations.map((c) => ({
    ...c, scope: "Seed catalog membership restricted to supported executors, not persisted governance state.",
    configValues: Object.fromEntries(c.capabilityIds.map((id) => capabilities.find((cap) => cap.id === id))
      .filter((cap) => cap.defaultOption).map((cap) => [cap.id, cap.defaultOption])),
  }));
  for (const config of configDocuments) await put(`configurations/${config.solutionId}.json`, json(config));
  await put("configurations/capabilities.json", json(selected.map(({ id, name, workflowStep, sourceSolutionId, defaultOption }) =>
    ({ id, name, workflowStep, sourceSolutionId, defaultOption }))));

  const runner = `import assert from "node:assert/strict";
import { executeWorkflow } from "./engine/run";
import { diffOutputs } from "./engine/diff";
import { sampleInputById } from "./engine/workorders";
import capabilities from "./configurations/capabilities.json";
const configs = ${JSON.stringify(configDocuments)};
const checks = [];
const tested = new Set();
function check(name, fn) { fn(); checks.push({ name, passed: true }); }
const items = (r) => r.output.sections.flatMap(s => s.items);
function run(ids, input, values = {}) {
  const active = ids.map(id => { const c = capabilities.find(c => c.id === id); assert.ok(c, id); return c; });
  const r = executeWorkflow(active, values, input);
  assert.deepEqual(r.errors, []);
  for (const id of ids) assert.ok(r.trace.some(t => t.stepId === id && t.status === "ran"), id);
  return r;
}
function prove(r, id, predicate) { assert.ok(predicate(items(r)), id); tested.add(id); }
const sample = sampleInputById.get("wo-two-months");
const baseConfig = configs.find(c => c.solutionId === "sol-workorder-insight");
let base, borrowed;
check("base work-order seed: all nine executors and labelled recurring findings", () => {
  base = run(baseConfig.capabilityIds, sample.text, baseConfig.configValues);
  prove(base,"cap-wo-ingest",xs=>xs.some(x=>x.kind==="count" && x.text.startsWith("16 work orders")));
  prove(base,"cap-summarize",xs=>xs.filter(x=>x.kind==="summary").length===16);
  prove(base,"cap-recurring",xs=>sample.expected.every(e=>xs.some(x=>x.kind==="recurring" && x.text.includes(e.tag) && x.refs.length===e.count)));
  prove(base,"cap-review-queue",xs=>xs.filter(x=>x.kind==="review").length===3);
  prove(base,"cap-approval",xs=>xs.some(x=>x.kind==="control" && x.text.includes("approval required")));
  prove(base,"cap-routing",xs=>xs.some(x=>x.kind==="route" && x.text.includes("planner")));
  prove(base,"cap-notify",xs=>xs.some(x=>x.kind==="notice" && x.text.includes("Daily digest")));
  prove(base,"cap-reports",xs=>xs.some(x=>x.kind==="report" && x.text.includes("16 work orders")));
  prove(base,"cap-exec-digest",xs=>xs.some(x=>x.kind==="digest" && x.text.includes("P-104")));
});
check("base plus borrowed clustering, ranking, safety and follow-up actions", () => {
  borrowed = run([...baseConfig.capabilityIds,"cap-clustering","cap-similarity","cap-safety-signals","cap-action-tracking"], sample.text, baseConfig.configValues);
  prove(borrowed,"cap-clustering",xs=>xs.filter(x=>x.kind==="pattern").length===3);
  prove(borrowed,"cap-similarity",xs=>xs.some(x=>x.kind==="pattern" && x.text.startsWith("#1 Centrifugal pump vibration: 6 reports across 2 sites")));
  prove(borrowed,"cap-safety-signals",xs=>sample.expectedSafetySignals.every(e=>xs.some(x=>x.kind==="safety" && x.refs.includes(e.ref) && x.text.includes(e.signal))));
  prove(borrowed,"cap-action-tracking",xs=>xs.filter(x=>x.kind==="action").length===4 && xs.some(x=>x.text.includes("due 2026-10-16") && x.text.includes("Open")));
  assert.ok(items(borrowed).some(x=>x.kind==="review" && x.text.startsWith("Safety:")));
  const delta = diffOutputs(base.output, borrowed.output);
  // Ranking rewrites pattern output; clustering remains its recorded origin.
  assert.ok(delta.added > 0 && delta.stepsResponsible.includes("cap-similarity"));
  assert.ok(items(borrowed).filter(x=>x.kind==="pattern").every(x=>x.originStepId==="cap-clustering"));
  const repeat = run([...baseConfig.capabilityIds,"cap-clustering","cap-similarity","cap-safety-signals","cap-action-tracking"], sample.text, baseConfig.configValues);
  assert.deepEqual(repeat.output, borrowed.output);
});
check("Pattern Finder seed aliases parse and summarize local text", () => {
  const c = configs.find(c=>c.solutionId==="sol-site-pattern-finder");
  const r = run(c.capabilityIds,sample.text,c.configValues);
  prove(r,"cap-csv-ingest",xs=>xs.some(x=>x.kind==="count" && x.text.startsWith("16 work orders")));
  prove(r,"cap-b-summarize",xs=>xs.filter(x=>x.kind==="summary").length===16);
  assert.equal(r.stats.patterns,3);
});
check("Incident Commander seed: narrative safety flags and extracted commitments", () => {
  const s = sampleInputById.get("incident-note");
  const c = configs.find(c=>c.solutionId==="sol-incident-commander");
  const r = run(c.capabilityIds,s.text,c.configValues);
  prove(r,"cap-incident-actions",xs=>xs.some(x=>x.kind==="action" && /gasket replacement/i.test(x.text)));
  assert.ok(s.expectedSafetySignals.every(e=>items(r).some(x=>x.kind==="safety" && x.refs.includes(e.ref) && x.text.includes(e.signal))));
});
check("Action Tracker seed alone honestly has no recurring input analysis", () => {
  const c = configs.find(c=>c.solutionId==="sol-action-tracker");
  const r = run(c.capabilityIds,sample.text,c.configValues);
  assert.equal(r.stats.actions,0);
  assert.ok(items(r).some(x=>x.text==="No recurring problem to act on yet."));
});
check("compact config, threshold and safety-negative behavior", () => {
  const r = run(baseConfig.capabilityIds,sampleInputById.get("wo-single").text,{"cap-summarize":"Compact","cap-review-queue":"Flag after 5 occurrences"});
  assert.equal(items(r).filter(x=>x.kind==="review").length,0);
  assert.ok(items(r).some(x=>x.kind==="summary" && !x.text.includes(" — ")));
  const n = run(["cap-safety-signals"],"Small leak, no safety impact.");
  assert.ok(items(n).some(x=>x.text==="No wording pointing to a safety consequence."));
});
console.log(JSON.stringify({ checks, tested: [...tested].sort(), base: base.output.headline, borrowed: borrowed.output.headline }));
`;
  await put("demo-source.ts", runner);
  await bundle(join(stage, "demo-source.ts"), join(stage, "demo.mjs"));
  await put("package.json", json({ name: "reuse-workbench-demo-engine", version: "1.0.0", private: true,
    type: "module", engines: { node: ">=20" }, scripts: { demo: "node demo.mjs", test: "node demo.mjs" } }));
  await put("README.md", `# Seed demo engine — not the Workbench application

Run \`node demo.mjs\` with Node 20+; no install, credentials, services or network needed.
The bundled runner runs assertions and prints actual checks and two demo headlines.
It uses only the included synthetic seed notes, local regex/text processing and in-memory objects.
This is NOT a full standalone enterprise app or an export of persisted governance configuration.
There are no live CMMS, identity, notification, planner, approval, audit, retention or action-lifecycle integrations.
In particular, approval is descriptive text, notifications are sentences, and actions are generated Open templates.

engine/ contains unchanged implemented TypeScript. data/catalog*.ts contains unchanged seed catalog
source (including illustrative marketing/evidence claims, not verified production evidence).
configurations/ restricts each of the four seed solution memberships to supported executor IDs;
sourceSolutionId records origin and must not be confused with solution membership.
Action Tracker alone lacks ingestion/finding steps and produces no tracked action; the borrowed flow supplies those prerequisites.
demo-source.ts is the bundled runner source. Rebuilding TypeScript requires esbuild; the included demo.mjs does not.
The type-only @workspace/api-zod import is a Workbench development dependency, erased from the bundle.
reference-ui/ contains reference-only Workbench components: React, UI, API clients, aliases and the surrounding
Workbench application are required; these files do NOT constitute a standalone UI and are not bundled.

manifest.json hashes every other archive file and maps capabilities to exact executor declaration line spans
in engine/steps.ts. It excludes itself to avoid a circular hash. The server's external runtime manifest
also hashes manifest.json and identifies the final ZIP by SHA-256.
Capability limitations and tests describe this code only, not seeded product claims.
Only explicitly allowlisted engine/catalog/UI sources plus generated demo/configuration/metadata files enter this ZIP.
No environment files, uploads, database/customer data or full monorepo are included.

Publisher: manually run node artifacts/api-server/scripts/package-demo-engine.mjs from the Workbench checkout.
It uses existing esbuild, Python 3 stdlib zipfile and private App Storage; never runs at server boot.
ZIP paths/order, timestamps, permissions and stored compression are fixed for byte reproducibility.
SOURCE_DATE_EPOCH optionally fixes createdAt (default 2026-10-01T00:00:00Z).
`);

  const runDemo = (directory) => JSON.parse(execFileSync(process.execPath, ["demo.mjs"], {
    cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH },
  }));
  const verified = runDemo(stage);
  checks.push(...verified.checks);
  const evidence = selected.map((cap) => {
    const mapped = registry.find((r) => r.capabilityId === cap.id);
    const lines = stepsText.split("\n");
    const factory = { readNotes: "noteReader", readCsvNotes: "noteReader", summarize: "summarizer", patternSummarize: "summarizer" }[mapped.symbol];
    const start = lines.findIndex((line) => line.startsWith(factory ? `function ${factory}(` : `const ${mapped.symbol}: StepExecutor = `));
    const end = factory
      ? lines.findIndex((line, i) => i > start && line.startsWith(`const ${mapped.symbol}=`))
      : lines.findIndex((line, i) => i > start && line === "};");
    if (start < 0 || end < start || !limitations[mapped.symbol]) throw new Error(`Unproven executor: ${cap.id}`);
    return { capabilityId: cap.id, solutionId: cap.sourceSolutionId, file: "engine/steps.ts",
      symbol: mapped.symbol, lines: [start + 1, end + 1],
      limitations: [limitations[mapped.symbol]], tested: verified.tested.includes(cap.id) };
  });
  async function fileHashes() {
    const paths = [];
    async function visit(dir, prefix = "") {
      for (const ent of await readdir(dir, { withFileTypes: true })) {
        const path = prefix + ent.name;
        if (ent.isDirectory()) await visit(join(dir, ent.name), path + "/");
        else if (ent.isFile()) paths.push(path);
        else throw new Error("Non-regular package entry rejected.");
      }
    }
    await visit(stage);
    return Promise.all(paths.sort().map(async (path) => ({ path, sha256: hash(await readFile(join(stage, path))) })));
  }
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? 1790812800);
  if (!Number.isFinite(epoch)) throw new Error("Invalid SOURCE_DATE_EPOCH.");
  const createdAt = new Date(epoch * 1000).toISOString();
  const scope = "Implemented local seed demo engine with bundled Node runner; seed executor configurations and reference-only Workbench UI. Not live integrations, persisted governance export or standalone enterprise application.";
  const common = { version: `1.0.0-catalog-${CATALOG_VERSION}`, scope, createdAt,
    capabilities: evidence, checks, configurations };
  await put("manifest.json", json({ ...common, files: await fileHashes() }));
  const zip = join(temporary, "demo-engine.zip");
  const python = process.env.PYTHON ?? "python3";
  const zipCode = `import sys,zipfile,pathlib
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],"w",compression=zipfile.ZIP_STORED) as z:
 for p in sorted(root.rglob("*")):
  if p.is_file():
   i=zipfile.ZipInfo(p.relative_to(root).as_posix(),date_time=(1980,1,1,0,0,0))
   i.create_system=3
   i.external_attr=0o100644<<16
   z.writestr(i,p.read_bytes())
`;
  execFileSync(python, ["-c", zipCode, stage, zip]);
  const bytes = await readFile(zip);
  const sha256 = hash(bytes);
  const secondZip = join(temporary, "reproduced.zip");
  execFileSync(python, ["-c", zipCode, stage, secondZip]);
  if (hash(await readFile(secondZip)) !== sha256) throw new Error("ZIP reproducibility failed.");
  checks.push({ name: "identical ZIP bytes from fixed inputs", passed: true });
  const extracted = join(temporary, "extracted");
  execFileSync(python, ["-c", "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zip, extracted]);
  const extractedResult = runDemo(extracted);
  if (json(extractedResult) !== json(verified)) throw new Error("Extracted runner verification differs.");
  for (const f of await fileHashes()) {
    if (hash(await readFile(join(extracted, f.path))) !== f.sha256) throw new Error("Extracted file hash mismatch.");
  }
  checks.push({ name: "extracted ZIP runs node demo.mjs without install and all file hashes match", passed: true });
  const storageModule = join(temporary, "storage.mjs");
  await build({ entryPoints: [join(api, "src/lib/solution-code-storage.ts")], outfile: storageModule,
    bundle: true, platform: "node", format: "esm", packages: "external", logLevel: "silent" });
  // Resolve the existing SDK relative to this script, not temporary build directories.
  const storageText = await readFile(storageModule, "utf8");
  const { createRequire } = await import("node:module");
  const sdkPath = createRequire(import.meta.url).resolve("@google-cloud/storage");
  await writeFile(storageModule, storageText.replaceAll('"@google-cloud/storage"', JSON.stringify(pathToFileURL(sdkPath).href)));
  const { storedCodePackageFile } = await import(pathToFileURL(storageModule).href);
  const objectPath = `solution-code/${sha256}.zip`;
  const file = storedCodePackageFile(objectPath);
  try {
    await file.save(bytes, { resumable: false, validation: "crc32c", preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "application/zip", cacheControl: "private, no-store",
        metadata: { "custom:aclPolicy": JSON.stringify({ owner: "solution-code-publisher", visibility: "private" }), sha256 } } });
  } catch (error) {
    if (Number(error.code) !== 412) throw new Error("Private code package upload failed (storage configuration or service error).");
  }
  const [downloaded] = await file.download().catch(() => {
    throw new Error("Private code package download verification failed (storage service error).");
  });
  if (hash(downloaded) !== sha256) throw new Error("Stored ZIP failed SHA-256 round-trip verification.");
  checks.push({ name: "private immutable storage upload/download SHA-256 round trip", passed: true });
  const manifest = { packageId: `demo-engine-${sha256}`, ...common, sha256, objectPath, files: await fileHashes(), checks };
  await writeFile(join(api, "src/data/solution-code-manifest.json"), json(manifest));
  console.log(json({ packageId: manifest.packageId, version: manifest.version, sha256, files: manifest.files.length,
    capabilities: evidence.length, tested: evidence.filter((c) => c.tested).length, checks }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
