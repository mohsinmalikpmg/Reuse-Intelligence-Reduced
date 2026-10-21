import OpenAI from "openai";
import type { BriefFields, BriefRequirement, BriefSource } from "@workspace/api-zod";
import { DEMO_PROMPT } from "../data/catalog";
import { logger } from "./logger";

export interface ParsedBrief {
  fields: BriefFields;
  clarifyingQuestion: string | null;
  /** Short requirement phrases, derived from the desired outcome and the controls it implies */
  requirements: string[];
  source: BriefSource;
}

const FIELD_KEYS = [
  "user",
  "job",
  "currentProcess",
  "painPoint",
  "desiredOutcome",
  "constraints",
  "data",
  "requiredControls",
  "successMeasures",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Cached interpretation for the demonstration prompt. Guarantees the demo path never waits on the model. */
export const DEMO_BRIEF_FIELDS: BriefFields = {
  user: { value: "Maintenance supervisor", confidence: 0.96 },
  job: { value: "Identify recurring equipment issues from work-order notes", confidence: 0.94 },
  currentProcess: { value: "Manual weekly review of free-text work-order notes, with each site following its own approach", confidence: 0.9 },
  painPoint: { value: "Several hours of manual review each week and inconsistent results across sites", confidence: 0.93 },
  desiredOutcome: { value: "Faster, standardized identification of recurring issues across all sites", confidence: 0.88 },
  constraints: { value: "Must use existing work-order data; site-level variation in process and terminology", confidence: 0.8 },
  data: { value: "Work-order notes from the enterprise maintenance system; equipment master data", confidence: 0.86 },
  requiredControls: { value: "Supervisor approval before a finding becomes a maintenance action; audit trail; site-level data access", confidence: 0.7 },
  successMeasures: { value: "Review time per week, recurring-issue detection rate, consistency across sites", confidence: 0.85 },
};

/** Requirements behind the demonstration prompt. Each one is checked against the catalogue on Discover. */
export const DEMO_REQUIREMENTS: string[] = [
  "Identify recurring equipment issues from work-order notes",
  "Apply one standard review approach across all sites",
  "Supervisor approval before a finding becomes a maintenance action",
];

export function isDemoPrompt(text: string): boolean {
  return normalize(text) === normalize(DEMO_PROMPT);
}

export function aiAvailable(): boolean {
  return Boolean(process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] && process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]);
}

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (!aiAvailable()) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"],
      baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
      timeout: 15000,
      maxRetries: 1,
    });
  }
  return client;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fields: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        FIELD_KEYS.map((k) => [
          k,
          {
            type: "object",
            additionalProperties: false,
            properties: {
              value: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["value", "confidence"],
          },
        ]),
      ),
      required: [...FIELD_KEYS],
    },
    clarifyingQuestion: { type: ["string", "null"] },
    requirements: { type: "array", items: { type: "string" } },
  },
  required: ["fields", "clarifyingQuestion", "requirements"],
} as const;

const SYSTEM_PROMPT = `You interpret plain-language business pain points for an enterprise solution-reuse platform.
Extract a structured brief in plain business language (no technical jargon). Keep every value to one short sentence or phrase.
Fields: user (primary user role), job (job to be done), currentProcess, painPoint, desiredOutcome, constraints, data (data involved), requiredControls (approvals, audit, access controls that are likely required), successMeasures.
Give a confidence between 0 and 1 for each field; use lower confidence when you had to infer.
Ask at most ONE clarifying question, and only if a critical ambiguity would change which solution fits. Otherwise return null.
Also list 2 to 4 requirements: short imperative phrases (under 12 words) that a solution must satisfy, taken only from what the text says or clearly implies (the desired outcome and any approvals, audit or access controls). Do not invent requirements.`;

export async function parseBrief(text: string): Promise<ParsedBrief> {
  if (isDemoPrompt(text)) {
    return { fields: DEMO_BRIEF_FIELDS, clarifyingQuestion: null, requirements: DEMO_REQUIREMENTS, source: "cached" };
  }

  const openai = getClient();
  if (openai) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-5.6-luna",
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "pain_point_brief", strict: true, schema: RESPONSE_SCHEMA },
        },
      });
      const content = completion.choices[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content) as { fields: BriefFields; clarifyingQuestion: string | null; requirements?: unknown };
        const fields = sanitizeFields(parsed.fields);
        if (fields) {
          const fromModel = Array.isArray(parsed.requirements) ? parsed.requirements.filter((r): r is string => typeof r === "string" && r.trim().length >= 3).map((r) => r.trim()).slice(0, 4) : [];
          const requirements = fromModel.length > 0 ? fromModel : deriveRequirements(fields);
          return { fields, clarifyingQuestion: parsed.clarifyingQuestion ?? null, requirements, source: "ai" };
        }
      }
      logger.warn("AI brief parse returned an unusable payload; using deterministic fallback");
    } catch (err) {
      logger.warn({ err }, "AI brief parse failed; using deterministic fallback");
    }
  }

  const fallback = fallbackParse(text);
  return { ...fallback, requirements: deriveRequirements(fallback.fields), source: "fallback" };
}

function sanitizeFields(raw: unknown): BriefFields | null {
  if (!raw || typeof raw !== "object") return null;
  const out: Partial<Record<FieldKey, { value: string; confidence: number }>> = {};
  for (const key of FIELD_KEYS) {
    const f = (raw as Record<string, unknown>)[key];
    if (!f || typeof f !== "object") return null;
    const value = (f as Record<string, unknown>)["value"];
    const confidence = (f as Record<string, unknown>)["confidence"];
    if (typeof value !== "string") return null;
    const c = typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : 0.5;
    out[key] = { value: value.trim(), confidence: Math.round(c * 100) / 100 };
  }
  return out as BriefFields;
}

const ROLE_WORDS = [
  "maintenance supervisor",
  "shift supervisor",
  "supervisor",
  "business analyst",
  "analyst",
  "technician",
  "engineer",
  "planner",
  "operator",
  "manager",
  "nurse",
  "agent",
  "clerk",
  "auditor",
  "inspector",
  "team lead",
  "safety lead",
  "reviewer",
  "coordinator",
  "dispatcher",
];

/** Deterministic rule-based interpretation used when the model is unavailable. */
export function fallbackParse(text: string): Omit<ParsedBrief, "source" | "requirements"> {
  const lower = text.toLowerCase();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const first = sentences[0] ?? text;

  const role = ROLE_WORDS.find((r) => lower.includes(r));
  const user = role ? capitalize(role) : "Business user";

  const jobMatch = first.match(/\bto ([^.,;]+)/i);
  const job = jobMatch ? capitalize(jobMatch[1]!.trim()) : capitalize(first.replace(/^.*?\b(are|is)\b\s*/i, "").trim());

  const processMatch = lower.match(/(manually [^.,;]+|by hand[^.,;]*|spreadsheet[^.,;]*|email[^.,;]*)/);
  const currentProcess = processMatch ? capitalize(processMatch[1]!.trim()) : "Manual process described in the request";

  const painSentence = sentences.find((s) => /(hour|slow|manual|inconsisten|error|miss|delay|different|duplicate|hard)/i.test(s)) ?? first;
  const outcomeSentence = sentences.find((s) => /(want|need|should|goal|faster|reduce|improve|standard)/i.test(s));
  const desiredOutcome = outcomeSentence
    ? capitalize(outcomeSentence)
    : `Faster, more consistent way to ${job.charAt(0).toLowerCase() + job.slice(1)}`;

  const constraints: string[] = [];
  if (/site|location|region|plant/.test(lower)) constraints.push("Variation across sites or locations");
  if (/existing|current|legacy/.test(lower)) constraints.push("Must work with existing data and systems");
  if (constraints.length === 0) constraints.push("Not stated");

  const dataTerms = ["work-order notes", "work order notes", "tickets", "notes", "reports", "logs", "records", "emails", "documents", "spreadsheets", "procedures"];
  const data = dataTerms.filter((t) => lower.includes(t));

  const controls: string[] = [];
  if (/approv|sign-off|sign off/.test(lower)) controls.push("Approval before action");
  if (/audit|complian|regulat|safety/.test(lower)) controls.push("Audit trail");
  if (controls.length === 0) controls.push("Standard access control and audit trail (assumed)");

  const measures: string[] = [];
  if (/hour|time|week|day|minute/.test(lower)) measures.push("Time spent per cycle");
  if (/identif|detect|find|miss/.test(lower)) measures.push("Detection or completion rate");
  if (/consisten|different|standard/.test(lower)) measures.push("Consistency across teams");
  if (measures.length === 0) measures.push("Cycle time and quality of outcome");

  const fields: BriefFields = {
    user: { value: user, confidence: role ? 0.8 : 0.4 },
    job: { value: job, confidence: jobMatch ? 0.7 : 0.45 },
    currentProcess: { value: currentProcess, confidence: processMatch ? 0.65 : 0.4 },
    painPoint: { value: capitalize(painSentence), confidence: 0.6 },
    desiredOutcome: { value: desiredOutcome, confidence: outcomeSentence ? 0.6 : 0.4 },
    constraints: { value: constraints.join("; "), confidence: 0.45 },
    data: { value: data.length ? capitalize(data.join(", ")) : "Not stated", confidence: data.length ? 0.6 : 0.3 },
    requiredControls: { value: controls.join("; "), confidence: 0.4 },
    successMeasures: { value: measures.join(", "), confidence: 0.5 },
  };

  const clarifyingQuestion =
    data.length === 0 ? "Which data or documents does the team currently rely on for this task?" : null;

  return { fields, clarifyingQuestion };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The two editable cards shown on Discover: what happens today and what better looks like. Derived, never invented. */
export function deriveTodayBetter(fields: BriefFields): { today: string; better: string } {
  const sentence = (s: string) => {
    const t = s.trim().replace(/\s+/g, " ");
    if (!t) return "";
    const first = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?]$/.test(first) ? first : `${first}.`;
  };
  const today = sentence(fields.painPoint.value) || sentence(fields.currentProcess.value);
  const better = sentence(fields.desiredOutcome.value) || sentence(fields.successMeasures.value);
  return { today, better };
}

/**
 * Deterministic requirements list: the desired outcome split into its clauses, plus any stated control.
 * Used for the rule-based path and whenever "Better" is edited by hand. Never invents a requirement.
 */
export function deriveRequirements(fields: BriefFields, better?: string): string[] {
  const outcome = (better?.trim() || fields.desiredOutcome.value).replace(/[.!?]+$/, "");
  const clauses = outcome
    .split(/;|,\s+(?:and\s+)?|\s+and\s+(?=[a-z]{4,}\s)/i)
    .map((c) => c.trim())
    .filter((c) => c.split(/\s+/).length >= 2);
  const controls = fields.requiredControls.value
    .split(/;/)
    .map((c) => c.trim())
    .filter((c) => c && !/assumed|not stated/i.test(c));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of [...clauses, ...controls]) {
    const text = r.charAt(0).toUpperCase() + r.slice(1);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === 4) break;
  }
  return out.length > 0 ? out : [outcome.charAt(0).toUpperCase() + outcome.slice(1)].filter((t) => t.trim());
}

export function toRequirements(texts: string[], source: BriefRequirement["source"] = "derived"): BriefRequirement[] {
  const used = new Set<string>();
  return texts.map((text) => {
    let id = `req_${slug(text)}`;
    let n = 2;
    while (used.has(id)) id = `req_${slug(text)}_${n++}`;
    used.add(id);
    return { id, text, source };
  });
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
}
