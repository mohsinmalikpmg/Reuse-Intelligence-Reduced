/**
 * Enterprise families beyond operations: Finance, Investor relations, ESG, Planning and Supply chain, Commercial
 * and Legal, Corporate. None of these products has an execution engine in FUSEBOX yet (`execution: "preview"`), so
 * the Library shows a deterministic output preview on named sample inputs and the workbench never offers a run for
 * them. Capabilities shared across functions (evidence validator, source-grounded summarizer, approval routing,
 * constraint analyzer, change tracking) are what the schematic illuminates as enterprise reuse.
 */
import type { BusinessProblem, Capability, Metrics, OutputPreview, Solution, SolutionVersion } from "@workspace/api-zod";

const zero: Metrics = { taskMinutes: 0, successRate: 0, effortScore: 0, errorRate: 0, adoption: 0, costPerTask: 0 };

export type EnterpriseCapabilitySeed = Omit<Capability, "sourceSolutionName" | "ownerName"> & { keywords?: string[]; consumes?: string[]; produces?: string[]; portableTo?: string[] };

type CapInput = Pick<Capability, "id" | "name" | "description" | "category" | "sourceSolutionId" | "workflowStep"> &
  Partial<Pick<Capability, "controlType" | "riskClass" | "evidenceLevel" | "lockedReason" | "options" | "defaultOption" | "testCoverage" | "supportStatus" | "version" | "evidence" | "incompatibleWith" | "dependsOn">> &
  { keywords?: string[]; consumes?: string[]; produces?: string[] };

function cap(c: CapInput): EnterpriseCapabilitySeed {
  return {
    controlType: "optional",
    riskClass: "medium",
    evidenceLevel: "moderate",
    lockedReason: null,
    options: null,
    defaultOption: null,
    effects: zero,
    incompatibleWith: [],
    dependsOn: [],
    testCoverage: "Golden-set evaluation",
    supportStatus: "Supported",
    version: "1.0",
    evidence: "Reviewed in pilot; no production measurement yet.",
    ...c,
  };
}

export const enterpriseCapabilitySeeds: EnterpriseCapabilitySeed[] = [
  // ---- Shared across functions ----
  cap({
    id: "cap-evidence-validator", name: "Evidence validator", category: "Validate", workflowStep: "Review", sourceSolutionId: "sol-esg-evidence-hub",
    description: "Checks every claim in a draft against the evidence it cites; flags unsupported statements, contradictions and missing sources.",
    controlType: "configurable", options: ["Flag unsupported claims", "Flag and block unsupported claims"], defaultOption: "Flag unsupported claims",
    riskClass: "high", evidence: "Caught 38 unsupported statements in the 2025 ESG report review cycle.", testCoverage: "Claim-evidence pairs, 1,200 cases",
    keywords: ["evidence", "unsupported", "claim", "source", "contradiction", "validate", "verify"], consumes: ["draft", "claims", "evidence"], produces: ["validation findings", "unsupported claims"],
  }),
  cap({
    id: "cap-source-summarizer", name: "Source-grounded summarizer", category: "Draft", workflowStep: "Analyze", sourceSolutionId: "sol-exec-briefing",
    description: "Summarizes documents and records into sentences that each cite the source they came from.",
    controlType: "configurable", options: ["Approved model: Enterprise LLM", "Approved model: Compact LLM"], defaultOption: "Approved model: Enterprise LLM",
    evidence: "86% of cited sentences accepted unchanged in corporate briefings.", keywords: ["summar", "cite", "source", "grounded", "narrative"], consumes: ["documents", "records"], produces: ["cited summary", "summary"],
  }),
  cap({
    id: "cap-approval-routing", name: "Approval routing", category: "Approve", workflowStep: "Decide", sourceSolutionId: "sol-contract-review",
    description: "Routes a draft to the accountable reviewer and approver; the drafter can never approve their own output.",
    controlType: "locked", lockedReason: "Enforces segregation of duties. Cannot be disabled by a product user.", riskClass: "high", evidenceLevel: "strong",
    evidence: "Internal audit relied on its approval trail in the 2026 contract review.", testCoverage: "Full regression suite",
    keywords: ["approval", "route", "approver", "segregation", "duties", "sign-off"], consumes: ["draft", "review items"], produces: ["approved output", "approval record"],
  }),
  cap({
    id: "cap-constraint-analyzer", name: "Constraint analyzer", category: "Analyze", workflowStep: "Analyze", sourceSolutionId: "sol-planning-assistant",
    description: "Finds which capacity, resource, lead-time or budget constraints bind a plan and by how much.",
    evidence: "Matched planner-identified binding constraints in 9 of 10 pilot plans.", keywords: ["constraint", "capacity", "binding", "feasib", "lead time", "resource"], consumes: ["plan", "demand", "capacity"], produces: ["constraint analysis", "binding constraints"],
  }),
  cap({
    id: "cap-change-tracking", name: "Change tracking", category: "Review", workflowStep: "Review", sourceSolutionId: "sol-disclosure-proof",
    description: "Keeps every draft version, who changed what, and a clear line between draft and approved output.",
    controlType: "locked", lockedReason: "Required for disclosure-grade outputs. Cannot be disabled by a product user.", riskClass: "high", evidenceLevel: "strong",
    keywords: ["version", "change", "track", "draft", "approved", "history"], consumes: ["draft"], produces: ["change history", "draft status"],
  }),
  // ---- Management Performance Pack ----
  cap({ id: "cap-gl-ingest", name: "Read ledger and KPI data", category: "Ingest", workflowStep: "Ingest", sourceSolutionId: "sol-mgmt-pack", controlType: "locked", lockedReason: "Uses the approved finance data definitions.", description: "Pulls period actuals, budget and operational KPIs from the finance warehouse using approved definitions.", riskClass: "high", evidenceLevel: "strong", keywords: ["ledger", "actuals", "budget", "kpi", "finance", "warehouse"], consumes: ["finance warehouse"], produces: ["period results", "KPIs"] }),
  cap({ id: "cap-reconcile", name: "Reconcile results", category: "Validate", workflowStep: "Analyze", sourceSolutionId: "sol-mgmt-pack", controlType: "locked", lockedReason: "Reconciliation to the ledger is a mandatory control.", description: "Ties every reported figure back to the ledger and the prior period; unreconciled lines are blocked from the pack.", riskClass: "high", evidenceLevel: "strong", keywords: ["reconcile", "tie out", "ledger", "prior period"], consumes: ["period results"], produces: ["reconciled results"] }),
  cap({ id: "cap-variance", name: "Variance commentary", category: "Draft", workflowStep: "Analyze", sourceSolutionId: "sol-mgmt-pack", controlType: "configurable", options: ["Explain variances over 5%", "Explain variances over 10%"], defaultOption: "Explain variances over 5%", description: "Drafts a commentary line for every material variance against budget and prior period, with the driver it found.", keywords: ["variance", "commentary", "budget", "driver", "explain"], consumes: ["reconciled results"], produces: ["variance commentary", "commentary"] }),
  cap({ id: "cap-exceptions", name: "Exception summary", category: "Review", workflowStep: "Review", sourceSolutionId: "sol-mgmt-pack", description: "Lists the lines a reviewer must look at: unreconciled items, missing commentary and late submissions.", keywords: ["exception", "missing", "late", "review"], consumes: ["reconciled results", "commentary"], produces: ["exceptions", "review items"] }),
  // ---- Variance Commentary Bot (overlapping) ----
  cap({ id: "cap-variance-bot-draft", name: "Chat-drafted commentary", category: "Draft", workflowStep: "Analyze", sourceSolutionId: "sol-variance-bot", description: "Drafts variance commentary from a pasted spreadsheet in a chat window; nothing is reconciled or cited.", riskClass: "high", evidenceLevel: "limited", supportStatus: "Best effort", version: "0.3", evidence: "Not evaluated.", keywords: ["variance", "commentary", "chat", "spreadsheet"], consumes: ["spreadsheet"], produces: ["commentary"] }),
  // ---- Disclosure Draft & Proof ----
  cap({ id: "cap-disclosure-draft", name: "Source-linked disclosure draft", category: "Draft", workflowStep: "Analyze", sourceSolutionId: "sol-disclosure-proof", description: "Assembles a first draft of outlook or disclosure text where every sentence links to its approved source.", riskClass: "high", keywords: ["disclosure", "outlook", "draft", "investor", "source-linked"], consumes: ["approved sources", "prior disclosures"], produces: ["disclosure draft"] }),
  cap({ id: "cap-consistency-check", name: "Consistency findings", category: "Validate", workflowStep: "Review", sourceSolutionId: "sol-disclosure-proof", description: "Compares figures and statements across the draft, the financial statements and prior disclosures; reports every mismatch.", riskClass: "high", keywords: ["consistency", "mismatch", "proof", "compare"], consumes: ["disclosure draft", "financial statements"], produces: ["consistency findings"] }),
  // ---- ESG Evidence Hub ----
  cap({ id: "cap-esg-collect", name: "Collect evidence from systems", category: "Ingest", workflowStep: "Ingest", sourceSolutionId: "sol-esg-evidence-hub", controlType: "locked", lockedReason: "Collects from approved systems of record only.", description: "Gathers emissions, water, safety and workforce records from their systems of record with their lineage.", keywords: ["evidence", "emissions", "water", "lineage", "collect"], consumes: ["systems of record"], produces: ["evidence records", "lineage"] }),
  cap({ id: "cap-esg-coverage", name: "Disclosure coverage map", category: "Analyze", workflowStep: "Analyze", sourceSolutionId: "sol-esg-evidence-hub", description: "Maps each required disclosure to the evidence collected and shows the gaps still open.", keywords: ["coverage", "gap", "disclosure", "requirement", "esg"], consumes: ["evidence records", "requirements"], produces: ["coverage map", "gaps"] }),
  // ---- Emissions Data Collector (overlapping prototype) ----
  cap({ id: "cap-emissions-sheet", name: "Emissions spreadsheet import", category: "Ingest", workflowStep: "Ingest", sourceSolutionId: "sol-emissions-collector", description: "Imports site emissions from spreadsheets each site maintains by hand.", evidenceLevel: "limited", supportStatus: "Best effort", version: "0.4", evidence: "Not evaluated.", keywords: ["emissions", "spreadsheet", "import", "site"], consumes: ["spreadsheet"], produces: ["emissions records"] }),
  // ---- Integrated Planning Assistant ----
  cap({ id: "cap-schedule-build", name: "Build feasible schedule", category: "Analyze", workflowStep: "Analyze", sourceSolutionId: "sol-planning-assistant", description: "Builds a schedule that respects capacity, crew and lead-time constraints from the demand and resource inputs.", keywords: ["schedule", "plan", "feasible", "capacity", "crew"], consumes: ["demand", "capacity", "resources"], produces: ["schedule", "feasible plan"] }),
  cap({ id: "cap-scenario-compare", name: "Scenario comparison", category: "Review", workflowStep: "Review", sourceSolutionId: "sol-planning-assistant", description: "Lays two or more scenarios side by side on the same assumptions and shows where they differ.", keywords: ["scenario", "compare", "sensitivity", "alternative"], consumes: ["scenarios"], produces: ["scenario comparison"] }),
  // ---- Supply Chain Optimizer ----
  cap({ id: "cap-order-plan", name: "Recommended order plan", category: "Analyze", workflowStep: "Analyze", sourceSolutionId: "sol-supply-optimizer", controlType: "locked", lockedReason: "The core planning engine of the product.", evidenceLevel: "strong", evidence: "Reduced stock-outs on critical spares by 23% in the first year.", testCoverage: "Nightly integration tests", version: "2.3", description: "Recommends what to order, when and from whom, from inventory, purchasing and demand data.", keywords: ["order", "inventory", "purchasing", "demand", "shortage", "excess"], consumes: ["inventory", "purchase orders", "demand"], produces: ["order plan", "shortages", "excess"] }),
  cap({ id: "cap-supplier-risk", name: "Supplier risk flags", category: "Review", workflowStep: "Review", sourceSolutionId: "sol-supply-optimizer", description: "Flags orders that depend on a supplier with late deliveries, single-source exposure or an expiring contract.", keywords: ["supplier", "risk", "single source", "late"], consumes: ["order plan", "supplier history"], produces: ["supplier risks"] }),
  // ---- Contract Review Workbench ----
  cap({ id: "cap-clause-extract", name: "Clause extraction", category: "Extract", workflowStep: "Analyze", sourceSolutionId: "sol-contract-review", evidenceLevel: "strong", evidence: "94% clause-level agreement with legal reviewers on 600 contracts.", description: "Finds and labels the clauses that matter: term, liability, indemnity, termination, pricing and change control.", keywords: ["clause", "contract", "extract", "liability", "indemnity", "termination"], consumes: ["contract"], produces: ["clause summary", "clauses"] }),
  cap({ id: "cap-deviation-check", name: "Deviation from standard terms", category: "Validate", workflowStep: "Review", sourceSolutionId: "sol-contract-review", evidenceLevel: "strong", description: "Compares each clause with the approved standard terms and rates the deviation.", keywords: ["deviation", "standard terms", "playbook", "risk"], consumes: ["clauses", "standard terms"], produces: ["deviations", "risks"] }),
  // ---- Executive Briefing Builder ----
  cap({ id: "cap-briefing-assemble", name: "Briefing assembly", category: "Draft", workflowStep: "Analyze", sourceSolutionId: "sol-exec-briefing", description: "Assembles a one-page briefing from the cited summaries: situation, decisions needed, emerging risks.", keywords: ["briefing", "executive", "one page", "assemble"], consumes: ["cited summary"], produces: ["briefing"] }),
  cap({ id: "cap-decision-register", name: "Decisions and risks register", category: "Monitor", workflowStep: "Track", sourceSolutionId: "sol-exec-briefing", description: "Keeps the decisions asked for, who took them and what happened next.", keywords: ["decision", "register", "risk", "track"], consumes: ["briefing"], produces: ["decision register"] }),
  // ---- Scenario Decision Studio ----
  cap({ id: "cap-scenario-assumptions", name: "Assumption register", category: "Extract", workflowStep: "Ingest", sourceSolutionId: "sol-scenario-studio", description: "Captures every assumption behind a scenario with its owner and source so packs can be compared honestly.", keywords: ["assumption", "scenario", "register", "price deck"], consumes: ["scenario inputs"], produces: ["assumptions"] }),
];

type CatalogVersion = Pick<SolutionVersion, "version" | "releasedAt" | "summary">;
export type EnterpriseSolutionSeed = Omit<Solution, "versions" | "disposition"> & { versions: CatalogVersion[]; intendedUsers: string[]; dataSources: string[]; keywords: string[] };

const SHARED_CONTROLS = ["Identity and access control", "Audit logging"];

export const MANAGEMENT_PACK_PREVIEW: OutputPreview = {
  title: "September 2026 management pack · sample",
  inputs: ["Monthly actuals and budget, September 2026 (sample ledger extract)", "Operational KPIs, Plant Ops North and Central (sample)", "August 2026 commentary (sample)"],
  sections: [
    {
      heading: "Variance summary",
      lines: [
        "Operating cost 4.2% over budget (sample: +$3.1M); driver: unplanned maintenance at Plant Ops North, 61% of the variance.",
        "Production volume 1.8% under budget; driver: the HX-210 outage in week 2, consistent with August commentary.",
        "Unit cost 6.1% over budget; both drivers above, no new driver found.",
        "Safety: recordable incident rate within plan; no variance line generated.",
      ],
    },
    {
      heading: "Draft management commentary",
      lines: [
        "Operating costs exceeded budget mainly because of unplanned maintenance at Plant Ops North, where the HX-210 heat exchanger outage required a second intervention. [source: WO-2026-0918, KPI sheet row 14]",
        "Volume recovered in the second half of the month once HX-210 returned to service; full-month volume remains 1.8% below plan. [source: production KPI, rows 3-7]",
        "No change to the full-year outlook is proposed by this pack; that decision rests with the controller. [source: August commentary §2]",
      ],
    },
    {
      heading: "Exceptions requiring review",
      lines: [
        "Line 22 (contractor services) is unreconciled to the ledger by $140K; blocked from the pack until resolved.",
        "Fleet Maintenance submitted KPIs two days after the cut-off; commentary for Fleet is drafted from August figures and marked provisional.",
        "Variance commentary for 'other income' could not find a driver; a reviewer must write it.",
      ],
    },
    {
      heading: "Source references",
      lines: ["Ledger extract GL-2026-09 (sample)", "KPI sheet OPS-KPI-2026-09 (sample)", "August 2026 management commentary (sample)"],
    },
  ],
  note: "Built once from fixed sample inputs so the output shape is credible. FUSEBOX does not run this product on real data yet, so it cannot produce A/B evidence; connecting the finance warehouse is what an execution engine for this family would need.",
};

const preview = (title: string, inputs: string[], sections: OutputPreview["sections"], needs: string): OutputPreview => ({
  title, inputs, sections,
  note: `Built once from fixed sample inputs. FUSEBOX does not run this product on real data yet, so it cannot produce A/B evidence; ${needs}`,
});

export const enterpriseSolutionSeeds: EnterpriseSolutionSeed[] = [
  {
    id: "sol-mgmt-pack",
    name: "Management Performance Pack",
    outcome: "Produces reconciled monthly results with variance commentary and an exception list for the controller's review.",
    description: "The certified Finance product for monthly management reporting. Reads actuals, budget and KPIs with approved definitions, reconciles every figure to the ledger, drafts variance commentary with its drivers, and routes the pack through the controller for approval. Reuses the ESG Evidence Hub's validator and the corporate summarizer.",
    status: "certified", kind: "complete_solution", ownerName: "Hannah Brooks", ownerTeam: "Finance Systems",
    businessUnits: ["Corporate Finance", "Plant Ops North", "Plant Ops Central", "Fleet Maintenance"], activeUsers: 210, evidenceLevel: "strong", timeToAdopt: "3-4 weeks", adoptionEffort: "medium",
    workflowSteps: ["Ingest", "Analyze", "Review", "Decide", "Track"], currentVersion: "2.1",
    versions: [
      { version: "2.1", releasedAt: "2026-08-30", summary: "Evidence validator from ESG Evidence Hub added to the review step." },
      { version: "2.0", releasedAt: "2026-02-12", summary: "Certified release with reconciliation and variance commentary." },
    ],
    knownGaps: ["Commentary for lines without a measurable driver still has to be written by a reviewer.", "Pack takes 1.5 days after the KPI cut-off."],
    dependencies: ["Finance warehouse", "Enterprise identity provider", "Approved LLM gateway"],
    capabilityIds: ["cap-identity", "cap-gl-ingest", "cap-reconcile", "cap-variance", "cap-source-summarizer", "cap-evidence-validator", "cap-exceptions", "cap-approval-routing", "cap-audit", "cap-retention"],
    businessProblemIds: ["bp-management-reporting"],
    baselineMetrics: { taskMinutes: 720, successRate: 88, effortScore: 5.2, errorRate: 5, adoption: 74, costPerTask: 38 },
    retirementCandidate: false, architectureStatus: "Approved reference architecture", controlStatus: "All mandatory controls in place", supportModel: "Finance Systems, business hours", lastReviewedAt: "2026-09-10",
    intendedUsers: ["financial analyst", "controller", "finance business partner"], dataSources: ["ledger", "budget", "operational KPIs"],
    keywords: ["management reporting", "month end", "variance", "commentary", "pack", "actuals", "budget", "controller", "finance", "reconcile"],
    businessFunction: "Finance", primaryUsers: ["Financial analyst", "Controller"], workflowType: "Reconcile, draft and approve", outputType: "Management report",
    riskTier: "high", dataInvolved: ["Ledger actuals and budget", "Operational KPIs", "Prior-period commentary"],
    controls: [...SHARED_CONTROLS, "Reconciliation to ledger before release", "Source-linked commentary", "Segregation of duties on approval", "Draft and approved versions kept apart"],
    execution: "preview", outputPreview: MANAGEMENT_PACK_PREVIEW,
  },
  {
    id: "sol-variance-bot",
    name: "Variance Commentary Bot",
    outcome: "Drafts variance commentary from a pasted spreadsheet in a chat window.",
    description: "An experimental chat tool built by FP&A Innovation. Fast to use, but it reconciles nothing, cites nothing and keeps no record of what was drafted; its commentary has reached the pack twice without review.",
    status: "experimental", kind: "prototype", ownerName: "Tomas Lind", ownerTeam: "FP&A Innovation",
    businessUnits: ["Corporate Finance"], activeUsers: 26, evidenceLevel: "limited", timeToAdopt: "Not adoptable as-is", adoptionEffort: "high",
    workflowSteps: ["Analyze"], currentVersion: "0.3",
    versions: [{ version: "0.3", releasedAt: "2026-07-02", summary: "Prototype: paste a spreadsheet, get commentary." }],
    knownGaps: ["No reconciliation or source links.", "No approval or audit trail.", "Pasted data leaves the finance boundary."],
    dependencies: ["Public chat model (unapproved)"],
    capabilityIds: ["cap-variance-bot-draft"], businessProblemIds: ["bp-management-reporting"],
    baselineMetrics: { taskMinutes: 60, successRate: 70, effortScore: 4.0, errorRate: 18, adoption: 30, costPerTask: 2 },
    retirementCandidate: true, architectureStatus: "Unsupported: unapproved model, data leaves boundary", controlStatus: "No reconciliation, approval or audit controls", supportModel: "FP&A Innovation, best effort", lastReviewedAt: "2026-07-02",
    intendedUsers: ["financial analyst"], dataSources: ["pasted spreadsheet"],
    keywords: ["variance", "commentary", "chat", "spreadsheet", "finance", "month end"],
    businessFunction: "Finance", primaryUsers: ["Financial analyst"], workflowType: "Draft only", outputType: "Commentary text",
    riskTier: "high", dataInvolved: ["Pasted ledger extracts"], controls: [], execution: "preview", outputPreview: null,
  },
  {
    id: "sol-disclosure-proof",
    name: "Disclosure Draft & Proof",
    outcome: "Gives Investor Relations a source-linked first draft of outlook text with every consistency problem flagged for review.",
    description: "A pilot for drafting and proofing outlook and disclosure materials. Every sentence in the draft links to an approved source, consistency findings compare the draft with the financial statements and prior disclosures, and nothing leaves the product without reviewer and approver sign-off. FUSEBOX never publishes externally.",
    status: "pilot", kind: "complete_solution", ownerName: "Grace Whitfield", ownerTeam: "Investor Relations",
    businessUnits: ["Corporate"], activeUsers: 14, evidenceLevel: "moderate", timeToAdopt: "4-6 weeks", adoptionEffort: "medium",
    workflowSteps: ["Ingest", "Analyze", "Review", "Decide", "Track"], currentVersion: "1.2",
    versions: [
      { version: "1.2", releasedAt: "2026-09-18", summary: "Consistency findings against prior disclosures." },
      { version: "1.0", releasedAt: "2026-05-20", summary: "Pilot release with source-linked drafting and change tracking." },
    ],
    knownGaps: ["Two quarters of pilot evidence only.", "Proofing covers text, not charts."],
    dependencies: ["Approved disclosure source library", "Enterprise identity provider", "Approved LLM gateway"],
    capabilityIds: ["cap-identity", "cap-disclosure-draft", "cap-source-summarizer", "cap-evidence-validator", "cap-consistency-check", "cap-change-tracking", "cap-approval-routing", "cap-audit"],
    businessProblemIds: ["bp-disclosure-drafting"],
    baselineMetrics: { taskMinutes: 480, successRate: 85, effortScore: 5.5, errorRate: 6, adoption: 60, costPerTask: 52 },
    retirementCandidate: false, architectureStatus: "Under review", controlStatus: "Disclosure controls in place; pilot evidence", supportModel: "Investor Relations with Corporate Systems, business hours", lastReviewedAt: "2026-09-18",
    intendedUsers: ["investor relations analyst", "disclosure reviewer", "general counsel"], dataSources: ["approved disclosure sources", "financial statements", "prior disclosures"],
    keywords: ["disclosure", "investor", "outlook", "proof", "draft", "consistency", "quarterly", "materials", "review"],
    businessFunction: "Investor relations", primaryUsers: ["Investor relations analyst", "Disclosure reviewer"], workflowType: "Draft, proof and approve", outputType: "Draft disclosure with findings",
    riskTier: "high", dataInvolved: ["Approved disclosure sources", "Financial statements", "Prior disclosures"],
    controls: [...SHARED_CONTROLS, "Source-linked claims", "Change tracking with draft and approved states", "Reviewer and approver roles", "No external publication from FUSEBOX"],
    execution: "preview",
    outputPreview: preview("Q3 2026 outlook paragraph · sample", ["Approved source library, Q3 2026 (sample)", "Q2 2026 outlook text (sample)"], [
      { heading: "Source-linked first draft", lines: ["Production guidance for the year is unchanged. [source: Board paper 2026-09-B, p.4]", "Capital spending is tracking to the lower half of the range following the deferral of two projects. [source: Capital review 2026-09, table 2]"] },
      { heading: "Consistency findings", lines: ["Draft says 'lower half of the range'; Q2 text said 'midpoint'. Reviewer must confirm the change is intended.", "Figure $2.1B in the draft matches the financial statements."] },
      { heading: "Review flags", lines: ["1 sentence has no approved source and is held back from the draft.", "Draft is in state DRAFT; approver sign-off required before it can be exported."] },
    ], "connecting the approved source library is what an execution engine for this family would need."),
  },
  {
    id: "sol-esg-evidence-hub",
    name: "ESG Evidence Hub",
    outcome: "Shows which ESG disclosures are covered by evidence from systems of record and which gaps remain.",
    description: "A pilot that collects emissions, water, safety and workforce evidence from systems of record with lineage, maps it to each required disclosure, and validates claims against it. Its evidence validator is reused by Finance, Investor Relations and Legal.",
    status: "pilot", kind: "complete_solution", ownerName: "Amara Osei", ownerTeam: "Sustainability Reporting",
    businessUnits: ["Corporate", "Plant Ops North", "Plant Ops Central", "Plant Ops South"], activeUsers: 48, evidenceLevel: "moderate", timeToAdopt: "4-6 weeks", adoptionEffort: "medium",
    workflowSteps: ["Ingest", "Analyze", "Review", "Track"], currentVersion: "1.3",
    versions: [
      { version: "1.3", releasedAt: "2026-08-08", summary: "Evidence validator offered as a reusable module." },
      { version: "1.0", releasedAt: "2026-03-15", summary: "Pilot release with coverage map." },
    ],
    knownGaps: ["Water data for Plant Ops South still arrives by spreadsheet.", "No approval routing of its own."],
    dependencies: ["Emissions monitoring system", "Safety management system", "HR system", "Enterprise identity provider"],
    capabilityIds: ["cap-identity", "cap-esg-collect", "cap-esg-coverage", "cap-evidence-validator", "cap-change-tracking", "cap-audit", "cap-retention"],
    businessProblemIds: ["bp-esg-evidence"],
    baselineMetrics: { taskMinutes: 900, successRate: 82, effortScore: 5.8, errorRate: 8, adoption: 55, costPerTask: 60 },
    retirementCandidate: false, architectureStatus: "Approved with conditions", controlStatus: "Lineage and audit in place; approval routing pending", supportModel: "Sustainability Reporting with Corporate Systems", lastReviewedAt: "2026-08-08",
    intendedUsers: ["sustainability analyst", "disclosure owner", "environmental advisor"], dataSources: ["emissions monitoring", "safety management system", "HR system"],
    keywords: ["esg", "sustainability", "disclosure", "evidence", "emissions", "regulatory", "coverage", "gap", "lineage"],
    businessFunction: "ESG & Regulatory", primaryUsers: ["Sustainability analyst", "Disclosure owner"], workflowType: "Collect, map and validate", outputType: "Coverage map with gaps",
    riskTier: "high", dataInvolved: ["Emissions and water records", "Safety records", "Workforce records"],
    controls: [...SHARED_CONTROLS, "Data lineage on every evidence record", "Immutable evidence records", "Change tracking"],
    execution: "preview",
    outputPreview: preview("2026 disclosure coverage · sample", ["Emissions, water and safety records, Jan-Sep 2026 (sample)", "Disclosure requirement list 2026 (sample)"], [
      { heading: "Disclosure coverage", lines: ["Scope 1 emissions: covered, 3 sites, lineage complete.", "Water withdrawal: covered for North and Central; South evidence is a spreadsheet without lineage.", "Recordable incident rate: covered, safety management system."] },
      { heading: "Unresolved gaps", lines: ["Scope 3 category 4 (upstream transport): no evidence collected.", "Workforce diversity: HR extract older than the reporting period."] },
      { heading: "Validation findings", lines: ["2 draft claims cite evidence that does not support the stated figure; held for the disclosure owner."] },
    ], "connecting the emissions and safety systems is what an execution engine for this family would need."),
  },
  {
    id: "sol-emissions-collector",
    name: "Emissions Data Collector",
    outcome: "Imports site emissions from spreadsheets each site keeps by hand.",
    description: "A prototype built by Environmental Services before the Evidence Hub existed. It overlaps the Hub's collection step, carries no lineage, and two sites still submit through it.",
    status: "experimental", kind: "prototype", ownerName: "Ravi Menon", ownerTeam: "Environmental Services",
    businessUnits: ["Plant Ops South"], activeUsers: 9, evidenceLevel: "limited", timeToAdopt: "Not adoptable as-is", adoptionEffort: "high",
    workflowSteps: ["Ingest"], currentVersion: "0.4",
    versions: [{ version: "0.4", releasedAt: "2026-01-28", summary: "Spreadsheet import prototype." }],
    knownGaps: ["No lineage.", "No identity integration.", "Duplicates the Evidence Hub's collection step."],
    dependencies: ["Shared spreadsheets"],
    capabilityIds: ["cap-emissions-sheet"], businessProblemIds: ["bp-esg-evidence"],
    baselineMetrics: { taskMinutes: 240, successRate: 65, effortScore: 6.5, errorRate: 20, adoption: 25, costPerTask: 15 },
    retirementCandidate: true, architectureStatus: "Unsupported", controlStatus: "No lineage, identity or audit controls", supportModel: "Environmental Services, best effort", lastReviewedAt: "2026-01-28",
    intendedUsers: ["environmental advisor"], dataSources: ["site spreadsheets"],
    keywords: ["emissions", "spreadsheet", "site", "environmental", "esg"],
    businessFunction: "ESG & Regulatory", primaryUsers: ["Environmental advisor"], workflowType: "Import only", outputType: "Emissions records",
    riskTier: "medium", dataInvolved: ["Site emissions spreadsheets"], controls: [], execution: "preview", outputPreview: null,
  },
  {
    id: "sol-planning-assistant",
    name: "Integrated Planning Assistant",
    outcome: "Builds a feasible schedule from one set of assumptions and shows planners which constraints bind.",
    description: "A pilot for planners who today build plans in separate tools with conflicting assumptions. It builds a feasible schedule, analyzes binding constraints and compares scenarios on the same assumptions. Its constraint analyzer is reused by the Supply Chain Optimizer.",
    status: "pilot", kind: "configurable_product", ownerName: "Sofia Marin", ownerTeam: "Planning Systems",
    businessUnits: ["Plant Ops North", "Plant Ops Central"], activeUsers: 37, evidenceLevel: "moderate", timeToAdopt: "6-8 weeks", adoptionEffort: "medium",
    workflowSteps: ["Ingest", "Analyze", "Review"], currentVersion: "1.1",
    versions: [{ version: "1.1", releasedAt: "2026-09-05", summary: "Scenario comparison on shared assumptions." }, { version: "1.0", releasedAt: "2026-04-22", summary: "Pilot release." }],
    knownGaps: ["Two sites only.", "No approval routing; plans are exported to the scheduling tool by hand."],
    dependencies: ["Scheduling tool", "Enterprise identity provider"],
    capabilityIds: ["cap-identity", "cap-schedule-build", "cap-constraint-analyzer", "cap-scenario-compare", "cap-audit"],
    businessProblemIds: ["bp-integrated-planning"],
    baselineMetrics: { taskMinutes: 360, successRate: 80, effortScore: 5.6, errorRate: 9, adoption: 48, costPerTask: 30 },
    retirementCandidate: false, architectureStatus: "Under review", controlStatus: "Identity and audit in place", supportModel: "Planning Systems, business hours", lastReviewedAt: "2026-09-05",
    intendedUsers: ["planner", "scheduler", "operations manager"], dataSources: ["demand forecast", "capacity", "crew availability"],
    keywords: ["planning", "schedule", "scheduling", "constraint", "feasible", "scenario", "capacity", "assumptions", "turnaround"],
    businessFunction: "Supply chain & Planning", primaryUsers: ["Planner", "Scheduler"], workflowType: "Plan and compare", outputType: "Schedule with constraint analysis",
    riskTier: "medium", dataInvolved: ["Demand forecast", "Capacity and crew availability", "Lead times"], controls: [...SHARED_CONTROLS, "Shared assumption set per plan"],
    execution: "preview",
    outputPreview: preview("Q4 2026 turnaround schedule · sample", ["Demand and capacity, Q4 2026 (sample)", "Crew availability by week (sample)"], [
      { heading: "Feasible schedule", lines: ["Turnaround window weeks 44-46 feasible with 2 contractor crews; week 47 slips if HX-210 scope grows.", "Resource utilization 91% in week 45; 78% average across the quarter."] },
      { heading: "Binding constraints", lines: ["Crane availability binds in week 45 (demand 3, capacity 2).", "Valve lead time of 6 weeks binds the week 44 start; order by week 38."] },
      { heading: "Scenario comparison", lines: ["Scenario B (one crew fewer) delays completion by 9 days and lowers cost by 7%; same assumptions as A."] },
    ], "connecting the scheduling tool is what an execution engine for this family would need."),
  },
  {
    id: "sol-supply-optimizer",
    name: "Supply Chain Optimizer",
    outcome: "Recommends an order plan with shortages, excess and supplier risks from inventory, purchasing and demand data.",
    description: "The certified supply chain product. Reads inventory, purchase orders and demand, recommends what to order, flags supplier risks and routes the plan to the accountable buyer for approval. Reuses the planning assistant's constraint analyzer.",
    status: "certified", kind: "complete_solution", ownerName: "Ben Carter", ownerTeam: "Supply Chain Systems",
    businessUnits: ["Supply Chain", "Plant Ops North", "Plant Ops Central", "Plant Ops South", "Fleet Maintenance"], activeUsers: 160, evidenceLevel: "strong", timeToAdopt: "3-4 weeks", adoptionEffort: "medium",
    workflowSteps: ["Ingest", "Analyze", "Review", "Decide", "Track"], currentVersion: "2.3",
    versions: [{ version: "2.3", releasedAt: "2026-06-11", summary: "Constraint analyzer from Integrated Planning Assistant." }, { version: "2.0", releasedAt: "2025-10-01", summary: "Certified release." }],
    knownGaps: ["Operational demand from maintenance plans is entered by hand."],
    dependencies: ["ERP purchasing", "Inventory system", "Enterprise identity provider"],
    capabilityIds: ["cap-identity", "cap-order-plan", "cap-constraint-analyzer", "cap-supplier-risk", "cap-approval-routing", "cap-audit"],
    businessProblemIds: ["bp-order-planning"],
    baselineMetrics: { taskMinutes: 180, successRate: 89, effortScore: 4.8, errorRate: 4, adoption: 80, costPerTask: 12 },
    retirementCandidate: false, architectureStatus: "Approved reference architecture", controlStatus: "All mandatory controls in place", supportModel: "Supply Chain Systems, business hours", lastReviewedAt: "2026-09-01",
    intendedUsers: ["buyer", "inventory planner", "supply chain analyst"], dataSources: ["inventory", "purchase orders", "demand"],
    keywords: ["supply chain", "inventory", "order", "purchasing", "procurement", "shortage", "excess", "supplier", "stock"],
    businessFunction: "Supply chain & Planning", primaryUsers: ["Buyer", "Inventory planner"], workflowType: "Recommend and approve", outputType: "Order plan with risks",
    riskTier: "medium", dataInvolved: ["Inventory levels", "Purchase orders", "Demand"], controls: [...SHARED_CONTROLS, "Buyer approval before any order is placed"],
    execution: "preview",
    outputPreview: preview("Week 42 order plan · sample", ["Inventory and open purchase orders, week 41 (sample)", "Maintenance demand, weeks 42-50 (sample)"], [
      { heading: "Recommended order plan", lines: ["Order 12 gasket kits (P-104 class) by Friday; 6-week lead time against week 48 demand.", "Defer 40 filter cartridges; 11 weeks of cover on hand."] },
      { heading: "Shortages and excess", lines: ["Shortage: HX-210 tube bundle, needed week 45, none on order.", "Excess: 3 pump seals beyond 12 months of demand."] },
      { heading: "Supplier risks", lines: ["Gasket supplier delivered late on 3 of the last 5 orders.", "Tube bundle is single-sourced; contract expires in December."] },
    ], "connecting ERP purchasing and the inventory system is what an execution engine for this family would need."),
  },
  {
    id: "sol-scenario-studio",
    name: "Scenario Decision Studio",
    outcome: "Turns a set of assumptions into a decision pack with sensitivities, alternatives and a recommendation.",
    description: "A pilot for commercial analysts who build similar scenario packs over and over. It registers assumptions with owners, compares scenarios on the same basis, and drafts the pack with cited sources.",
    status: "pilot", kind: "configurable_product", ownerName: "Elena Petrova", ownerTeam: "Commercial Analytics",
    businessUnits: ["Commercial"], activeUsers: 22, evidenceLevel: "moderate", timeToAdopt: "4-6 weeks", adoptionEffort: "medium",
    workflowSteps: ["Ingest", "Analyze", "Review"], currentVersion: "1.0",
    versions: [{ version: "1.0", releasedAt: "2026-07-20", summary: "Pilot release." }],
    knownGaps: ["No approval routing.", "Pack layout is fixed."],
    dependencies: ["Price deck service", "Enterprise identity provider", "Approved LLM gateway"],
    capabilityIds: ["cap-identity", "cap-scenario-assumptions", "cap-scenario-compare", "cap-source-summarizer", "cap-audit"],
    businessProblemIds: ["bp-scenario-packs"],
    baselineMetrics: { taskMinutes: 600, successRate: 78, effortScore: 5.9, errorRate: 10, adoption: 45, costPerTask: 45 },
    retirementCandidate: false, architectureStatus: "Under review", controlStatus: "Identity and audit in place", supportModel: "Commercial Analytics, best effort", lastReviewedAt: "2026-07-20",
    intendedUsers: ["commercial analyst", "strategy analyst"], dataSources: ["price deck", "scenario assumptions"],
    keywords: ["scenario", "decision pack", "sensitivity", "commercial", "strategy", "assumptions", "alternatives", "recommendation"],
    businessFunction: "Commercial & Legal", primaryUsers: ["Commercial analyst"], workflowType: "Model and compare", outputType: "Decision pack",
    riskTier: "medium", dataInvolved: ["Price deck", "Scenario assumptions"], controls: [...SHARED_CONTROLS, "Assumption owner recorded"],
    execution: "preview",
    outputPreview: preview("Debottleneck decision pack · sample", ["Assumption register v3 (sample)", "Price deck Q3 2026 (sample)"], [
      { heading: "Assumptions", lines: ["Throughput uplift 4% (owner: Operations planning).", "Capital $18M ± 15% (owner: Projects).", "Price deck Q3 2026 base case."] },
      { heading: "Sensitivities and alternatives", lines: ["NPV most sensitive to throughput uplift: ±1 point moves NPV by $6M.", "Alternative: phased scope at $11M recovers 70% of the value."] },
      { heading: "Recommendation", lines: ["Proceed with phased scope; revisit full scope after the Q1 2027 price deck. [source: scenario comparison table]"] },
    ], "connecting the price deck service is what an execution engine for this family would need."),
  },
  {
    id: "sol-contract-review",
    name: "Contract Review Workbench",
    outcome: "Extracts the clauses that matter, rates deviations from standard terms, and routes the contract to the right approver.",
    description: "The certified Legal Operations product. Clause extraction, deviation rating against approved standard terms, evidence validation of the summary, and approval routing with segregation of duties. Its approval routing is reused by Finance, Investor Relations and Supply Chain.",
    status: "certified", kind: "complete_solution", ownerName: "Michael Tran", ownerTeam: "Legal Operations",
    businessUnits: ["Legal", "Supply Chain", "Commercial"], activeUsers: 130, evidenceLevel: "strong", timeToAdopt: "2-3 weeks", adoptionEffort: "low",
    workflowSteps: ["Ingest", "Analyze", "Review", "Decide", "Track"], currentVersion: "3.0",
    versions: [{ version: "3.0", releasedAt: "2026-05-02", summary: "Certified release; approval routing offered as a reusable module." }],
    knownGaps: ["Scanned contracts need OCR first."],
    dependencies: ["Contract repository", "Enterprise identity provider", "Approved LLM gateway"],
    capabilityIds: ["cap-identity", "cap-clause-extract", "cap-deviation-check", "cap-evidence-validator", "cap-approval-routing", "cap-audit", "cap-retention"],
    businessProblemIds: ["bp-contract-review"],
    baselineMetrics: { taskMinutes: 90, successRate: 92, effortScore: 4.2, errorRate: 3, adoption: 82, costPerTask: 9 },
    retirementCandidate: false, architectureStatus: "Approved reference architecture", controlStatus: "All mandatory controls in place", supportModel: "Legal Operations, business hours", lastReviewedAt: "2026-09-12",
    intendedUsers: ["contract analyst", "procurement specialist", "legal counsel"], dataSources: ["contracts", "standard terms"],
    keywords: ["contract", "clause", "legal", "procurement", "deviation", "standard terms", "review", "liability", "approval"],
    businessFunction: "Commercial & Legal", primaryUsers: ["Contract analyst", "Procurement specialist"], workflowType: "Extract, rate and approve", outputType: "Clause summary with risks",
    riskTier: "high", dataInvolved: ["Contracts", "Approved standard terms"], controls: [...SHARED_CONTROLS, "Segregation of duties on approval", "Retention policy"],
    execution: "preview",
    outputPreview: preview("Services agreement review · sample", ["Draft services agreement, 42 pages (sample)", "Approved standard terms v7 (sample)"], [
      { heading: "Clause summary", lines: ["Term: 3 years with two 1-year extensions.", "Liability cap: 100% of annual fees (standard: 150%).", "Termination for convenience: 90 days (standard: 60)."] },
      { heading: "Deviations and risks", lines: ["Liability cap below standard: high deviation.", "Indemnity excludes data breach: high deviation.", "Pricing index clause matches standard."] },
      { heading: "Approval routing", lines: ["Routed to Legal counsel (two high deviations); drafter cannot approve."] },
    ], "connecting the contract repository is what an execution engine for this family would need."),
  },
  {
    id: "sol-exec-briefing",
    name: "Executive Briefing Builder",
    outcome: "Gives leaders a one-page sourced briefing with the decisions needed and the risks emerging.",
    description: "A pilot run by the Corporate Strategy Office. Summarizes inputs with sources, assembles a one-page briefing and keeps a register of the decisions asked for. Its source-grounded summarizer is reused by Finance, Investor Relations and Commercial.",
    status: "pilot", kind: "complete_solution", ownerName: "Nadia Hussain", ownerTeam: "Corporate Strategy Office",
    businessUnits: ["Corporate"], activeUsers: 31, evidenceLevel: "moderate", timeToAdopt: "2-3 weeks", adoptionEffort: "low",
    workflowSteps: ["Ingest", "Analyze", "Review", "Track"], currentVersion: "1.4",
    versions: [{ version: "1.4", releasedAt: "2026-09-25", summary: "Evidence validator from ESG Evidence Hub." }, { version: "1.0", releasedAt: "2026-03-30", summary: "Pilot release." }],
    knownGaps: ["Inputs are uploaded by hand each week."],
    dependencies: ["Enterprise identity provider", "Approved LLM gateway"],
    capabilityIds: ["cap-identity", "cap-briefing-assemble", "cap-source-summarizer", "cap-evidence-validator", "cap-decision-register", "cap-audit"],
    businessProblemIds: ["bp-exec-briefing"],
    baselineMetrics: { taskMinutes: 240, successRate: 84, effortScore: 4.9, errorRate: 7, adoption: 58, costPerTask: 20 },
    retirementCandidate: false, architectureStatus: "Under review", controlStatus: "Identity, audit and validation in place", supportModel: "Corporate Strategy Office, best effort", lastReviewedAt: "2026-09-25",
    intendedUsers: ["executive assistant", "chief of staff", "strategy analyst"], dataSources: ["weekly reports", "board papers"],
    keywords: ["executive", "briefing", "leadership", "one page", "decision", "summary", "board", "weekly"],
    businessFunction: "Corporate & Executive", primaryUsers: ["Chief of staff", "Strategy analyst"], workflowType: "Summarize and brief", outputType: "One-page briefing",
    riskTier: "medium", dataInvolved: ["Weekly reports", "Board papers"], controls: [...SHARED_CONTROLS, "Every sentence cites its source"],
    execution: "preview",
    outputPreview: preview("Week 42 leadership briefing · sample", ["Weekly functional reports, week 41 (sample)", "Board paper 2026-09-B (sample)"], [
      { heading: "Situation", lines: ["HX-210 outage closed; September volume 1.8% under plan. [source: Ops weekly, p.2]", "Q4 turnaround schedule feasible with two contractor crews. [source: Planning weekly, p.1]"] },
      { heading: "Decisions needed", lines: ["Approve phased debottleneck scope ($11M). [source: Commercial pack, rec. 1]"] },
      { heading: "Emerging risks", lines: ["Single-sourced tube bundle with contract expiring in December. [source: Supply weekly, risk 3]"] },
    ], "a weekly upload step exists today; an execution engine would read the functional reports directly."),
  },
];

export const enterpriseBusinessProblems: BusinessProblem[] = [
  { id: "bp-management-reporting", title: "Monthly management reporting", businessFunction: "Finance", primaryUser: "Financial analyst", description: "Finance produces reconciled monthly results with consistent variance commentary for the controller.", activeSolutionIds: ["sol-mgmt-pack", "sol-variance-bot"], recommendedAction: "consolidate", status: "Decision pending" },
  { id: "bp-disclosure-drafting", title: "Outlook and disclosure drafting", businessFunction: "Investor relations", primaryUser: "Investor relations analyst", description: "Investor Relations drafts and proofs outlook materials that must be source-linked and review-ready.", activeSolutionIds: ["sol-disclosure-proof"], recommendedAction: "standardize", status: "Pilot" },
  { id: "bp-esg-evidence", title: "ESG disclosure evidence", businessFunction: "ESG & Regulatory", primaryUser: "Sustainability analyst", description: "Disclosure owners gather evidence that is spread across systems and show where coverage is missing.", activeSolutionIds: ["sol-esg-evidence-hub", "sol-emissions-collector"], recommendedAction: "consolidate", status: "Decision pending" },
  { id: "bp-integrated-planning", title: "Integrated plan feasibility", businessFunction: "Supply chain & Planning", primaryUser: "Planner", description: "Planners build schedules in separate tools with conflicting assumptions.", activeSolutionIds: ["sol-planning-assistant"], recommendedAction: "standardize", status: "Pilot" },
  { id: "bp-order-planning", title: "Order and inventory planning", businessFunction: "Supply chain & Planning", primaryUser: "Buyer", description: "Buyers align inventory, purchasing and operational demand.", activeSolutionIds: ["sol-supply-optimizer"], recommendedAction: "retain", status: "Certified" },
  { id: "bp-scenario-packs", title: "Scenario decision packs", businessFunction: "Commercial & Legal", primaryUser: "Commercial analyst", description: "Analysts build similar scenarios and decision packs over and over.", activeSolutionIds: ["sol-scenario-studio"], recommendedAction: "standardize", status: "Pilot" },
  { id: "bp-contract-review", title: "Contract review", businessFunction: "Commercial & Legal", primaryUser: "Contract analyst", description: "Contracts need repetitive clause extraction and risk review before approval.", activeSolutionIds: ["sol-contract-review"], recommendedAction: "retain", status: "Certified" },
  { id: "bp-exec-briefing", title: "Executive briefing", businessFunction: "Corporate & Executive", primaryUser: "Chief of staff", description: "Leaders receive large volumes of inconsistent information and need one sourced briefing.", activeSolutionIds: ["sol-exec-briefing"], recommendedAction: "standardize", status: "Pilot" },
];

/** Enterprise metadata for the operations products that already ship with an execution engine. */
export const OPERATIONS_META: Record<string, Pick<Solution, "businessFunction" | "primaryUsers" | "workflowType" | "outputType" | "riskTier" | "dataInvolved" | "controls" | "execution" | "outputPreview">> = {
  "sol-workorder-insight": { businessFunction: "Operations", primaryUsers: ["Maintenance supervisor", "Reliability engineer"], workflowType: "Review and approve", outputType: "Recurring-issue findings", riskTier: "medium", dataInvolved: ["Work-order notes", "Equipment master"], controls: [...SHARED_CONTROLS, "Supervisor approval", "Data retention policy"], execution: "live", outputPreview: null },
  "sol-site-pattern-finder": { businessFunction: "Operations", primaryUsers: ["Maintenance supervisor", "Site analyst"], workflowType: "Analyze", outputType: "Cross-site patterns", riskTier: "medium", dataInvolved: ["CSV work-order exports"], controls: [], execution: "live", outputPreview: null },
  "sol-action-tracker": { businessFunction: "Operations", primaryUsers: ["Maintenance supervisor", "Maintenance planner"], workflowType: "Track", outputType: "Action list", riskTier: "medium", dataInvolved: ["Findings entered by hand"], controls: [], execution: "live", outputPreview: null },
  "sol-procedure-finder": { businessFunction: "Operations", primaryUsers: ["Operator", "Technician"], workflowType: "Search", outputType: "Approved procedure", riskTier: "medium", dataInvolved: ["Standard operating procedures"], controls: [...SHARED_CONTROLS, "Version-controlled index"], execution: "live", outputPreview: null },
  "sol-sop-chat": { businessFunction: "Operations", primaryUsers: ["Operator", "Technician"], workflowType: "Ask and answer", outputType: "Cited answer", riskTier: "medium", dataInvolved: ["Standard operating procedures"], controls: ["Inherits ProcedureFinder controls"], execution: "live", outputPreview: null },
  "sol-incident-commander": { businessFunction: "Operations", primaryUsers: ["Safety lead", "Incident reviewer"], workflowType: "Review, decide and track", outputType: "Corrective action register", riskTier: "high", dataInvolved: ["Incident reports", "Safety management system"], controls: [...SHARED_CONTROLS, "Regulatory system of record", "Data retention policy"], execution: "live", outputPreview: null },
  "sol-handover-notes": { businessFunction: "Operations", primaryUsers: ["Shift supervisor"], workflowType: "Draft", outputType: "Handover summary", riskTier: "low", dataInvolved: ["Logbook export"], controls: [], execution: "live", outputPreview: null },
};

export const OPERATIONS_PROBLEM_META: Record<string, Pick<BusinessProblem, "businessFunction" | "primaryUser">> = {
  "bp-workorder-issues": { businessFunction: "Operations", primaryUser: "Maintenance supervisor" },
  "bp-procedure-search": { businessFunction: "Operations", primaryUser: "Operator" },
  "bp-incident-actions": { businessFunction: "Operations", primaryUser: "Safety lead" },
  "bp-shift-handover": { businessFunction: "Operations", primaryUser: "Shift supervisor" },
};
