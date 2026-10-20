import type {
  CaseStatus,
  DecisionAction,
  EvidenceLevel,
  ExperimentRecommendation,
  FeatureState,
  Role,
  SolutionKind,
  SolutionStatus,
} from "@workspace/api-client-react";

export type Tone = "ok" | "signal" | "warn" | "bad" | "ink" | "muted";

export const solutionStatus: Record<SolutionStatus, [string, Tone]> = {
  certified: ["Certified", "ok"],
  pilot: ["Pilot", "ink"],
  experimental: ["Experimental", "warn"],
  deprecated: ["Deprecated", "muted"],
};

export const caseStatus: Record<CaseStatus, [string, Tone]> = {
  draft: ["Draft", "muted"],
  simulated: ["Simulated", "ink"],
  pilot_proposed: ["Pilot proposed", "signal"],
  approved: ["Approved", "ok"],
  changes_requested: ["Changes requested", "warn"],
  deferred: ["Deferred", "muted"],
  rejected: ["Rejected", "bad"],
};

export const featureState: Record<FeatureState, [string, Tone]> = {
  required: ["Required", "ink"],
  configurable: ["Configurable", "muted"],
  optional: ["Optional", "muted"],
  incompatible: ["Incompatible", "bad"],
  recommended: ["Recommended", "signal"],
  retiring: ["Retiring", "warn"],
};

export const evidence: Record<EvidenceLevel, [string, Tone]> = {
  strong: ["Strong evidence", "ok"],
  moderate: ["Moderate evidence", "ink"],
  limited: ["Limited evidence", "warn"],
  none: ["No evidence", "bad"],
};

export const kind: Record<SolutionKind, string> = {
  complete_solution: "Complete solution",
  configurable_product: "Configurable product",
  capability_module: "Capability module",
  prototype: "Prototype",
};

export const recommendation: Record<ExperimentRecommendation, [string, Tone]> = {
  proceed_to_pilot: ["Proceed to pilot", "ok"],
  revise_configuration: ["Revise configuration", "warn"],
  gather_more_evidence: ["Gather more evidence", "ink"],
  do_not_proceed: ["Do not proceed", "bad"],
};

export const actionLabel: Record<DecisionAction, string> = {
  approve_simulation: "Proposed controlled pilot",
  approve_pilot: "Approve pilot",
  request_changes: "Request changes",
  defer: "Defer",
  reject: "Reject",
  approve_consolidation: "Approve consolidation",
};

export const roleLabel: Record<Role, string> = {
  seeker: "Solution Seeker",
  owner: "Solution Owner",
  it: "IT Leader",
};

export const fmt = (n: number) => n.toLocaleString("en-US");
export const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
export const date = (s: string) =>
  new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const initials = (name: string) =>
  name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
