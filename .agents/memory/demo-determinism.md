---
name: Demo determinism rules
description: Constraints that keep the Reuse Workbench demo repeatable — seeded simulation, AI scope, int4 seed range.
---
- Simulation seeds are stored in a Postgres `integer` column; a 32-bit unsigned hash (`>>> 0`) overflows int4 and the insert fails with a 500. Mask seeds to 31 bits (`& 0x7fffffff`).
  **Why:** the first experiment insert failed silently from the UI's point of view (HTML 500 page) because of this.
- Interpretation, matching and consolidation rationale now require active, evidence-grounded AI, per the user's later explicit instruction. The former demo fallback rule is superseded: fail visibly when AI is unavailable, never substitute canned analysis. Unchanged saved analyses may be reused with provenance.
  **Why:** The user rejected deterministic output where active interpretation is expected.
  **How to apply:** Keep arithmetic, permissions, hashes, evidence checks and measured results deterministic; model conclusions are judgments, not metrics or execution proof. Initialize providers lazily so missing configuration produces an actionable request error rather than a startup crash.
