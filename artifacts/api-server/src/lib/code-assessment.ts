import type { Brief, CodeAssessment, CodeAssessmentMatch, CodeCandidate, CodeRequirementAssessment, LibraryCodePackage } from "@workspace/api-zod";
import { capabilityById, getSolution } from "../data/catalog";

// Deliberately narrow, inspectable intent rules for the first indexed demo engine.
// These are not a general-purpose semantic verifier and never infer code from catalog claims.
const intents: { id: string; pattern: RegExp; partial?: string }[] = [
  { id: "cap-wo-ingest", pattern: /\b(ingest|import|parse|read|load)\b.{0,45}\b(notes?|work.orders?|csv)\b/i },
  { id: "cap-summarize", pattern: /\bsummar(?:y|ies|ize|ise|izing|ization)\b/i },
  { id: "cap-recurring", pattern: /\b(recurring|repeated|repeating|repeat)\b.{0,40}\b(issues?|concerns?|faults?|problems?|patterns?|failures?)\b/i },
  { id: "cap-clustering", pattern: /\b(cluster|group similar)\b|\b(cross.site|multi.site)\b.{0,35}\b(patterns?|issues?|group|analysis)\b|\b(patterns?|issues?|compare)\b.{0,35}\bacross.{0,15}sites?\b/i },
  { id: "cap-similarity", pattern: /\b(rank|ranking|prioriti[sz]e)\b.{0,35}\b(patterns?|issues?|findings?)\b/i },
  { id: "cap-safety-signals", pattern: /\b(safety|hazards?|risk signals?|gas leak)\b/i },
  { id: "cap-review-queue", pattern: /\b(human|supervisor|manual)\b.{0,30}\breview\b|\breview queue\b/i },
  { id: "cap-approval", pattern: /\b(approval|approve|sign.off)\b/i, partial: "The engine marks approval requirements; it does not implement a production approval transaction or identity-backed authorization." },
  { id: "cap-routing", pattern: /\b(rout(?:e|ing)|assign)\b.{0,35}\b(findings?|sites?|teams?|supervisors?)\b/i },
  { id: "cap-action-tracking", pattern: /\b(track|follow.up|next.actions?|suggest.{0,15}actions?|due dates?|action owners?)\b/i, partial: "Generates follow-up action output; it does not persist task lifecycles or update an external task system." },
  { id: "cap-reports", pattern: /\b(weekly report|reporting|report view)\b/i },
  { id: "cap-exec-digest", pattern: /\b(executive digest|leadership digest)\b/i },
  { id: "cap-notify", pattern: /\b(notif(?:y|ication)|alerts?|send.{0,15}digest)\b/i, partial: "Produces notification output only; no email, SMS or message delivery is implemented." },
  { id: "cap-summarize", pattern: /\b(traceab|original|source|work.order)\w*\b.{0,35}\b(links?|references?|ids?|identifiers?)\b/i, partial: "Code retains work-order IDs as references; live source-system hyperlinks and access checks are not implemented." },
];
const unsupported = /\b(real.time|live integration|sap|salesforce|cmms|email|sms|single.sign.on|sso|audit trail|retention|encrypt|write.back|automatic updates?|push updates?|multilingual|languages?|predictive|machine learning|llm)\b/i;
const otherDomain = /\b(invoice|payroll|recruit|candidate|stock trading|insurance claim|patient|medical diagnosis)\b/i;
const maintenance = /\b(work.orders?|maintenance|equipment|pumps?|compressors?|plant|mechanical|inspection)\b/i;
const constraint = /\b(read.only|do not|don['’]t|must not|no|without.{0,15}(updates?|write)|never)\b/i;
const aliases: Record<string, string> = { "cap-summarize": "cap-b-summarize", "cap-wo-ingest": "cap-csv-ingest" };
function implementedBy(base: Set<string>, id: string) {
  return base.has(id) || Boolean(aliases[id] && base.has(aliases[id]!));
}

function analyzeRequirement(text: string, context: string, pkg: LibraryCodePackage) {
  if (otherDomain.test(text) || !maintenance.test(context)) return { evidence: [], restrictions: ["No relevant implementation was established in the indexed maintenance demo package."] };
  const matches = intents.filter(i => i.pattern.test(text));
  const ids = [...new Set(matches.map(i => i.id))];
  const evidence = ids.flatMap(id => {
    const found = pkg.capabilities.find(c => c.capabilityId === id);
    return found ? [found] : [];
  });
  const restrictions = matches.flatMap(i => i.partial ? [i.partial] : []);
  if (unsupported.test(text)) restrictions.push("This requirement includes an integration, control or behavior not established by the local demo executors.");
  if (ids.some(id => !pkg.capabilities.some(c => c.capabilityId === id))) restrictions.push("At least one required element has no indexed source evidence in this package.");
  return { evidence, restrictions };
}

export function assessCode(brief: Brief, pkg: LibraryCodePackage): CodeAssessment {
  const context = [brief.rawText, ...Object.values(brief.fields).map(f => f.value)].join(" ");
  const interpretations = brief.requirements.map(r => analyzeRequirement(r.text, context, pkg));
  const configurations = pkg.configurations.filter(c => {
    const solution = getSolution(c.solutionId);
    return solution?.execution === "live" && solution.status !== "deprecated";
  });
  const classify = (i: number, base: Set<string>): CodeRequirementAssessment["status"] => {
    const a = interpretations[i]!;
    if (constraint.test(brief.requirements[i]!.text)) return "constraint";
    if (!a.evidence.length) return "missing";
    if (a.restrictions.length) return "partial";
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
      note: status === "constraint" ? "Keep this restriction when adding or changing components."
        : status === "missing" ? "Not found in the reviewed code."
        : status === "partial" ? [...new Set(a.restrictions)].join(" ")
        : status === "borrow" ? "Available from another solution; needs integration."
        : "Found in this solution’s code.",
    };
  });
  return {
    briefId: brief.id, package: pkg, bestSolutionId: best?.solutionId ?? null, candidates, requirements,
    limitations: [
      "Assessment is limited to the stored, hashed demo engine package and its seed configurations; it is not a scan of every catalog product or current governed deployment.",
      "Intent mapping uses explicit maintenance-domain rules, not semantic proof. Review source evidence and test real acceptance criteria before relying on coverage.",
      "A passed package check verifies only its named fixture assertion. It does not prove your requirement, production readiness, or a proposed multi-solution integration.",
      "Capabilities without indexed code evidence are unverified, not proven absent from all possible solutions.",
    ],
  };
}
