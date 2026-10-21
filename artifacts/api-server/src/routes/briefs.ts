import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { CreateBriefBody, UpdateBriefBody, type Brief, type MatchResult } from "@workspace/api-zod";
import { briefsTable, db, findCaseForBrief, getBrief, listBriefs, newId, toBrief } from "../lib/store";
import { deriveTodayBetter, parseBrief } from "../lib/brief-parser";
import { matchBrief } from "../lib/matching";

const router: IRouter = Router();

router.get("/briefs", async (_req, res) => {
  res.json(await listBriefs());
});

router.post("/briefs", async (req, res) => {
  const parsed = CreateBriefBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Describe the pain point in at least a short sentence." });
    return;
  }
  const text = parsed.data.text.trim();
  const interpretation = await parseBrief(text);
  const id = newId("brief");
  const { today, better } = deriveTodayBetter(interpretation.fields);
  const provisional: Brief = {
    id,
    rawText: text,
    fields: interpretation.fields,
    today,
    better,
    clarifyingQuestion: interpretation.clarifyingQuestion,
    clarification: null,
    source: interpretation.source,
    valueStatement: "",
    confirmed: false,
    createdAt: new Date().toISOString(),
  };
  const outcome = matchBrief(provisional);
  const [row] = await db
    .insert(briefsTable)
    .values({
      id,
      rawText: text,
      fields: interpretation.fields,
      today,
      better,
      clarifyingQuestion: interpretation.clarifyingQuestion,
      clarification: null,
      source: interpretation.source,
      valueStatement: outcome.valueStatement,
      confirmed: false,
    })
    .returning();
  res.status(201).json(toBrief(row!));
});

router.get("/briefs/:briefId", async (req, res) => {
  const brief = await getBrief(String(req.params["briefId"]));
  if (!brief) {
    res.status(404).json({ error: "Brief not found" });
    return;
  }
  res.json(brief);
});

router.patch("/briefs/:briefId", async (req, res) => {
  const brief = await getBrief(String(req.params["briefId"]));
  if (!brief) {
    res.status(404).json({ error: "Brief not found" });
    return;
  }
  const parsed = UpdateBriefBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const fields = { ...brief.fields };
  for (const [key, value] of Object.entries(parsed.data.fields ?? {})) {
    if (typeof value === "string" && key in fields) {
      const k = key as keyof Brief["fields"];
      // A user-edited field is confirmed by the user, so confidence becomes 1.
      fields[k] = { value, confidence: value.trim() === brief.fields[k].value.trim() ? brief.fields[k].confidence : 1 };
    }
  }
  // Editing the Today / Better cards is the user confirming those facts, so they flow back into the matched fields.
  const today = parsed.data.today?.trim() || brief.today;
  const better = parsed.data.better?.trim() || brief.better;
  if (parsed.data.today?.trim() && today !== brief.today) fields.painPoint = { value: today, confidence: 1 };
  if (parsed.data.better?.trim() && better !== brief.better) fields.desiredOutcome = { value: better, confidence: 1 };
  const updated: Brief = {
    ...brief,
    fields,
    today,
    better,
    clarification: parsed.data.clarification ?? brief.clarification,
    confirmed: parsed.data.confirmed ?? brief.confirmed,
  };
  const outcome = matchBrief(updated);
  const [row] = await db
    .update(briefsTable)
    .set({ fields, today, better, clarification: updated.clarification, confirmed: updated.confirmed, valueStatement: outcome.valueStatement })
    .where(eq(briefsTable.id, brief.id))
    .returning();
  res.json(toBrief(row!));
});

router.get("/briefs/:briefId/matches", async (req, res) => {
  const brief = await getBrief(String(req.params["briefId"]));
  if (!brief) {
    res.status(404).json({ error: "Brief not found" });
    return;
  }
  const outcome = matchBrief(brief);
  const existing = await findCaseForBrief(brief.id);
  const result: MatchResult = {
    briefId: brief.id,
    headline: outcome.headline,
    matches: outcome.matches,
    capabilityMatches: outcome.capabilityMatches,
    missingRequirements: outcome.missingRequirements,
    existingCaseId: existing?.id ?? null,
  };
  res.json(result);
});

export default router;
