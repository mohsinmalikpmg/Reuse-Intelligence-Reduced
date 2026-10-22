import type { Brief, CodeAssessment, CodeAssessmentMatch, CodeCandidate, CodeRequirementAssessment, LibraryCodePackage } from "@workspace/api-zod";
import { capabilityById, getSolution } from "../data/catalog";
import { analyze, AnalysisError } from "./ai-analysis";
import { createHash } from "node:crypto";
import { assessmentSource, briefEvidence, groundingInstructions, mappingShape, provenanceLabel, requirementMappingSchema } from "./assessment-evidence";

const aliases: Record<string, string> = { "cap-summarize": "cap-b-summarize", "cap-wo-ingest": "cap-csv-ingest" };
function implementedBy(base: Set<string>, id: string) {
  return base.has(id) || Boolean(aliases[id] && base.has(aliases[id]!));
}

export async function assessCode(brief: Brief, pkg: LibraryCodePackage, options: { force?: boolean; analyzer?: typeof analyze } = {}): Promise<CodeAssessment> {
  const source = await assessmentSource("artifacts/api-server/src/engine/steps.ts");
  if (pkg.files.find(f => f.path === "engine/steps.ts")?.sha256 !== createHash("sha256").update(source).digest("hex")) {
    throw new AnalysisError("The indexed source package no longer matches the reviewed engine. Refresh the package before assessing code.", 409);
  }
  const result = await (options.analyzer ?? analyze)({
    private: true, purpose: "code-assessment", promptVersion: "code-evidence-v1", force: options.force,
    instructions: `${groundingInstructions} Review actual source plus the indexed manifest, including each capability's limitations. Map each requirement to the minimal relevant indexed implementation. Mark complete only when the whole positive requirement is supported by source; otherwise list unmet portions. Do not infer task persistence, identity controls, delivery, semantic clustering or ML from output-generating demo code. Return JSON exactly: ${mappingShape}`,
    input: { brief: briefEvidence(brief), package: pkg, source: { file: "engine/steps.ts", text: source } },
    schema: requirementMappingSchema(brief.requirements.map(r => r.id), pkg.capabilities.map(c => c.capabilityId)),
  });
  const interpretations = brief.requirements.map(r => {
    const mapped = result.data.requirements.find(m => m.id === r.id)!;
    return { ...mapped, evidence: pkg.capabilities.filter(c => mapped.capabilityIds.includes(c.capabilityId)), restrictions: mapped.limitations };
  });
  const configurations = pkg.configurations.filter(c => {
    const solution = getSolution(c.solutionId);
    return solution?.execution === "live" && solution.status !== "deprecated";
  });
  const classify = (i: number, base: Set<string>): CodeRequirementAssessment["status"] => {
    const a = interpretations[i]!;
    if (a.constraint) return "constraint";
    if (!a.evidence.length) return "missing";
    if (!a.complete || a.restrictions.length) return "partial";
    return a.evidence.every(e => implementedBy(base, e.capabilityId)) ? "covered" : "borrow";
  };
  const candidates: CodeCandidate[] = configurations.map(config => {
    const base = new Set(config.capabilityIds);
    const counts = { covered: 0, borrowable: 0, partial: 0, missing: 0 };
    let weightedCoverage = 0;
    brief.requirements.forEach((_, i) => {
      const status = classify(i, base);
      if (status === "constraint") return;
      counts[status === "borrow" ? "borrowable" : status]++;
      const weight = brief.requirements.length - i;
      // Prefer existing base elements over importing modules; incomplete behavior gets no
      // full-coverage credit. This is an ordinal decision aid, never a success probability.
      const inBase = interpretations[i]!.evidence.filter(e => implementedBy(base, e.capabilityId)).length;
      weightedCoverage += weight * (status === "covered" ? 1 : status === "borrow" ? 0.2 : status === "partial" && inBase ? 0.1 : 0);
    });
    return { solutionId: config.solutionId, name: getSolution(config.solutionId)!.name, ...counts, weightedCoverage: Math.round(weightedCoverage * 100) / 100 };
  }).sort((a, b) => b.weightedCoverage - a.weightedCoverage || b.covered - a.covered || a.solutionId.localeCompare(b.solutionId));
  const best = candidates[0]?.weightedCoverage ? candidates[0]! : null;
  const base = new Set(configurations.find(c => c.solutionId === best?.solutionId)?.capabilityIds ?? []);
  const requirements: CodeRequirementAssessment[] = brief.requirements.map((r, i) => {
    const a = interpretations[i]!;
    const status = classify(i, base);
    const matches: CodeAssessmentMatch[] = a.evidence.map(original => {
      const alias = aliases[original.capabilityId];
      const e = alias && base.has(alias) ? pkg.capabilities.find(c => c.capabilityId === alias) ?? original : original;
      const cap = capabilityById.get(e.capabilityId);
      const deps = cap?.dependsOn ?? [];
      const conflicts = cap?.incompatibleWith ?? [];
      const borrowed = !base.has(e.capabilityId);
      return {
        capabilityId: e.capabilityId, capabilityName: cap?.name ?? e.capabilityId,
        solutionId: e.solutionId, solutionName: getSolution(e.solutionId)?.name ?? e.solutionId, evidence: e,
        integration: borrowed
          ? `Needs integration. Requires ${deps.length ? deps.map(id => capabilityById.get(id)?.name ?? id).join(", ") : "work-order input"}.${conflicts.length ? ` Conflicts with: ${conflicts.map(id => capabilityById.get(id)?.name ?? id).join(", ")}.` : ""}`
          : "Included in this configuration.",
      };
    });
    return {
      id: r.id, text: r.text, priority: i + 1, status, matches,
      note: `AI-inferred source mapping: ${a.reason}${a.restrictions.length ? ` Limitations: ${[...new Set(a.restrictions)].join(" ")}` : ""} ${status === "borrow" ? "Requires integration and acceptance testing." : status === "constraint" ? "Preserve this restriction." : "Not a requirement-level test result."}`,
    };
  });
  return {
    briefId: brief.id, package: pkg, bestSolutionId: best?.solutionId ?? null, candidates, requirements,
    limitations: [
      "Assessment is limited to the stored, hashed demo engine package and its seed configurations; it is not a scan of every catalog product or current governed deployment.",
      provenanceLabel(result.provenance),
      "Coverage and weighted ranking are AI-inferred source mappings and ordinal decision aids, not measured success rates or execution proof.",
      "A passed package check verifies only its named fixture assertion. It does not prove your requirement, production readiness, or a proposed multi-solution integration.",
      "Capabilities without indexed code evidence are unverified, not proven absent from all possible solutions.",
    ],
  };
}
