import { Router, type IRouter } from "express";
import { AnalyzePrototypeBody, ListPrototypesQueryParams, RegisterPrototypeBody, type PrototypeDetail, type PrototypeIntake, type RegisteredPrototype } from "@workspace/api-zod";
import type { RegisteredPrototypeRow } from "@workspace/db";
import { getSolution, personas } from "../data/catalog";
import { analyzePrototype } from "../lib/prototype-intake";
import { getPrototypeRow, listPrototypeRows, registerPrototype, removePrototype, restorePrototype, toRegisteredPrototype } from "../lib/prototypes";
import { insertReuseEvent } from "../lib/reuse-store";

const router: IRouter = Router();

/** The analysis is recomputed from the stored examples and confirmed components; it is deterministic, so nothing is cached. */
export function prototypeDetail(row: RegisteredPrototypeRow): PrototypeDetail | null {
  const solution = getSolution(row.id);
  if (!solution) return null;
  const intake: PrototypeIntake = {
    name: row.name,
    platformKind: row.platformKind as PrototypeIntake["platformKind"],
    platformName: row.platformName,
    users: row.users,
    description: row.description,
    examples: row.examples.map((e) => ({ input: e.input, output: e.output, ...(e.sampleInputId ? { sampleInputId: e.sampleInputId } : {}) })),
    components: row.components.map((c) => ({ id: c.id, name: c.name, description: c.description, sectionTitles: c.sectionTitles })),
  };
  return { prototype: toRegisteredPrototype(row), solution, analysis: analyzePrototype(intake) };
}

router.get("/prototypes", (req, res) => {
  const parsed = ListPrototypesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const list: RegisteredPrototype[] = listPrototypeRows(parsed.data.comparedTo).map(toRegisteredPrototype);
  res.json(list);
});

router.post("/prototypes/analyze", (req, res) => {
  const parsed = AnalyzePrototypeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json(analyzePrototype(parsed.data));
});

router.post("/prototypes", async (req, res) => {
  const parsed = RegisterPrototypeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const intake = parsed.data;
  if (!intake.noRestrictedData) {
    res.status(400).json({ error: "Confirm that the examples contain no restricted data before registering." });
    return;
  }
  const analysis = analyzePrototype(intake);
  if (analysis.components.length === 0) {
    res.status(400).json({ error: "Keep at least one component so the library knows what the prototype does." });
    return;
  }
  const role = intake.createdByRole ?? "seeker";
  // Logged like a forward reuse check: the recommended path is what the library said. The path taken stays open
  // until someone acts on it: opening the experiment on the target product records "use"; a fold is only recorded
  // when a product owner or IT actually folds it (registration is not a fold). Registering something nothing in the
  // library produces is itself the "create" outcome.
  const event = await insertReuseEvent({
    trigger: "prototype",
    need: `${intake.name.trim()}: ${intake.description.trim()}`,
    baseSolutionId: analysis.targetSolutionId,
    caseId: null,
    briefId: null,
    bestScore: Math.max(0, ...analysis.components.map((c) => c.matchScore ?? 0)) || null,
    bestTitle: analysis.targetSolutionName,
    bestSolutionId: analysis.targetSolutionId,
    bestCapabilityId: analysis.components.find((c) => c.verdict === "duplicates")?.matchedCapabilityId ?? null,
    pathRecommended: analysis.recommendedPath === "fold_into" ? "improve_existing" : analysis.recommendedPath === "connect_module" ? "try_existing" : "new_experiment",
    pathTaken: analysis.recommendedPath === "register_new" ? "create" : null,
    actor: personas.find((p) => p.role === role)?.name ?? role,
    demo: false,
  });
  const row = await registerPrototype(intake, analysis, role, event.id);
  const detail = prototypeDetail(row);
  res.status(201).json(detail);
});

router.get("/prototypes/:prototypeId", (req, res) => {
  const row = getPrototypeRow(String(req.params["prototypeId"]));
  const detail = row && row.removedAt === null ? prototypeDetail(row) : null;
  if (!detail) {
    res.status(404).json({ error: "Prototype not found" });
    return;
  }
  res.json(detail);
});

router.delete("/prototypes/:prototypeId", async (req, res) => {
  const row = await removePrototype(String(req.params["prototypeId"]));
  if (!row) {
    res.status(404).json({ error: "Prototype not found" });
    return;
  }
  res.json(toRegisteredPrototype(row));
});

router.post("/prototypes/:prototypeId/restore", async (req, res) => {
  const row = await restorePrototype(String(req.params["prototypeId"]));
  if (!row) {
    res.status(404).json({ error: "Prototype not found" });
    return;
  }
  res.json(toRegisteredPrototype(row));
});

export default router;
