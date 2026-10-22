import type { WorkOrder } from "./workorders";

/** One line of a produced output document. `key` is stable across runs so A and B can be diffed. */
export interface OutputItem {
  id: string;
  key: string;
  kind: string;
  text: string;
  detail: string | null;
  stepId: string;
  refs: string[];
  originStepId?: string;
  ranking?: { position: number; basis: string };
}

export interface OutputSection {
  key: string;
  title: string;
  stepId: string;
  items: OutputItem[];
}

export interface RunOutput {
  headline: string;
  sections: OutputSection[];
}

export interface StepTrace {
  stepId: string;
  name: string;
  stage: string;
  status: "ran" | "skipped" | "error";
  inputSummary: string;
  transformation: string;
  outputSummary: string;
  itemCount: number;
  durationMs: number;
  error: string | null;
  outputSections?: OutputSection[];
  outputSnapshotStatus?: "available" | "unavailable";
}

export interface RunStats {
  steps: number;
  sections: number;
  items: number;
  issues: number;
  patterns: number;
  actions: number;
  errors: number;
}

export interface Finding {
  site: string;
  tag: string;
  equipmentType: string;
  issue: string;
  refs: string[];
  dates: string[];
}

export interface Cluster {
  equipmentType: string;
  issue: string;
  tags: string[];
  sites: string[];
  refs: string[];
  latest: string;
  rank: number | null;
}

export interface FollowUpAction {
  id: string;
  text: string;
  owner: string;
  due: string;
  status: "Open";
  refs: string[];
  tag: string;
  issue: string;
}

/** Mutable state threaded through the executable steps of one run. */
export interface RunContext {
  input: string;
  config: Record<string, string>;
  notes: WorkOrder[];
  summaries: Map<string, string>;
  findings: Finding[];
  clusters: Cluster[];
  ranked: boolean;
  reviewThreshold: number;
  reviewItems: { label: string; refs: string[]; tag: string; issue: string; site: string }[];
  actions: FollowUpAction[];
  sections: OutputSection[];
  /** Free-form fields for the non-maintenance workflows */
  scratch: Record<string, unknown>;
}

export interface StepResult {
  inputSummary: string;
  transformation: string;
  outputSummary: string;
  itemCount: number;
}

export type StepExecutor = (ctx: RunContext) => StepResult;
