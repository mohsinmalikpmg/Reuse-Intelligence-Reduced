/**
 * Executable workflow steps. Each is keyed by the catalog capability id it implements, so turning a
 * capability on or off in a workflow version changes which transformations run and therefore the output.
 * Everything here is deterministic: the same input and configuration always produce the same output.
 */
import { parseWorkOrders, type WorkOrder } from "./workorders";
import type { Cluster, Finding, OutputItem, OutputSection, RunContext, StepExecutor, StepResult } from "./types";

// ---------- shared helpers ----------

const ISSUE_LEXICON: { issue: string; label: string; pattern: RegExp }[] = [
  { issue: "vibration", label: "vibration", pattern: /vibrat|shak|bearing noise|bearing temperature/i },
  { issue: "high temperature", label: "high discharge temperature", pattern: /high discharge temp|discharge temp|tripped on high|temp(erature)? climbed|high temperature/i },
  { issue: "fouling", label: "fouling / heat transfer loss", pattern: /foul|pressure drop|outlet temperature|chemical clean/i },
  { issue: "leak", label: "leak", pattern: /leak|weep|drip/i },
  { issue: "instrument", label: "instrument reading", pattern: /transmitter|erratic|recalibrat|reading/i },
  { issue: "wear", label: "routine wear", pattern: /tire|tyre|routine wear/i },
  { issue: "facility", label: "facility repair", pattern: /light|fence|gate|parking/i },
];

export function classifyIssue(note: string): { issue: string; label: string } {
  for (const entry of ISSUE_LEXICON) if (entry.pattern.test(note)) return { issue: entry.issue, label: entry.label };
  return { issue: "general", label: "general maintenance" };
}

function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return s.length > 110 ? `${s.slice(0, 107).trimEnd()}…` : s;
}

function equipmentLabel(w: { tag: string; equipmentType: string }): string {
  return w.tag ? `${w.tag} (${w.equipmentType})` : w.equipmentType;
}

function item(stepId: string, kind: string, key: string, text: string, refs: string[] = [], detail: string | null = null): OutputItem {
  return { id: `${kind}:${key}`, key, kind, text, detail, stepId, refs };
}

function section(ctx: RunContext, key: string, title: string, stepId: string): OutputSection {
  const existing = ctx.sections.find((s) => s.key === key);
  if (existing) return existing;
  const s: OutputSection = { key, title, stepId, items: [] };
  ctx.sections.push(s);
  return s;
}

function result(inputSummary: string, transformation: string, outputSummary: string, itemCount: number): StepResult {
  return { inputSummary, transformation, outputSummary, itemCount };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function addDays(date: string, days: number): string {
  if (!date) return "TBD";
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "TBD";
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function equipmentNotes(ctx: RunContext): WorkOrder[] {
  return ctx.notes.filter((n) => n.tag);
}

function actionTemplate(issue: string, tag: string): string {
  switch (issue) {
    case "vibration":
      return `Inspect bearings and check coupling alignment on ${tag}`;
    case "fouling":
      return `Schedule chemical clean and pressure-drop check for ${tag}`;
    case "high temperature":
      return `Inspect discharge valves and intercooler on ${tag}`;
    case "leak":
      return `Replace gasket and re-torque ${tag}`;
    case "instrument":
      return `Verify calibration on ${tag}`;
    default:
      return `Investigate recurring reports on ${tag}`;
  }
}

// ---------- maintenance work-order steps ----------

function noteReader(stepId:string,description:string):StepExecutor {
  return ctx=>{
    ctx.notes = parseWorkOrders(ctx.input);
    const s = section(ctx, "input", "Work orders read", stepId);
    s.items.push(item(stepId, "count", "notes", `${plural(ctx.notes.length, "work order")} read${ctx.notes.length ? ` (${equipmentNotes(ctx).length} with an equipment tag)` : ""}.`, ctx.notes.map((n) => n.id)));
    return result(`${ctx.input.length} characters of text`,description,`${plural(ctx.notes.length, "work order")}`,ctx.notes.length);
  };
}
const readNotes=noteReader("cap-wo-ingest","Parsed supplied work-order records using the existing note schema. No external maintenance-system connection is executed in this test.");
const readCsvNotes=noteReader("cap-csv-ingest","Read supplied normalized work-order records through Pattern Finder's existing CSV test reader. This does not establish enterprise ingestion approval.");
export const readWorkbenchNotes=noteReader("input","Parsed supplied workbench note input with the existing work-order parser. Disabled product ingestion modules remain disabled; no CSV capability or external connector was executed.");

function summarizer(stepId:string):StepExecutor { return (ctx) => {
  const compact = /compact/i.test(ctx.config[stepId] ?? "");
  const s = section(ctx, "summary", "Issue summaries", stepId);
  for (const n of ctx.notes) {
    const { label } = classifyIssue(n.note);
    const text = compact ? `${equipmentLabel(n)}: ${label}.` : `${equipmentLabel(n)}, ${n.site}: ${label} — ${firstSentence(n.note)}`;
    ctx.summaries.set(n.id, text);
    s.items.push(item(stepId, "summary", n.id, text, [n.id]));
  }
  return result(plural(ctx.notes.length, "free-text note"), compact ? "Local compact summarization: one issue label per note." : `${stepId==="cap-b-summarize"?"Pattern Finder":"Work Order Insight"} local test summarization: issue label plus the leading sentence of each note.`, `${s.items.length} summaries`, s.items.length);
}; }
const summarize=summarizer("cap-summarize");
const patternSummarize=summarizer("cap-b-summarize");

const identifyConcerns: StepExecutor = (ctx) => {
  const groups = new Map<string, Finding>();
  for (const n of equipmentNotes(ctx)) {
    const { issue } = classifyIssue(n.note);
    const key = `${n.site}|${n.tag}|${issue}`;
    const g = groups.get(key) ?? { site: n.site, tag: n.tag, equipmentType: n.equipmentType, issue, refs: [], dates: [] };
    g.refs.push(n.id);
    g.dates.push(n.date);
    groups.set(key, g);
  }
  ctx.findings = [...groups.values()];
  const s = section(ctx, "concerns", "Equipment concerns", "cap-recurring");
  for (const f of ctx.findings) {
    const recurring = f.refs.length >= 2;
    const text = recurring
      ? `${f.tag} (${f.equipmentType}) at ${f.site}: ${f.issue} reported in ${plural(f.refs.length, "work order")} — recurring at this site.`
      : `${f.tag} (${f.equipmentType}) at ${f.site}: ${f.issue} reported once.`;
    s.items.push(item("cap-recurring", recurring ? "recurring" : "single", `${f.site}|${f.tag}|${f.issue}`, text, f.refs, recurring ? `Dates: ${f.dates.filter(Boolean).join(", ")}` : null));
  }
  const skipped = ctx.notes.length - equipmentNotes(ctx).length;
  if (skipped > 0) s.items.push(item("cap-recurring", "note", "no-tag", `${plural(skipped, "work order")} without an equipment reference set aside.`));
  const recurringCount = ctx.findings.filter((f) => f.refs.length >= 2).length;
  return result(plural(equipmentNotes(ctx).length, "tagged work order"), "Extracted equipment tag and issue type per note, then counted repeats of the same tag and issue within each site.", `${plural(ctx.findings.length, "concern")}, ${recurringCount} recurring within a site`, s.items.length);
};

const clusterIssues: StepExecutor = (ctx) => {
  const groups = new Map<string, Cluster>();
  for (const n of equipmentNotes(ctx)) {
    const { issue } = classifyIssue(n.note);
    if (issue === "wear" || issue === "facility" || issue === "general") continue;
    const key = `${n.equipmentType}|${issue}`;
    const c = groups.get(key) ?? { equipmentType: n.equipmentType, issue, tags: [], sites: [], refs: [], latest: "", rank: null };
    if (!c.tags.includes(n.tag)) c.tags.push(n.tag);
    if (!c.sites.includes(n.site)) c.sites.push(n.site);
    c.refs.push(n.id);
    if (n.date > c.latest) c.latest = n.date;
    groups.set(key, c);
  }
  ctx.clusters = [...groups.values()].filter((c) => c.refs.length >= 2);
  const s = section(ctx, "patterns", "Recurring patterns", "cap-clustering");
  writeClusters(ctx, s);
  if(!ctx.clusters.length)s.items.push(item("cap-clustering","note","no-patterns",`No recurring patterns matched the supplied input. ${equipmentNotes(ctx).length} of ${ctx.notes.length} notes have equipment tags. This existing classifier needs at least two tagged reports of the same equipment class and recognized issue (for example vibration, leak or fouling); it does not infer arbitrary process opportunities.`,ctx.notes.map(n=>n.id)));
  return result(plural(equipmentNotes(ctx).length, "tagged work order"), "Grouped notes by equipment class and issue type across all sites; kept groups with two or more reports.", plural(ctx.clusters.length, "cross-site pattern"), ctx.clusters.length);
};

function writeClusters(ctx: RunContext, s: OutputSection, writer="cap-clustering"): void {
  s.items = [];
  s.stepId=writer;
  for (const c of ctx.clusters) {
    const prefix = c.rank ? `#${c.rank} ` : "";
    const text = `${prefix}${capitalize(c.equipmentType)} ${c.issue}: ${plural(c.refs.length, "report")} across ${plural(c.sites.length, "site")} (${c.tags.join(", ")}).`;
    s.items.push({...item(writer, "pattern", `${c.equipmentType}|${c.issue}`, text, c.refs, `Sites: ${c.sites.join(", ")} · latest ${c.latest || "n/a"}`),originStepId:"cap-clustering",...(c.rank?{ranking:{position:c.rank,basis:"Report count descending, then latest report date descending"}}:{})});
  }
}

const rankPatterns: StepExecutor = (ctx) => {
  if (ctx.clusters.length === 0) return result("0 patterns", "Nothing to rank: clustering produced no patterns.", "0 ranked", 0);
  ctx.clusters.sort((a, b) => b.refs.length - a.refs.length || b.latest.localeCompare(a.latest));
  ctx.clusters.forEach((c, i) => (c.rank = i + 1));
  ctx.ranked = true;
  const s = section(ctx, "patterns", "Recurring patterns", "cap-clustering");
  writeClusters(ctx, s,"cap-similarity");
  return result(plural(ctx.clusters.length, "pattern"), "Ordered patterns by report count, then by most recent report.", `Top: ${ctx.clusters[0]!.equipmentType} ${ctx.clusters[0]!.issue}`, ctx.clusters.length);
};

// ---------- Safety Signals (from Incident Commander) ----------

/** Wording that, in maintenance or incident text, points to a potential safety consequence. Order = severity. */
const SAFETY_LEXICON: { signal: string; pattern: RegExp }[] = [
  { signal: "possible loss of containment", pattern: /hydrocarbon|spill|release|leak|weep|drip/i },
  { signal: "equipment kept running with a known fault", pattern: /kept in service|kept running|pending inspection|trip avoided|restarted after/i },
  { signal: "protective trip repeated", pattern: /trip repeated|tripped on high|trip(ped)? again/i },
  { signal: "area isolated or barricaded", pattern: /barricad|isolated by|isolation/i },
];
const NOT_SAFETY = /not safety critical|no safety impact/i;

export interface SafetyFlag {
  ref: string;
  label: string;
  signal: string;
  phrase: string;
  site: string;
  tag: string;
  issue: string;
}

export function findSafetySignals(text: string): { signal: string; phrase: string }[] {
  if (NOT_SAFETY.test(text)) return [];
  const hits: { signal: string; phrase: string }[] = [];
  for (const entry of SAFETY_LEXICON) {
    const m = text.match(entry.pattern);
    if (m) hits.push({ signal: entry.signal, phrase: m[0] });
  }
  return hits;
}

const safetySignals: StepExecutor = (ctx) => {
  const s = section(ctx, "safety", "Safety signals", "cap-safety-signals");
  const flags: SafetyFlag[] = [];
  if (ctx.notes.length > 0) {
    for (const n of ctx.notes) {
      const hits = findSafetySignals(n.note);
      if (hits.length === 0) continue;
      const { issue } = classifyIssue(n.note);
      const label = `${equipmentLabel(n)} at ${n.site}`;
      flags.push({ ref: n.id, label, signal: hits.map((h) => h.signal).join("; "), phrase: hits.map((h) => `"${h.phrase}"`).join(", "), site: n.site, tag: n.tag, issue });
    }
  } else {
    const sentences = ctx.input.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean);
    sentences.forEach((sentence, i) => {
      const hits = findSafetySignals(sentence);
      if (hits.length === 0) return;
      flags.push({ ref: `S${i + 1}`, label: firstSentence(sentence), signal: hits.map((h) => h.signal).join("; "), phrase: hits.map((h) => `"${h.phrase}"`).join(", "), site: "", tag: "", issue: "safety" });
    });
  }
  for (const f of flags) {
    s.items.push(item("cap-safety-signals", "safety", `${f.ref}|${f.signal}`, `Safety signal — ${f.label}: ${f.signal}. Review before routine findings.`, [f.ref], `Matched ${f.phrase}`));
  }
  if (flags.length === 0) s.items.push(item("cap-safety-signals", "note", "none", "No wording pointing to a safety consequence."));
  ctx.scratch["safetyFlags"] = flags;
  const scanned = ctx.notes.length > 0 ? plural(ctx.notes.length, "work order") : `${ctx.input.length} characters of text`;
  return result(scanned, "Matched each note against the safety-consequence lexicon (containment, known fault kept running, repeated trips, isolation) and set aside anything marked not safety critical.", plural(flags.length, "safety signal"), s.items.length);
};

const humanReview: StepExecutor = (ctx) => {
  const m = (ctx.config["cap-review-queue"] ?? "").match(/(\d+)/);
  ctx.reviewThreshold = m ? Number(m[1]) : 3;
  const s = section(ctx, "review", "Supervisor review queue", "cap-review-queue");
  ctx.reviewItems = [];
  // Every flagged work order is queued for priority review. Flags on the same equipment and issue are merged into
  // one queue item that carries all their references, so none is lost behind the first.
  const safety = (ctx.scratch["safetyFlags"] as SafetyFlag[] | undefined) ?? [];
  const groups = new Map<string, { refs: string[]; signals: string[]; first: SafetyFlag }>();
  for (const f of safety) {
    const key = f.tag ? `${f.tag}|${f.issue}` : f.ref;
    const g = groups.get(key);
    if (g) {
      g.refs.push(f.ref);
      for (const sig of f.signal.split("; ")) if (!g.signals.includes(sig)) g.signals.push(sig);
    } else groups.set(key, { refs: [f.ref], signals: f.signal.split("; "), first: f });
  }
  for (const g of groups.values()) {
    const f = g.first;
    const label = `Safety: ${f.tag ? `${f.tag} at ${f.site}` : f.label} (${g.signals.join("; ")})`;
    ctx.reviewItems.push({ label, refs: g.refs, tag: f.tag, issue: f.issue, site: f.site });
    s.items.push(item("cap-safety-signals", "review", `safety|${g.refs.join(",")}`, `${label}: ${g.refs.join(", ")} — queued ahead of routine findings.`, g.refs));
  }
  if (ctx.clusters.length > 0) {
    for (const c of ctx.clusters.filter((c) => c.refs.length >= ctx.reviewThreshold)) {
      ctx.reviewItems.push({ label: `${capitalize(c.equipmentType)} ${c.issue} (${c.tags.join(", ")})`, refs: c.refs, tag: c.tags[0]!, issue: c.issue, site: c.sites[0]! });
    }
  }
  for (const f of ctx.findings.filter((f) => f.refs.length >= ctx.reviewThreshold)) {
    if (ctx.reviewItems.some((r) => !r.label.startsWith("Safety:") && r.refs.some((ref) => f.refs.includes(ref)))) continue;
    ctx.reviewItems.push({ label: `${f.tag} ${f.issue} at ${f.site}`, refs: f.refs, tag: f.tag, issue: f.issue, site: f.site });
  }
  for (const r of ctx.reviewItems) {
    if (r.label.startsWith("Safety:")) continue;
    s.items.push(item("cap-review-queue", "review", r.label, `${r.label}: ${plural(r.refs.length, "report")} — needs supervisor review.`, r.refs));
  }
  if (ctx.reviewItems.length === 0) s.items.push(item("cap-review-queue", "note", "empty", `Nothing reached the review threshold of ${ctx.reviewThreshold} reports.`));
  const belowCount = ctx.findings.filter((f) => f.refs.length < ctx.reviewThreshold).length;
  if (belowCount > 0) s.items.push(item("cap-review-queue", "note", "auto-filed", `${plural(belowCount, "concern")} below the threshold auto-filed for trend monitoring.`));
  return result(`${plural(ctx.findings.length, "concern")}, ${plural(ctx.clusters.length, "pattern")}`, `Queued anything with ${ctx.reviewThreshold}+ reports for a supervisor; filed the rest.`, plural(ctx.reviewItems.length, "item"), s.items.length);
};

const approvalGate: StepExecutor = (ctx) => {
  const s = section(ctx, "review", "Supervisor review queue", "cap-review-queue");
  const n = ctx.reviewItems.length;
  s.items.push(item("cap-approval", "control", "approval", n ? `Supervisor approval required before ${n === 1 ? "this item is" : `these ${n} items are`} released.` : "No items awaiting approval."));
  return result(plural(n, "review item"), "Marked every review item as held until a supervisor approves it.", `${n} held for approval`, 1);
};

const routeFindings: StepExecutor = (ctx) => {
  const mode = ctx.config["cap-routing"] ?? "Route by site";
  const s = section(ctx, "routing", "Routing", "cap-routing");
  const targets = new Map<string, string[]>();
  for (const r of ctx.reviewItems) {
    const target = /central/i.test(mode) ? "Central maintenance queue" : /equipment/i.test(mode) ? `${capitalize(classOf(r.issue))} specialist` : `${r.site} planner`;
    targets.set(target, [...(targets.get(target) ?? []), r.label]);
  }
  for (const [target, labels] of targets) s.items.push(item("cap-routing", "route", target, `${target}: ${labels.join("; ")}.`));
  if (targets.size === 0) s.items.push(item("cap-routing", "note", "none", "Nothing to route."));
  return result(plural(ctx.reviewItems.length, "review item"), `${mode}.`, plural(targets.size, "queue"), s.items.length);
};

function classOf(issue: string): string {
  return issue === "vibration" ? "rotating equipment" : issue === "fouling" || issue === "leak" ? "static equipment" : "process";
}

const notify: StepExecutor = (ctx) => {
  const mode = ctx.config["cap-notify"] ?? "Daily digest";
  const s = section(ctx, "notify", "Notifications", "cap-notify");
  const sites = [...new Set(ctx.reviewItems.map((r) => r.site))];
  s.items.push(item("cap-notify", "notice", "digest", sites.length ? `${mode} to ${plural(sites.length, "site supervisor")} (${sites.join(", ")}).` : `${mode}: nothing new to send.`));
  return result(plural(ctx.reviewItems.length, "review item"), `${mode} through the enterprise notification channel.`, plural(sites.length, "recipient"), 1);
};

const followUpActions: StepExecutor = (ctx) => {
  const s = section(ctx, "actions", "Follow-up actions", "cap-action-tracking");
  ctx.actions = [];
  const sources: { tag: string; issue: string; refs: string[]; site: string; latest: string }[] = [];
  if (ctx.clusters.length > 0) {
    for (const c of ctx.clusters) for (const tag of c.tags) {
      const refs = ctx.notes.filter((n) => n.tag === tag && c.refs.includes(n.id)).map((n) => n.id);
      if (refs.length < 2) continue;
      const site = ctx.notes.find((n) => n.tag === tag)?.site ?? "";
      sources.push({ tag, issue: c.issue, refs, site, latest: c.latest });
    }
  } else {
    for (const f of ctx.findings.filter((f) => f.refs.length >= 2)) sources.push({ tag: f.tag, issue: f.issue, refs: f.refs, site: f.site, latest: [...f.dates].sort().at(-1) ?? "" });
  }
  for (const src of sources) {
    const text = actionTemplate(src.issue, src.tag);
    const owner = `${src.site} reliability engineer`;
    const due = addDays(src.latest, 14);
    ctx.actions.push({ id: `act-${src.tag}-${src.issue}`, text, owner, due, status: "Open", refs: src.refs, tag: src.tag, issue: src.issue });
    s.items.push(item("cap-action-tracking", "action", `${src.tag}|${src.issue}`, `${text} — owner: ${owner} · due ${due} · Open`, src.refs));
  }
  if (ctx.actions.length === 0) s.items.push(item("cap-action-tracking", "note", "none", "No recurring problem to act on yet."));
  return result(`${plural(ctx.clusters.length, "pattern")}, ${plural(ctx.findings.length, "concern")}`, "Created one tracked action per recurring equipment problem, assigned a site owner and a due date 14 days after the latest report.", plural(ctx.actions.length, "action"), ctx.actions.length);
};

const weeklyReport: StepExecutor = (ctx) => {
  const s = section(ctx, "reporting", "Reporting", "cap-reports");
  const recurring = ctx.findings.filter((f) => f.refs.length >= 2).length;
  s.items.push(item("cap-reports", "report", "weekly", `Weekly report line: ${plural(ctx.notes.length, "work order")}, ${plural(ctx.findings.length, "concern")}, ${recurring} recurring, ${plural(ctx.reviewItems.length, "item")} in review.`));
  return result("run totals", "Added the standard weekly report line.", "1 report line", 1);
};

const execDigest: StepExecutor = (ctx) => {
  const s = section(ctx, "reporting", "Reporting", "cap-reports");
  const top = ctx.clusters[0] ?? null;
  const topFinding = [...ctx.findings].sort((a, b) => b.refs.length - a.refs.length)[0] ?? null;
  const headline = top ? `${capitalize(top.equipmentType)} ${top.issue} is the top recurring problem (${top.refs.length} reports).` : topFinding && topFinding.refs.length >= 2 ? `${topFinding.tag} ${topFinding.issue} is the top recurring concern (${topFinding.refs.length} reports).` : "No recurring problem stands out this period.";
  s.items.push(item("cap-exec-digest", "digest", "exec", `Executive digest: ${headline}`));
  return result("run totals", "Wrote the one-line executive digest.", "1 digest line", 1);
};

// ---------- other seeded solutions ----------

const SOPS = [
  { id: "SOP-114", title: "Heat exchanger isolation and channel head removal", text: "Isolate inlet and outlet block valves, depressurize through the vent, verify zero energy with a pressure gauge, apply locks, then drain the channel before removing the head bolts in a star pattern.", keywords: ["isolation", "exchanger", "channel head", "clean", "hx", "depressur", "lock"] },
  { id: "SOP-207", title: "Compressor restart after high temperature trip", text: "Allow discharge temperature to fall below 90C, inspect intercooler, confirm valve temperatures, then restart at reduced load for thirty minutes.", keywords: ["compressor", "restart", "trip", "temperature", "intercooler"] },
  { id: "SOP-052", title: "Pump vibration alarm response", text: "Record vibration readings at all bearing points, check seal and coupling, and raise a work order if readings exceed 7.1 mm/s.", keywords: ["pump", "vibration", "alarm", "bearing", "seal"] },
];

const procedureSearch: StepExecutor = (ctx) => {
  const q = ctx.input.toLowerCase();
  const scored = SOPS.map((sop) => ({ sop, score: sop.keywords.filter((k) => q.includes(k)).length })).sort((a, b) => b.score - a.score);
  const hits = scored.filter((x) => x.score > 0);
  const s = section(ctx, "procedures", "Matching procedures", "cap-proc-index");
  for (const h of hits) s.items.push(item("cap-proc-index", "procedure", h.sop.id, `${h.sop.id} ${h.sop.title} (approved version).`, [h.sop.id], h.sop.text));
  if (hits.length === 0) s.items.push(item("cap-proc-index", "note", "none", "No approved procedure matched the question."));
  ctx.scratch.topSop = hits[0]?.sop ?? null;
  return result("1 question", "Matched the question against the approved procedure index by keyword.", plural(hits.length, "procedure"), hits.length);
};

const procedureAnswer: StepExecutor = (ctx) => {
  const top = ctx.scratch.topSop as (typeof SOPS)[number] | null;
  const s = section(ctx, "answer", "Answer", "cap-proc-answers");
  s.items.push(item("cap-proc-answers", "answer", "answer", top ? `${top.text} (Source: ${top.id}, approved version.)` : "I could not find an approved procedure for this question. Please contact the procedure owner.", top ? [top.id] : []));
  return result(top ? `top procedure ${top.id}` : "no procedure", "Composed a direct answer from the best matching approved procedure, citing its id.", "1 answer", 1);
};

const incidentActions: StepExecutor = (ctx) => {
  const sentences = ctx.input.split(/(?<=[.!?])\s+/);
  const commits = sentences.filter((sent) => /request|before restart|to be|should|must|talk|update/i.test(sent));
  const s = section(ctx, "actions", "Follow-up actions", "cap-incident-actions");
  const parts = commits.flatMap((c) => c.replace(/^.*?(requested|asked for)\s*/i, "").split(/,\s*and\s*|,\s*|\s+and\s+/)).map((p) => p.replace(/\.$/, "").trim()).filter((p) => p.length > 12);
  parts.forEach((p, i) => s.items.push(item("cap-incident-actions", "action", `a${i + 1}`, `${capitalize(p)} — Open`)));
  if (parts.length === 0) s.items.push(item("cap-incident-actions", "note", "none", "No follow-up commitments found in the narrative."));
  return result(plural(sentences.length, "sentence"), "Extracted commitments (requested, before restart, should, must) into open actions.", plural(parts.length, "action"), parts.length);
};

const handoverSummary: StepExecutor = (ctx) => {
  const entries = ctx.input.split(/(?=\b\d{2}:\d{2}\b)/).map((e) => e.trim()).filter(Boolean);
  const s = section(ctx, "handover", "Shift summary", "cap-handover-summary");
  const watch: string[] = [];
  for (const e of entries) {
    const m = e.match(/^(\d{2}:\d{2})\s*(.*)$/);
    if (!m) { if (/day shift|watch|chase/i.test(e)) watch.push(e); continue; }
    s.items.push(item("cap-handover-summary", "entry", m[1]!, `${m[1]} — ${firstSentence(m[2]!)}`));
    if (/alarm|trip|reduced|delayed|watch/i.test(m[2]!)) watch.push(firstSentence(m[2]!));
  }
  for (const w of watch) s.items.push(item("cap-handover-summary", "watch", w.slice(0, 40), `Watch: ${w}`));
  return result(plural(entries.length, "log entry"), "Split the log by timestamp, kept the leading sentence of each entry and flagged alarms, trips and open items as watch points.", `${plural(s.items.length, "line")}`, s.items.length);
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Capability id → executor. The order of this list is the execution order inside a run (ingest → analyze →
 * review → decide → track → report); the catalog's workflow stages agree with it.
 */
export const EXECUTORS: { capabilityId: string; run: StepExecutor }[] = [
  { capabilityId: "cap-wo-ingest", run: readNotes },
  { capabilityId: "cap-csv-ingest", run: readCsvNotes },
  { capabilityId: "cap-summarize", run: summarize },
  { capabilityId: "cap-b-summarize", run: patternSummarize },
  { capabilityId: "cap-recurring", run: identifyConcerns },
  { capabilityId: "cap-clustering", run: clusterIssues },
  { capabilityId: "cap-similarity", run: rankPatterns },
  { capabilityId: "cap-safety-signals", run: safetySignals },
  { capabilityId: "cap-proc-index", run: procedureSearch },
  { capabilityId: "cap-proc-answers", run: procedureAnswer },
  { capabilityId: "cap-incident-actions", run: incidentActions },
  { capabilityId: "cap-handover-summary", run: handoverSummary },
  { capabilityId: "cap-review-queue", run: humanReview },
  { capabilityId: "cap-approval", run: approvalGate },
  { capabilityId: "cap-routing", run: routeFindings },
  { capabilityId: "cap-notify", run: notify },
  { capabilityId: "cap-action-tracking", run: followUpActions },
  { capabilityId: "cap-reports", run: weeklyReport },
  { capabilityId: "cap-exec-digest", run: execDigest },
];

export const executorById = new Map(EXECUTORS.map((e) => [e.capabilityId, e.run]));
export const executionOrder = new Map(EXECUTORS.map((e, i) => [e.capabilityId, i]));

export function isExecutable(capabilityId: string): boolean {
  return executorById.has(capabilityId);
}

/** Non-maintenance workflows have no work orders; the generic "read input" step records what arrived. */
export const readInput: StepExecutor = (ctx) => {
  ctx.notes = [];
  return result(`${ctx.input.length} characters`, "Accepted the text input.", "1 text", 1);
};
