import { test } from "node:test";
import assert from "node:assert/strict";
import { briefAnalysisSchema, parseBrief } from "./brief-parser";
import { DEMO_PROMPT } from "../data/catalog";

test("legacy brief rejects malformed or invented field shapes", () => {
  assert.equal(briefAnalysisSchema.safeParse({ fields: {}, requirements: [], clarifyingQuestion: null }).success, false);
});
test("provider failure for ordinary AND former demo input never returns canned/fallback data", async () => {
  const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  delete process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  try {
    for (const text of ["Nurses need to shorten patient handover time.", DEMO_PROMPT]) {
      await assert.rejects(parseBrief(text), /not configured/);
    }
  } finally {
    if (key !== undefined) process.env.AI_INTEGRATIONS_OPENAI_API_KEY = key;
  }
});
test("empty/oversized briefs fail before a provider request", async () => {
  await assert.rejects(parseBrief(" "), /Describe/);
  await assert.rejects(parseBrief("x".repeat(80001)), /too large/);
});
