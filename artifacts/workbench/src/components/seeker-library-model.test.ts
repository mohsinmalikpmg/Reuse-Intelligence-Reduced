import test from "node:test";
import assert from "node:assert/strict";
import type { Capability, Solution, SolutionFamily } from "@workspace/api-client-react";
import { buildEntries, capabilityMatch, effectiveCapIds, orUnknown, readinessOf } from "./seeker-library-model";

const solution = (id: string, extra: Partial<Solution> = {}) => ({
  id, name: id, outcome: "Find source evidence", description: "", businessFunction: "Operations",
  outputType: "Report", capabilityIds: ["base"], kind: "complete_solution", execution: "preview", ...extra,
} as Solution);
const capabilities = ["base", "added"].map((id) => ({ id, name: id, description: `${id} description`, controlType: "optional", evidenceLevel: "strong" } as Capability));
const family = (preferred: Solution) => ({
  businessProblem: { id: "problem", title: "Reporting", description: "Locate audit trails" },
  preferred, covers: [{ capabilityId: "added" }], alternatives: [], consolidating: [],
  approvedConfigurations: [], reusableCapabilities: [],
} as unknown as SolutionFamily);

test("published coverage removes disabled capabilities and includes enabled additions", () => {
  const s = solution("a", { capabilityIds: ["base", "added"], production: { moduleStates: { base: false, added: true } } as Solution["production"] });
  assert.deepEqual(effectiveCapIds(s, capabilities), ["added"]);
});

test("limited and no-evidence optional capabilities default off; locked and configurable stay on", () => {
  const cs = [
    { ...capabilities[0], id: "limited", evidenceLevel: "limited" },
    { ...capabilities[0], id: "none", evidenceLevel: "none" },
    { ...capabilities[0], id: "moderate", evidenceLevel: "moderate" },
    { ...capabilities[0], id: "locked", controlType: "locked", evidenceLevel: "none" },
    { ...capabilities[0], id: "configurable", controlType: "configurable", evidenceLevel: "limited" },
  ] as Capability[];
  const s = solution("optional", { capabilityIds: cs.map((c) => c.id) });
  assert.deepEqual(effectiveCapIds(s, cs), ["moderate", "locked", "configurable"]);
  s.production = { moduleStates: { limited: true, moderate: false, locked: false, added: true } } as Solution["production"];
  assert.deepEqual(effectiveCapIds(s, [...cs, ...capabilities]), ["limited", "locked", "configurable"]);
});

test("reuse discovery is separate from active coverage and disabled optional features are not covered", () => {
  const preferred = solution("preferred");
  const f = family(preferred);
  f.reusableCapabilities = [{
    capability: capabilities[0], tryIn: { solutionId: preferred.id, solutionName: preferred.name },
  }] as SolutionFamily["reusableCapabilities"];
  const [entry] = buildEntries([f], [], capabilities);
  assert.equal(capabilityMatch(entry, "base"), "Available to add");
  assert.equal(capabilityMatch(entry, "added"), "Covered");
  assert.equal(capabilityMatch(entry, "missing"), null);
  assert.ok(entry.text.includes("base description"));
  entry.reusable[0].tryIn = null;
  assert.equal(capabilityMatch(entry, "base"), "Reuse option · not addable yet");
  const [optional] = buildEntries([], [solution("variance")], [{ ...capabilities[0], evidenceLevel: "limited" }]);
  assert.equal(capabilityMatch(optional, "base"), null);
  assert.deepEqual(optional.caps, []);
});

test("preferred coverage uses family production coverage and indexes problem description", () => {
  const s = solution("preferred");
  const [e] = buildEntries([family(s)], [s], capabilities);
  assert.deepEqual(e.caps.map((c) => c.id), ["added"]);
  assert.ok(e.text.includes("locate audit trails"));
  assert.equal(e.role, "preferred");
});

test("alternatives, consolidation and standalone products remain discoverable without duplicates", () => {
  const preferred = solution("preferred"), alt = solution("alternative"), old = solution("old"), standalone = solution("standalone");
  const f = { ...family(preferred), alternatives: [alt], consolidating: [old] };
  const entries = buildEntries([f], [preferred, alt, old, standalone], capabilities);
  assert.deepEqual(entries.map((e) => e.s.id), ["preferred", "alternative", "old", "standalone"]);
  assert.deepEqual(entries.map((e) => e.role), ["preferred", "alternative", "consolidating", "module"]);
});

test("preview readiness is never inferred from evidence or maturity; unknown ownership is explicit", () => {
  assert.equal(readinessOf(solution("p", { status: "certified", evidenceLevel: "strong" })), "preview");
  assert.equal(readinessOf(solution("l", { execution: "live" })), "live");
  assert.equal(orUnknown("Unassigned"), "Unknown");
  assert.equal(orUnknown(" "), "Unknown");
});
