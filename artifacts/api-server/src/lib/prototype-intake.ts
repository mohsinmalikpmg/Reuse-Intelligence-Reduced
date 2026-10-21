/**
 * "I have a prototype": decompose the pasted outputs into components, run the same problem through an existing
 * product when one can consume the input, and say where the prototype fits. Deterministic and rule-based: the
 * reuse-fit scorer does the matching, the engine's own section shapes anchor it, and the only real output on the
 * page is the existing product's run. A submitted output is a claim by the person who built the prototype.
 */
import type {
  Capability,
  PrototypeAnalysis,
  PrototypeComparison,
  PrototypeComparisonLine,
  PrototypeComponent,
  PrototypeComponentInput,
  PrototypeIntake,
  PrototypeVerdict,
  Run,
  Solution,
} from "@workspace/api-zod";
import { capabilities, getCapability, getSolution, solutionCapabilities, solutions } from "../data/catalog";
import { executeWorkflow } from "../engine/run";
import { sampleInputsFor } from "../engine/workorders";
import { candidatesFor, freshContext, moduleBlockedReason } from "./configuration";
import { IMPROVE_AT, inferWorkflowSteps, knownShare, scoreCapability, terms } from "./reuse-check";
import { adHocRun, productionCapabilities } from "./workbench";

// ---------- sections ----------

export interface Section {
  exampleIndex: number;
  title: string;
  items: string[];
}

const BULLET = /^\s*(?:[-*•▪◦]|\d+[.)]|[a-z][.)]|\[[ x]\])\s+/i;

function cleanLine(line: string): string {
  return line.replace(BULLET, "").replace(/^\*\*|\*\*$/g, "").trim();
}

function isHeading(raw: string, next: string | undefined): boolean {
  const line = raw.trim();
  if (!line || BULLET.test(line)) return false;
  if (/^#{1,4}\s+\S/.test(line)) return true;
  if (/^\*\*[^*]{2,70}\*\*:?$/.test(line)) return true;
  if (line.length <= 70 && /:$/.test(line)) return true;
  if (line.length <= 48 && line === line.toUpperCase() && /[A-Z]/.test(line)) return true;
  // A short line without sentence punctuation, followed by something, reads as a title.
  return line.length <= 48 && !/[.!?;,]/.test(line) && line.split(/\s+/).length <= 6 && next !== undefined && /^[A-Z]/.test(line);
}

function headingText(raw: string): string {
  return raw.trim().replace(/^#{1,4}\s+/, "").replace(/^\*\*|\*\*:?$/g, "").replace(/:$/, "").trim();
}

/** Split a pasted output into titled sections of lines. Without any heading the whole output is one "Output" section. */
export function splitSections(output: string, exampleIndex: number): Section[] {
  const lines = output.split(/\r?\n/).map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
  const sections: Section[] = [];
  let current: Section | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (isHeading(line, lines[i + 1])) {
      current = { exampleIndex, title: headingText(line), items: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { exampleIndex, title: "Output", items: [] };
      sections.push(current);
    }
    const text = cleanLine(line);
    if (text) current.items.push(text);
  }
  return sections.filter((s) => s.items.length > 0 || s.title !== "Output");
}

// ---------- the engine's own output shapes ----------

interface Shape {
  stepId: string;
  title: string;
  tokens: Set<string>;
  /** Words the step adds that were not in its input: its own vocabulary ("recurring", "owner", "due"), not echoed content. */
  distinct: Set<string>;
  /** One token set per line the step wrote, for line-level "looks like a line this step writes" checks. */
  lines: { tokens: Set<string>; distinct: Set<string>; tags: Set<string> }[];
  /** Ingest steps echo the input back, so their lines look like everything; they only match by title. */
  echoesInput: boolean;
}

let shapesCache: Shape[] | null = null;

/**
 * What each executable step actually produces: section titles and the words in its lines, taken from a run of every
 * live product on its sample input with all of its steps switched on. Computed once; the engine is deterministic.
 */
function engineShapes(): Shape[] {
  if (shapesCache) return shapesCache;
  const byStep = new Map<string, Shape>();
  for (const s of solutions.filter((x) => x.execution === "live" && !x.origin)) {
    const sample = [...sampleInputsFor(s.id)].sort((a, b) => b.noteCount - a.noteCount)[0];
    if (!sample) continue;
    const { configValues } = productionCapabilities(s);
    // The whole family's steps at once, so a step whose product has no ingest of its own (Action Tracker) still
    // produces real lines downstream of the preferred product's findings.
    const family = new Map<string, Capability>();
    for (const cap of solutionCapabilities(s)) family.set(cap.id, cap);
    for (const id of candidatesFor(s)) for (const cap of solutionCapabilities(getSolution(id)!)) family.set(cap.id, cap);
    const result = executeWorkflow([...family.values()], configValues, sample.text);
    const inputTokens = new Set(terms(sample.text));
    for (const section of result.output.sections) {
      const shape = byStep.get(section.stepId) ?? { stepId: section.stepId, title: section.title, tokens: new Set<string>(), distinct: new Set<string>(), lines: [], echoesInput: getCapability(section.stepId)?.workflowStep === "Ingest" };
      for (const t of terms(section.title)) shape.tokens.add(t);
      for (const it of section.items) {
        const full = `${it.text} ${it.detail ?? ""}`;
        const tokens = new Set(terms(full));
        const distinct = new Set([...tokens].filter((t) => !inputTokens.has(t) && !/^\d+$/.test(t)));
        for (const t of tokens) shape.tokens.add(t);
        for (const t of distinct) shape.distinct.add(t);
        shape.lines.push({ tokens, distinct, tags: tagsOf(full) });
      }
      byStep.set(section.stepId, shape);
    }
  }
  shapesCache = [...byStep.values()];
  return shapesCache;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// ---------- matching a section to a capability ----------

interface SectionMatch {
  capability: Capability;
  source: Solution | undefined;
  score: number;
  how: string;
}

/** Catalogue capabilities only: a prototype's components are matched to the library, never to other prototypes. */
const libraryCapabilities = (): Capability[] => capabilities.filter((c) => !getSolution(c.sourceSolutionId)?.origin);

function matchSection(section: Section): SectionMatch | null {
  const need = [section.title, ...section.items.slice(0, 6)].join(". ");
  const wanted = inferWorkflowSteps(need);
  // When the catalogue knows few of the section's words, a scorer-only match rests on generic words; only a shape match counts then.
  const familiar = knownShare(need) >= 0.4;
  const sectionTokens = new Set(terms(need));
  const titleNorm = norm(section.title);
  const shapes = engineShapes();
  const scored = libraryCapabilities()
    .map((cap) => {
      const base = scoreCapability(need, cap, null, wanted);
      const shape = shapes.find((sh) => sh.stepId === cap.id);
      const sameTitle = !!shape && norm(shape.title) === titleNorm;
      // Share of the section's words that are this step's own vocabulary (content words echoed from the input do not count).
      let overlap = 0;
      if (shape && sectionTokens.size) {
        let hit = 0;
        for (const t of sectionTokens) if (shape.distinct.has(t)) hit += 1;
        overlap = hit / sectionTokens.size;
      }
      // Line level: how many of the section's lines look like a line this step actually wrote on sample data,
      // i.e. use at least one word of the step's own vocabulary and share two or more words with one of its lines.
      let lineHits = 0;
      if (shape && !shape.echoesInput && section.items.length) {
        for (const item of section.items) {
          const tokens = terms(item);
          const tags = tagsOf(item);
          const ownWord = tokens.some((t) => shape.distinct.has(t));
          if (ownWord && shape.lines.some((l) => { const shared = tokens.filter((t) => l.tokens.has(t)).length; return shared >= 2 || (shared >= 1 && [...tags].some((t) => l.tags.has(t))); })) lineHits += 1;
        }
      }
      const lineShare = section.items.length ? lineHits / section.items.length : 0;
      // The engine's own shape is the strongest signal: same section title, lines that look like the step's lines,
      // or most of the section's words being words this step writes. The scorer's semantic fit carries the rest.
      let score = base.score;
      let how = `reuse-fit ${base.score}`;
      let shapeMatch = true;
      if (sameTitle) {
        score = Math.max(score, 88);
        how = `the same section ${cap.sourceSolutionName} produces ("${shape!.title}")`;
      } else if (lineShare >= 0.33 && ((lineHits >= 2 && lineShare >= 0.67) || base.dimensions.problemFit > 0 || wanted.includes(cap.workflowStep))) {
        // Lines alone are not enough unless most of them match: the section must also read as the same kind of
        // work (semantic fit, or the workflow step its words imply).
        score = Math.max(score, Math.min(84, Math.round(50 + lineShare * 34)));
        how = `${lineHits} of ${section.items.length} of its lines look like lines ${cap.name} writes`;
      } else if (overlap >= 0.2 && base.dimensions.problemFit > 0) {
        score = Math.max(score, Math.min(86, Math.round(55 + overlap * 60)));
        how = `${Math.round(overlap * 100)}% of its words are words only ${cap.name} writes`;
      } else {
        shapeMatch = false;
      }
      return { capability: cap, source: base.source, score, how, fit: base.dimensions.problemFit, overlap, lineShare, shapeMatch };
    })
    // Without a shape match the scorer alone decides, and over a small catalogue it inflates shared generic words;
    // ask for a real share of the section's words in the capability's description before calling it a match.
    .filter((c) => c.shapeMatch || (familiar && c.fit >= 25))
    .sort((a, b) => b.score - a.score || b.fit - a.fit || b.lineShare - a.lineShare);
  const best = scored[0];
  if (!best || best.score < 45) return null;
  return { capability: best.capability, source: best.source, score: best.score, how: best.how };
}

function titleCase(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

interface Proposed {
  id: string;
  name: string;
  description: string;
  sections: Section[];
  match: SectionMatch | null;
}

/** Group matched sections by capability; unmatched sections group by title. One proposed component per group. */
function proposeComponents(sections: Section[]): Proposed[] {
  const groups = new Map<string, Proposed>();
  let n = 0;
  for (const section of sections) {
    const match = matchSection(section);
    const key = match ? `cap:${match.capability.id}` : `title:${norm(section.title)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.sections.push(section);
      if (match && existing.match && match.score > existing.match.score) existing.match = match;
      continue;
    }
    n += 1;
    const first = section.items[0] ?? "";
    groups.set(key, {
      id: `c${n}`,
      name: match ? match.capability.name : titleCase(section.title === "Output" ? (first.length > 48 ? `${first.slice(0, 46)}…` : first) : section.title),
      description: first ? `Produces lines such as "${first.length > 110 ? `${first.slice(0, 108)}…` : first}"` : `Section "${section.title}" of the submitted output`,
      sections: [section],
      match,
    });
  }
  return [...groups.values()];
}

/** The person's confirmed list wins: edits keep their match, removed ones vanish, new ones are matched by what they say. */
function applyConfirmed(proposed: Proposed[], confirmed: PrototypeComponentInput[] | undefined, sections: Section[]): Proposed[] {
  if (!confirmed) return proposed;
  let n = proposed.length;
  return confirmed.map((c) => {
    const base = c.id ? proposed.find((p) => p.id === c.id) : undefined;
    if (base) {
      const titles = c.sectionTitles ?? base.sections.map((s) => s.title);
      return { ...base, name: c.name.trim() || base.name, description: c.description?.trim() || base.description, sections: sections.filter((s) => titles.includes(s.title)) };
    }
    n += 1;
    const supporting = sections.filter((s) => (c.sectionTitles ?? []).includes(s.title));
    const need = [c.name, c.description ?? "", ...supporting.flatMap((s) => s.items.slice(0, 3))].join(". ");
    const wanted = inferWorkflowSteps(need);
    const best = libraryCapabilities()
      .map((cap) => scoreCapability(need, cap, null, wanted))
      .filter((s) => s.dimensions.problemFit > 0)
      .sort((a, b) => b.score - a.score)[0];
    const match: SectionMatch | null = best && best.score >= 45 ? { capability: best.capability, source: best.source, score: best.score, how: `reuse-fit ${best.score}` } : null;
    return { id: c.id ?? `c${n}`, name: c.name.trim(), description: c.description?.trim() || "Added by the person who built the prototype.", sections: supporting, match };
  });
}

// ---------- the same problem through an existing product ----------

const TAG = /\b([A-Z]{1,3}-\d{2,4})\b/g;
const EQUIPMENT = /\b(pump|compressor|exchanger|vessel|separator|valve|motor|bearing|seal|turbine|boiler|tank)\b/i;

/** Work-order text: pipe-separated records, or several lines with equipment tags or equipment words. */
export function looksLikeWorkOrders(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const piped = lines.filter((l) => l.split("|").length >= 5).length;
  if (piped >= 2) return true;
  const tagged = lines.filter((l) => new RegExp(TAG.source).test(l) || EQUIPMENT.test(l)).length;
  return tagged >= 2 && tagged / lines.length >= 0.5;
}

/** The live product that consumes work-order text: the preferred one for the problem, else the first live one that reads work orders. */
function workOrderConsumer(): Solution | null {
  const live = solutions.filter((s) => s.execution === "live" && !s.origin && s.status !== "deprecated" && productionCapabilities(s).active.some((c) => c.id === "cap-wo-ingest" || c.id === "cap-csv-ingest"));
  return live.find((s) => s.disposition?.kind === "retain" && s.disposition.preferred) ?? live.find((s) => s.status === "certified") ?? live[0] ?? null;
}

function tagsOf(text: string): Set<string> {
  return new Set([...text.matchAll(TAG)].map((m) => m[1]!));
}

/**
 * The words that say something about the finding: equipment tags and bare numbers are left out, so two lines about
 * the same pump only count as agreeing when they say the same thing about it.
 */
function contentTerms(text: string): Set<string> {
  return new Set(terms(text).filter((t) => !/^\d+$/.test(t)));
}

const NEGATION = /\b(not|no|never|none|without|isn't|wasn't|aren't|non-recurring|one-off|resolved|cleared|healthy|normal|ok)\b/i;
/** "P-104 vibration critical" and "P-104 vibration normal" share words and a tag; the opposite polarity makes them disagree. */
function polarityDiffers(a: string, b: string): boolean {
  return NEGATION.test(a) !== NEGATION.test(b);
}

interface RealLine {
  text: string;
  full: string;
  tokens: Set<string>;
  tags: Set<string>;
  stepId: string;
  stepName: string;
  used: boolean;
}

function compareExample(exampleId: string, exampleIndex: number, input: string, consumer: Solution, components: Proposed[]): PrototypeComparison {
  const run: Run = adHocRun(consumer, input);
  const real: RealLine[] = run.output.sections.flatMap((s) =>
    s.items.map((it) => {
      const full = `${it.text} ${it.detail ?? ""}`;
      return { text: it.text, full, tokens: contentTerms(full), tags: tagsOf(full), stepId: it.stepId, stepName: getCapability(it.stepId)?.name ?? s.title, used: false };
    }),
  );
  const lines: PrototypeComparisonLine[] = [];
  let k = 0;
  for (const comp of components) {
    for (const section of comp.sections.filter((s) => s.exampleIndex === exampleIndex)) {
      for (const text of section.items) {
        k += 1;
        const tokens = contentTerms(text);
        const tags = tagsOf(text);
        let best: { line: RealLine; sim: number; shared: number } | null = null;
        for (const line of real) {
          let shared = 0;
          for (const t of tokens) if (line.tokens.has(t)) shared += 1;
          const sim = tokens.size ? shared / tokens.size : 0;
          const tagHit = [...tags].some((t) => line.tags.has(t));
          // "Reproduced" needs the two lines to say the same thing: at least two shared content words (a shared
          // equipment tag alone is not agreement), a real share of the submitted line's words, and the same polarity.
          // The real line must also be mostly about the same thing, or a short claim would "match" any long summary that mentions its subject.
          const simReal = line.tokens.size ? shared / line.tokens.size : 0;
          const ok = shared >= 2 && (sim >= 0.5 || (tagHit && sim >= 0.3) || (shared >= 3 && sim >= 0.35)) && (simReal >= 0.25 || shared >= 4) && !polarityDiffers(text, line.full);
          if (!ok) continue;
          const weight = sim + (tagHit ? 0.5 : 0);
          if (!best || weight > best.sim) best = { line, sim: weight, shared };
        }
        if (best) best.line.used = true;
        lines.push({
          key: `${exampleId}:${k}`,
          section: section.title,
          text,
          status: best ? "reproduced" : "not_produced",
          matchedText: best?.line.text ?? null,
          matchedStepId: best?.line.stepId ?? null,
          matchedStepName: best?.line.stepName ?? null,
          componentId: comp.id,
        });
      }
    }
  }
  return {
    exampleId,
    solutionId: consumer.id,
    solutionName: consumer.name,
    submittedLabel: "Submitted example · not run by FUSEBOX",
    realLabel: `${consumer.name} v${consumer.currentVersion} · real run`,
    lines,
    reproduced: lines.filter((l) => l.status === "reproduced").length,
    notProduced: lines.filter((l) => l.status === "not_produced").length,
    onlyInReal: real.filter((r) => !r.used).length,
    run,
  };
}

// ---------- verdicts ----------

const ORDINAL = ["first", "second", "third"];

export function analyzePrototype(intake: PrototypeIntake): PrototypeAnalysis {
  const sections = intake.examples.flatMap((ex, i) => splitSections(ex.output, i));
  const proposed = applyConfirmed(proposeComponents(sections), intake.components, sections);

  // Side by side on the first example an existing product can actually run.
  const consumer = workOrderConsumer();
  let comparison: PrototypeComparison | null = null;
  let comparedIndex = -1;
  if (consumer) {
    comparedIndex = intake.examples.findIndex((ex) => looksLikeWorkOrders(ex.input));
    if (comparedIndex >= 0) comparison = compareExample(`ex${comparedIndex + 1}`, comparedIndex, intake.examples[comparedIndex]!.input, consumer, proposed);
  }

  const components: PrototypeComponent[] = proposed.map((p) => {
    const mine = comparison ? comparison.lines.filter((l) => l.componentId === p.id) : [];
    const reproduced = mine.filter((l) => l.status === "reproduced").length;
    const share = mine.length ? reproduced / mine.length : null;
    const m = p.match;
    const matched = !!m && m.score >= IMPROVE_AT;
    const srcName = m?.source?.name ?? m?.capability.sourceSolutionName ?? "";
    let verdict: PrototypeVerdict;
    let reason: string;
    if (matched && (share === null || share >= 0.34)) {
      verdict = "duplicates";
      reason = `${m!.capability.name} in ${srcName} matches (${m!.how})${share !== null ? `; ${comparison!.solutionName} reproduced ${reproduced} of ${mine.length} of these lines on your example.` : "; based on the section shape and your description."}`;
    } else if (comparison && mine.length > 0) {
      verdict = "extends";
      reason = `${comparison.solutionName} ran your example and produced ${reproduced} of ${mine.length} of these lines${matched ? ` even though ${m!.capability.name} is close (${m!.how})` : m ? `; the nearest step, ${m.capability.name}, scores only ${m.score}` : "; nothing in the library produces them"}.`;
    } else if (m) {
      verdict = "new";
      reason = `Nothing in the library produces this; the nearest step, ${m.capability.name} in ${srcName}, scores only ${m.score}.`;
    } else {
      verdict = "new";
      reason = "Nothing in the library is about this.";
    }
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      sectionTitles: [...new Set(p.sections.map((s) => s.title))],
      matchedCapabilityId: m?.capability.id ?? null,
      matchedCapabilityName: m?.capability.name ?? null,
      matchedSolutionId: m?.capability.sourceSolutionId ?? null,
      matchedSolutionName: m ? srcName : null,
      matchScore: m?.score ?? null,
      verdict,
      reason,
    };
  });

  // One recommended path, like the forward check.
  const extendsComps = components.filter((c) => c.verdict === "extends");
  const dupComps = components.filter((c) => c.verdict === "duplicates");
  const newComps = components.filter((c) => c.verdict === "new");
  const mostCommonTarget = (): Solution | null => {
    const counts = new Map<string, number>();
    for (const c of dupComps) if (c.matchedSolutionId) counts.set(c.matchedSolutionId, (counts.get(c.matchedSolutionId) ?? 0) + 1);
    const id = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return id ? (getSolution(id) ?? null) : null;
  };
  const list = (xs: PrototypeComponent[]) => xs.map((c) => c.name).join(", ");
  let recommendedPath: PrototypeAnalysis["recommendedPath"];
  let recommendation: string;
  let target: Solution | null = null;
  let targetCapabilityId: string | null = null;
  if (comparison && extendsComps.length > 0) {
    recommendedPath = "connect_module";
    target = getSolution(comparison.solutionId) ?? null;
    const addable = extendsComps.find((c) => c.matchedCapabilityId && isAddableTo(c.matchedCapabilityId, target));
    targetCapabilityId = addable?.matchedCapabilityId ?? null;
    recommendation = `Connect ${list(extendsComps)} to ${comparison.solutionName} as ${extendsComps.length === 1 ? "a module" : "modules"}: on the same input it already produced the rest${dupComps.length ? ` (${list(dupComps)})` : ""}.`;
  } else if (dupComps.length > 0 && dupComps.length >= newComps.length) {
    recommendedPath = "fold_into";
    target = mostCommonTarget();
    recommendation = `Fold ${intake.name.trim()} into ${target?.name ?? "the matched product"}: it already does what ${dupComps.length === components.length ? "this prototype does" : `${list(dupComps)} do`}${newComps.length ? `; ${list(newComps)} would be a capability request on it` : ""}.`;
  } else {
    recommendedPath = "register_new";
    target = null;
    recommendation = `Register ${intake.name.trim()} as an experimental family for IT to see: nothing in the library produces ${newComps.length === components.length ? "what it does" : list(newComps)}.`;
  }
  const n = intake.examples.length;
  const basis = `Based on ${n} submitted example${n === 1 ? "" : "s"} and your description${comparison ? `, and a real run of ${comparison.realLabel.replace(" · real run", "")} on your ${ORDINAL[comparedIndex] ?? "first"} example` : ""}.`;
  return {
    components,
    comparison,
    fallback: comparison ? null : "No existing product can run this input yet; verdicts are based on the components and description.",
    recommendedPath,
    recommendation,
    basis,
    targetSolutionId: target?.id ?? null,
    targetSolutionName: target?.name ?? null,
    targetLive: target?.execution === "live",
    targetCapabilityId,
  };
}

/** Whether a library capability can be switched on in a case on this product (so "connect as module" is a real module, not a request). */
function isAddableTo(capabilityId: string, target: Solution | null): boolean {
  if (!target || target.execution !== "live") return false;
  const cap = getCapability(capabilityId);
  if (!cap || target.capabilityIds.includes(cap.id)) return false;
  try {
    return moduleBlockedReason(cap, freshContext(target)) === null;
  } catch {
    return false;
  }
}
