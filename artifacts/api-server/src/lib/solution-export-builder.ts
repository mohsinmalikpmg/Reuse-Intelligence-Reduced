import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import yauzl from "yauzl";
import type { Capability } from "@workspace/api-zod";
import { capabilities as catalogCapabilities, catalogSolutions } from "../data/catalog";
import {
  runtimeTemplate, serverTemplate, htmlTemplate, testTemplate, httpTestTemplate,
} from "./solution-export-templates";

/** Capabilities are the active selection only; configurable defaults must already be resolved. */
export interface SolutionExportSnapshot {
  caseId: string;
  title: string;
  baseSolutionId: string;
  parentVersion: string;
  capabilities: Capability[];
  configValues: Record<string, string>;
  unresolvedRequests: unknown[];
  requirements: unknown[];
}

export interface SolutionExportCheck { name: string; passed: boolean; detail: string }
export interface SolutionExportResult {
  bytes: Buffer;
  sha256: string;
  checks: SolutionExportCheck[];
  gaps: string[];
  files: { path: string; sha256: string }[];
}

/** Retains the exact failed artifact and evidence; callers must not mark it verified or runnable. */
export class SolutionExportBuildError extends Error {
  constructor(message: string, public readonly sha256: string | undefined,
    public readonly checks: SolutionExportCheck[], public readonly bytes?: Buffer,
    public readonly gaps: string[] = [], public readonly files: SolutionExportResult["files"] = []) {
    super(message);
    this.name = "SolutionExportBuildError";
  }
}

const sourcePaths = [
  "src/engine/run.ts", "src/engine/steps.ts", "src/engine/types.ts", "src/engine/workorders.ts",
  "src/lib/configuration.ts", "src/data/catalog.ts", "src/data/catalog-enterprise.ts",
  "src/lib/solution-export-builder.ts", "src/lib/solution-export-templates.ts",
] as const;
const engineNames = ["run", "steps", "types", "workorders"] as const;
const demoSolutions = new Set([
  "sol-workorder-insight", "sol-site-pattern-finder", "sol-action-tracker",
  "sol-procedure-finder", "sol-sop-chat", "sol-incident-commander", "sol-handover-notes",
]);
const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const canonical = (id: string) => ({ "cap-b-summarize": "cap-summarize", "cap-csv-ingest": "cap-wo-ingest" } as Record<string, string>)[id] ?? id;

/** Authorized case prose only, never arbitrary unknown payloads, code, attachments or environment values. */
function caseProse(value: unknown): Record<string, string | null> {
  if (typeof value === "string") {
    if (value.length > 10000) throw new Error("Case text exceeds export limit.");
    return { text: value };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { text: "Unrecognized case item; review source case." };
  const fields: Record<string, string | null> = {};
  for (const key of ["id", "need", "missing", "text", "afterStepId", "createdAt"]) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "string") {
      if (field.length > 10000) throw new Error("Case text exceeds export limit.");
      fields[key] = field;
    } else if (field === null && key === "afterStepId") fields[key] = null;
  }
  return Object.keys(fields).length ? fields : { text: "Unrecognized case item; review source case." };
}

function stableJson(value: unknown): string {
  function sorted(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, val]) => [k, sorted(val)]));
    return v;
  }
  return JSON.stringify(sorted(value), null, 2) + "\n";
}

async function trustedInputs() {
  // The server is launched either from workspace root or artifacts/api-server (dev and dist).
  const candidates = [resolve(process.cwd(), "artifacts/api-server"), process.cwd()];
  let root: string | undefined;
  for (const candidate of candidates) {
    try { await access(join(candidate, "src/lib/solution-export-builder.ts")); root = candidate; break; } catch { /* try next known source layout */ }
  }
  if (!root) throw new Error("Trusted export sources are unavailable; deploy the API src directory alongside dist.");
  const files = new Map<string, Buffer>();
  for (const path of sourcePaths) files.set(path, await readFile(join(root, path)));
  const require = createRequire(join(root, "package.json"));
  const esbuildRoot = resolve(dirname(require.resolve("esbuild")), "..");
  const esbuild = join(esbuildRoot, "bin/esbuild");
  files.set("toolchain/esbuild-package.json", await readFile(join(esbuildRoot, "package.json")));
  // Include exact compiler identity; no uploads, directories, ambient environment or credentials are read.
  const compilerHash = hash(await readFile(esbuild));
  const fingerprint = hash(stableJson({ sources: [...files].map(([path, data]) => ({ path, sha256: hash(data) })), compilerHash }));
  return { files, esbuild, fingerprint, compilerHash };
}

export async function getExportSourceFingerprint(): Promise<string> {
  return (await trustedInputs()).fingerprint;
}

/** Bounded, no shell, isolated process group, no inherited environment or secret-bearing NODE_OPTIONS. */
export async function subprocess(command: string, args: string[], cwd: string, timeoutMs = 20_000): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd, NODE_ENV: "production", TZ: "UTC", LANG: "C", GOMAXPROCS: "2", GOMEMLIMIT: "128MiB", PORT: "4173", BASE_PATH: "./" },
    });
    let output = "", size = 0, failure: Error | undefined;
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* process already exited */ } };
    const timer = setTimeout(() => { failure = new Error("Export subprocess exceeded time limit."); kill(); }, timeoutMs);
    const capture = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 128 * 1024) { failure = new Error("Export subprocess exceeded output limit."); kill(); }
      else output += chunk.toString("utf8");
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer); kill();
      if (failure || code !== 0) reject(new Error(`${failure?.message ?? `Export subprocess exited ${code}`}\n${output}`));
      else resolveResult(output.trim());
    });
  });
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP STORE with sorted entries, UTF-8 names, fixed DOS epoch and regular 0644 modes. */
export function deterministicZip(files: Map<string, Buffer>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [path, body] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) {
    const name = Buffer.from(path), crc = crc32(body), l = Buffer.alloc(30), c = Buffer.alloc(46);
    l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x800, 6); l.writeUInt16LE(33, 12);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(body.length, 18); l.writeUInt32LE(body.length, 22); l.writeUInt16LE(name.length, 26);
    local.push(l, name, body);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(body.length, 24); c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(0x81a40000, 38); c.writeUInt32LE(offset, 42);
    central.push(c, name); offset += l.length + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** Extract the artifact bytes, not the staging directory, and verify every file against the manifest. */
export async function extract(bytes: Buffer, destination: string, expected: Map<string, Buffer>) {
  await new Promise<void>((resolveExtract, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error("Cannot open generated ZIP")); return; }
      const seen = new Set<string>();
      const fail = (error: Error) => { zip.close(); reject(error); };
      zip.on("error", fail);
      zip.on("end", () => seen.size === expected.size ? resolveExtract() : reject(new Error("Missing exported files")));
      zip.on("entry", entry => {
        if (!expected.has(entry.fileName) || seen.has(entry.fileName) || entry.uncompressedSize > 2_000_000) { fail(new Error("Unexpected exported entry")); return; }
        seen.add(entry.fileName);
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) { fail(error ?? new Error("Cannot read exported entry")); return; }
          const chunks: Buffer[] = [];
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            void (async () => {
              const body = Buffer.concat(chunks);
              if (hash(body) !== hash(expected.get(entry.fileName)!)) throw new Error(`Export hash mismatch: ${entry.fileName}`);
              const path = join(destination, entry.fileName);
              await mkdir(dirname(path), { recursive: true }); await writeFile(path, body);
              zip.readEntry();
            })().catch(fail);
          });
        });
      });
      zip.readEntry();
    });
  });
}

let activeBuilds = 0;

export async function buildSolutionExport(snapshot: SolutionExportSnapshot): Promise<SolutionExportResult> {
  if (activeBuilds >= 2) throw new SolutionExportBuildError("Export builder busy; retry later.", undefined, []);
  activeBuilds++;
  let temp: string | undefined, bytes: Buffer | undefined, sha256: string | undefined;
  const checks: SolutionExportCheck[] = [], gaps: string[] = [];
  let files: SolutionExportResult["files"] = [];
  let phase = "snapshot-validation";
  try {
    for (const key of ["caseId", "title", "baseSolutionId", "parentVersion"] as const) {
      if (typeof snapshot[key] !== "string" || !snapshot[key].trim() || snapshot[key].length > 500) throw new Error(`Invalid ${key}`);
    }
    if (!demoSolutions.has(snapshot.baseSolutionId) || !catalogSolutions.some(s => s.id === snapshot.baseSolutionId)) throw new Error("No trusted executable demo engine for this base solution (finance and uploaded prototypes are not supported).");
    if (!Array.isArray(snapshot.capabilities) || !snapshot.capabilities.length || snapshot.capabilities.length > 100 ||
      !Array.isArray(snapshot.requirements) || !Array.isArray(snapshot.unresolvedRequests) ||
      snapshot.requirements.length > 1000 || snapshot.unresolvedRequests.length > 1000) throw new Error("Invalid or oversized snapshot selection.");
    const selected = snapshot.capabilities.map(cap => {
      const trusted = catalogCapabilities.find(c => c.id === cap.id && demoSolutions.has(c.sourceSolutionId));
      if (!trusted) throw new Error(`No trusted demo capability: ${String(cap.id).slice(0, 100)}`);
      return trusted;
    }).sort((a, b) => a.id < b.id ? -1 : 1);
    const ids = new Set(selected.map(c => c.id)), canonicalIds = new Set(selected.map(c => canonical(c.id)));
    if (ids.size !== selected.length || canonicalIds.size !== selected.length) throw new Error("Duplicate capability or equivalent executor aliases selected.");
    for (const cap of selected) {
      if (cap.dependsOn.some(id => !canonicalIds.has(canonical(id)))) throw new Error(`Missing selected dependency for ${cap.id}`);
      if (cap.incompatibleWith.some(id => ids.has(id))) throw new Error(`Incompatible selection for ${cap.id}`);
    }
    const configValues: Record<string, string> = {};
    for (const [id, value] of Object.entries(snapshot.configValues)) {
      const cap = selected.find(c => c.id === id);
      if (!cap || cap.controlType !== "configurable" || typeof value !== "string" || !cap.options?.includes(value)) throw new Error(`Unapproved configuration for ${id.slice(0, 100)}`);
      configValues[id] = value;
    }
    for (const cap of selected.filter(c => c.controlType === "configurable")) {
      if (!configValues[cap.id]) throw new Error(`Configurable default not resolved for ${cap.id}`);
      // Summarize aliases use the canonical executor's configuration key.
      configValues[canonical(cap.id)] = configValues[cap.id]!;
    }
    // Read executor identity from the allowlisted trusted source, never from uploaded capability metadata.
    const inputs = await trustedInputs();
    const executorIds = new Set([...inputs.files.get("src/engine/steps.ts")!.toString().matchAll(/capabilityId: "(cap-[^"]+)"/g)].map(m => m[1]));
    if (!selected.some(c => executorIds.has(c.id))) throw new Error("Selection has no trusted executable steps.");
    for (const cap of selected.filter(c => !executorIds.has(c.id))) gaps.push(`${cap.name} (${cap.id}) is catalog metadata only; no runtime control is implemented.`);
    gaps.push("Standalone demo only: enterprise identity, durable audit/retention, external notifications, data connectors and production security are not implemented.");
    if (ids.has("cap-notify")) gaps.push("Notifications produce preview text only; no messages are sent.");
    const unresolvedRequests = snapshot.unresolvedRequests.map(caseProse);
    const requirements = snapshot.requirements.map(caseProse);
    for (const [i, request] of unresolvedRequests.entries()) {
      gaps.push(`Unresolved request ${i + 1}: ${request.need ?? request.text ?? request.id ?? "Review source case"} — not implemented and not executed.${request.missing ? ` Missing: ${request.missing}` : ""}`);
    }
    if (requirements.length) gaps.push(`${requirements.length} case requirements included as unverified case prose; passing demo fixtures does not establish requirement acceptance.`);
    checks.push({ name: phase, passed: true, detail: "Active IDs resolved from trusted demo catalog; approved resolved options, aliases, dependencies and incompatibilities validated. Only allowlisted case prose retained; no uploads or arbitrary payloads." });
    temp = await mkdtemp(join(tmpdir(), "solution-export-"));
    const stage = join(temp, "stage");
    await mkdir(join(stage, "src/engine"), { recursive: true });
    const content = new Map<string, Buffer>();
    const add = (path: string, text: string | Buffer) => content.set(path, Buffer.isBuffer(text) ? text : Buffer.from(text));
    for (const name of engineNames) {
      const source = inputs.files.get(`src/engine/${name}.ts`)!;
      add(`source/engine/${name}.ts`, source);
      await writeFile(join(stage, `src/engine/${name}.ts`), source);
    }
    phase = "trusted-engine-compilation";
    await subprocess(inputs.esbuild, [...engineNames.map(name => `src/engine/${name}.ts`), "--outdir=compiled", "--platform=node", "--format=esm", "--target=node20", "--log-level=error"], stage);
    for (const name of engineNames) {
      const compiled = (await readFile(join(stage, `compiled/${name}.js`), "utf8")).replace(/from "(\.\/[^"]+?)(?<!\.js)"/g, 'from "$1.js"');
      add(`src/engine/${name}.js`, compiled);
    }
    checks.push({ name: phase, passed: true, detail: "Exact allowlisted TypeScript engines compiled with the installed pinned esbuild; runtime dependencies: Node built-ins only." });
    // Configuration implementation is preserved as source evidence, not executed with its host DB dependencies.
    add("source/reference/configuration.ts", inputs.files.get("src/lib/configuration.ts")!);
    add("src/runtime.js", runtimeTemplate); add("src/server.js", serverTemplate);
    add("public/index.html", htmlTemplate); add("test/workflow.test.mjs", testTemplate);
    add("scripts/verify-http.mjs", httpTestTemplate);
    add("configuration.json", stableJson({
      caseId: snapshot.caseId, title: snapshot.title, baseSolutionId: snapshot.baseSolutionId, parentVersion: snapshot.parentVersion,
      capabilities: selected.map(c => ({ id: c.id, name: c.name, workflowStep: c.workflowStep, sourceSolutionId: c.sourceSolutionId, version: c.version })),
      configValues, gaps, requirements, unresolvedRequests,
      requirementCount: snapshot.requirements.length, unresolvedRequestCount: snapshot.unresolvedRequests.length,
    }));
    // Sample text is sourced only from the trusted engine module, not case uploads.
    const sampleModule = await import("../engine/workorders");
    const samples = sampleModule.sampleInputs.filter(s => s.solutionIds.includes(snapshot.baseSolutionId) ||
      selected.some(c => s.solutionIds.includes(c.sourceSolutionId)));
    if (!samples.length) throw new Error("No trusted sample fixtures for selection.");
    add("samples.json", stableJson(samples.map(s => ({ id: s.id, name: s.name, text: s.text }))));
    add("package.json", stableJson({
      name: "standalone-demo-solution", version: "1.0.0", private: true, type: "module",
      engines: { node: ">=20" }, dependencies: {},
      scripts: { start: "node src/server.js", test: "node --test test/workflow.test.mjs", "test:http": "node scripts/verify-http.mjs" },
    }));
    add(".replit", 'run = "npm start"\n');
    add("README.txt", [
      "Standalone trusted demo workflow", "", "Requires Node.js >=20. No npm install or external runtime dependencies.",
      "Start: npm start (uses PORT, default 3000). Open the root URL.",
      "Test: npm test && npm run test:http", "",
      "Do not expose publicly or use sensitive data: no authentication or durable storage.",
      "Only selected active trusted catalog executors run. Source TypeScript and configuration reference are included.",
      "Configuration JSON contains the resolved selected options. Runtime wiring is src/runtime.js.",
      "Requirements and unresolved requests are NOT implemented by exporting. Authorized case prose is plain JSON only, never code; uploaded files and arbitrary payload fields are excluded.",
      "Source hashes and compiler identity are in source-manifest.json; files.sha256 covers all other archive files.",
      ...gaps,
    ].join("\n") + "\n");
    add("source-manifest.json", stableJson({
      sourceFingerprint: inputs.fingerprint,
      sources: [...inputs.files].map(([path, body]) => ({ path, sha256: hash(body) })),
      compilerSha256: inputs.compilerHash,
      selectedCapabilities: selected.map(c => ({ id: c.id, sourceSolutionId: c.sourceSolutionId, version: c.version, executable: executorIds.has(c.id) })),
      requiredEnvironmentVariables: [],
      optionalEnvironmentVariables: ["PORT"],
      notes: "Hashes identify allowlisted host source inputs. source/reference/configuration.ts is reference only; no host services are needed at runtime.",
    }));
    add("files.sha256", [...content].sort(([a], [b]) => a < b ? -1 : 1).map(([path, body]) => `${hash(body)}  ${path}`).join("\n") + "\n");
    files = [...content].sort(([a], [b]) => a < b ? -1 : 1).map(([path, body]) => ({ path, sha256: hash(body) }));
    bytes = deterministicZip(content); sha256 = hash(bytes);
    if (bytes.length > 5_000_000) throw new Error("Generated archive exceeds size limit.");
    const clean = join(temp, "extracted"); await mkdir(clean);
    phase = "archive-extraction";
    await extract(bytes, clean, content);
    checks.push({ name: phase, passed: true, detail: "Generated ZIP extracted into a fresh temporary directory and every file hash verified." });
    for (const [name, args] of [
      ["exported-tests", ["--max-old-space-size=128", "--test", "test/workflow.test.mjs"]],
      ["exported-startup-http", ["--max-old-space-size=128", "scripts/verify-http.mjs"]],
    ] as const) {
      phase = name;
      const detail = await subprocess(process.execPath, [...args], clean);
      checks.push({ name, passed: true, detail });
    }
    return { bytes, sha256, checks, gaps, files };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({ name: phase, passed: false, detail: message.slice(0, 16000) });
    throw new SolutionExportBuildError(`Solution export failed (${phase}): ${message.slice(0, 1000)}`, sha256, checks, bytes, gaps, files);
  } finally {
    activeBuilds--;
    if (temp) await rm(temp, { recursive: true, force: true });
  }
}
