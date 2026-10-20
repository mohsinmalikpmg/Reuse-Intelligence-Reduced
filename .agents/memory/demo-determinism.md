---
name: Demo determinism rules
description: Constraints that keep the Reuse Workbench demo repeatable — seeded simulation, AI scope, int4 seed range.
---
- Simulation seeds are stored in a Postgres `integer` column; a 32-bit unsigned hash (`>>> 0`) overflows int4 and the insert fails with a 500. Mask seeds to 31 bits (`& 0x7fffffff`).
  **Why:** the first experiment insert failed silently from the UI's point of view (HTML 500 page) because of this.
- The LLM is only used to interpret the pain point into the brief; every number shown (fit scores, impact, simulation metrics) comes from deterministic code. Keep it that way so demo runs match.
- User confirmed direction: the demo must work with AI unavailable (cached interpretation for the demo prompt + rule-based fallback), so never import an OpenAI client that throws at module load when env vars are missing — create the client lazily.
