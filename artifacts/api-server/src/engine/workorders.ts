/**
 * Seeded maintenance work-order dataset used by the executable workflows.
 * Every sample input is plain text in the "WO | date | site | equipment | note" line format so
 * users can edit it, paste their own, or write free text (lines without separators are still parsed).
 */

export interface WorkOrder {
  id: string;
  date: string;
  site: string;
  /** Equipment tag such as P-104; empty when none could be found */
  tag: string;
  /** Equipment class such as "centrifugal pump" */
  equipmentType: string;
  note: string;
}

export interface ExpectedFinding {
  tag: string;
  issue: string;
  /** Expected number of supporting work orders */
  count: number;
}

export interface SampleInput {
  id: string;
  name: string;
  description: string;
  /** Solutions this input is realistic for */
  solutionIds: string[];
  text: string;
  /** Labelled recurring findings a correct analysis should produce (null = no ground truth) */
  expected: ExpectedFinding[] | null;
  noteCount: number;
}

const WO: Omit<WorkOrder, "id">[] = [
  { date: "2026-08-04", site: "Plant Ops North", tag: "P-104", equipmentType: "centrifugal pump", note: "Operator reports unusual vibration on P-104 during start-up. Bearing temperature slightly above normal. Monitoring." },
  { date: "2026-08-11", site: "Plant Ops North", tag: "HX-210", equipmentType: "heat exchanger", note: "HX-210 outlet temperature drifting high. Suspect fouling on tube side. Cleaning scheduled for next outage." },
  { date: "2026-08-18", site: "Plant Ops North", tag: "P-104", equipmentType: "centrifugal pump", note: "P-104 vibration again, worse at higher flow. Vibration analysis requested. Coupling alignment to be checked." },
  { date: "2026-08-19", site: "Plant Ops North", tag: "", equipmentType: "site lighting", note: "Replace two flood lights at the north gate parking lot. Not safety critical." },
  { date: "2026-08-25", site: "Plant Ops Central", tag: "C-301", equipmentType: "reciprocating compressor", note: "C-301 tripped on high discharge temperature. Restarted after cool-down. Intercooler fins look dirty." },
  { date: "2026-09-01", site: "Plant Ops North", tag: "P-104", equipmentType: "centrifugal pump", note: "Vibration alarm on P-104 overnight. Seal weeping slightly. Pump kept in service pending inspection." },
  { date: "2026-09-03", site: "Plant Ops Central", tag: "V-118", equipmentType: "separator vessel", note: "Level transmitter on V-118 reading erratic. Instrument tech recalibrated; reading stable since." },
  { date: "2026-09-08", site: "Plant Ops Central", tag: "C-301", equipmentType: "reciprocating compressor", note: "C-301 high discharge temperature trip repeated. Intercooler cleaned. Valve temperatures to be trended." },
  { date: "2026-09-10", site: "Plant Ops North", tag: "HX-210", equipmentType: "heat exchanger", note: "Small leak at HX-210 channel head gasket. Torqued bolts. Fouling still suspected; outlet temperature high." },
  { date: "2026-09-12", site: "Fleet Maintenance", tag: "FL-22", equipmentType: "forklift", note: "FL-22 rear tire replaced. Routine wear." },
  { date: "2026-09-15", site: "Plant Ops North", tag: "P-104", equipmentType: "centrifugal pump", note: "P-104 vibration readings 9.1 mm/s. Recommend bearing replacement and alignment check at next window." },
  { date: "2026-09-17", site: "Plant Ops South", tag: "P-220", equipmentType: "centrifugal pump", note: "P-220 vibration noticed by operator, similar signature to the P-104 reports. Bearing noise audible." },
  { date: "2026-09-22", site: "Plant Ops Central", tag: "C-301", equipmentType: "reciprocating compressor", note: "C-301 discharge temperature high again; trip avoided by reducing load. Suspect worn discharge valves." },
  { date: "2026-09-24", site: "Plant Ops North", tag: "", equipmentType: "perimeter fence", note: "Fence panel damaged near the laydown yard. Contractor to repair." },
  { date: "2026-09-29", site: "Plant Ops North", tag: "HX-210", equipmentType: "heat exchanger", note: "HX-210 fouling confirmed by pressure drop. Outlet temperature out of range. Chemical clean requested." },
  { date: "2026-10-02", site: "Plant Ops South", tag: "P-220", equipmentType: "centrifugal pump", note: "P-220 vibration alarm. Operator reports noise from the drive end bearing." },
];

export const workOrders: WorkOrder[] = WO.map((w, i) => ({ id: `WO-${1021 + i * 7}`, ...w }));

export function formatWorkOrders(list: WorkOrder[]): string {
  return list.map((w) => `${w.id} | ${w.date} | ${w.site} | ${w.tag ? `${w.tag} (${w.equipmentType})` : w.equipmentType} | ${w.note}`).join("\n");
}

const byTag = (tag: string) => workOrders.filter((w) => w.tag === tag);
const MAINTENANCE = ["sol-workorder-insight", "sol-site-pattern-finder", "sol-action-tracker"];

export const sampleInputs: SampleInput[] = [
  {
    id: "wo-single",
    name: "One work order",
    description: "A single P-104 vibration note. Enough to summarize, not enough to call anything recurring.",
    solutionIds: MAINTENANCE,
    text: formatWorkOrders([workOrders[2]!]),
    expected: [],
    noteCount: 1,
  },
  {
    id: "wo-related",
    name: "Five related notes",
    description: "Four P-104 vibration reports from Plant Ops North plus one unrelated lighting job.",
    solutionIds: MAINTENANCE,
    text: formatWorkOrders([...byTag("P-104"), workOrders[3]!].sort((a, b) => a.date.localeCompare(b.date))),
    expected: [{ tag: "P-104", issue: "vibration", count: 4 }],
    noteCount: 5,
  },
  {
    id: "wo-two-months",
    name: "Two months, three sites",
    description: "Sixteen work orders across three sites with recurring pump, exchanger and compressor problems and several distractors.",
    solutionIds: MAINTENANCE,
    text: formatWorkOrders(workOrders),
    expected: [
      { tag: "P-104", issue: "vibration", count: 4 },
      { tag: "HX-210", issue: "fouling", count: 3 },
      { tag: "C-301", issue: "high temperature", count: 3 },
      { tag: "P-220", issue: "vibration", count: 2 },
    ],
    noteCount: 16,
  },
  {
    id: "sop-query",
    name: "Procedure question",
    description: "A field question about an operating procedure.",
    solutionIds: ["sol-procedure-finder", "sol-sop-chat"],
    text: "What is the approved isolation sequence before opening the HX-210 channel head for cleaning?",
    expected: null,
    noteCount: 1,
  },
  {
    id: "incident-note",
    name: "Incident report",
    description: "A short incident narrative with follow-up commitments buried in the text.",
    solutionIds: ["sol-incident-commander"],
    text: "During the 06:00 round the operator found a small hydrocarbon drip at the HX-210 channel head. Area was barricaded and the unit was isolated by 06:40. Supervisor requested a gasket replacement before restart, an updated bolt torque procedure, and a toolbox talk for the night crew about reporting weeping flanges immediately.",
    expected: null,
    noteCount: 1,
  },
  {
    id: "shift-log",
    name: "Shift log",
    description: "A raw night-shift logbook entry.",
    solutionIds: ["sol-handover-notes"],
    text: "22:10 C-301 load reduced to 80% after discharge temp climbed to 142C. 23:30 P-104 vibration alarm acknowledged, pump kept running. 01:15 Lab called, sample results delayed until morning. 04:00 Fence contractor arrived early, escorted to laydown yard. Day shift: watch C-301 and chase lab results.",
    expected: null,
    noteCount: 1,
  },
];

export const sampleInputById = new Map(sampleInputs.map((s) => [s.id, s]));

export function sampleInputsFor(solutionId: string): SampleInput[] {
  return sampleInputs.filter((s) => s.solutionIds.includes(solutionId));
}

/** Parse the line-based text format. Free-text lines without separators become notes with inferred equipment. */
export function parseWorkOrders(text: string): WorkOrder[] {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((line, i) => {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length >= 5) {
      const equip = parts[3]!;
      const m = equip.match(/^([A-Z]{1,3}-\d{2,4})(?:\s*\((.+)\))?$/);
      return {
        id: parts[0]!,
        date: parts[1]!,
        site: parts[2]!,
        tag: m?.[1] ?? "",
        equipmentType: (m?.[2] ?? (m ? "" : equip)).toLowerCase(),
        note: parts.slice(4).join(" | "),
      };
    }
    const tag = line.match(/\b([A-Z]{1,3}-\d{2,4})\b/)?.[1] ?? "";
    return { id: `NOTE-${i + 1}`, date: "", site: "Unspecified site", tag, equipmentType: inferEquipmentType(line), note: line };
  });
}

function inferEquipmentType(text: string): string {
  const t = text.toLowerCase();
  if (/pump/.test(t)) return "pump";
  if (/compressor/.test(t)) return "compressor";
  if (/exchanger|hx-/.test(t)) return "heat exchanger";
  if (/vessel|separator/.test(t)) return "vessel";
  if (/valve/.test(t)) return "valve";
  if (/motor/.test(t)) return "motor";
  return "equipment";
}
