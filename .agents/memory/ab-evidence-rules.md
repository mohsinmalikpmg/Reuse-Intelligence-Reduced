---
name: A/B evidence rules
description: Why the workbench executes real workflows and how "never fabricate an advantage" is enforced; Orval and jsonb pitfalls met on the way.
---
Rule: every A/B number shown must be traceable to a persisted run, a labelled sample input, or a recorded vote. No projections for the proposed version.

**Why:** the client spec (Cenovus) states "never fabricate A/B advantages"; an earlier synthetic-simulation Test view was rejected for exactly that reason.

**How to apply:** new measures go through the engine (`engine/`) or the evaluations table; if a number cannot be computed from stored data, show "not measured" rather than an estimate. Demo-seeded votes must carry `demo=true` and be labelled in the UI.

Pitfalls hit:
- Orval: an operation with path + query params emits `XxxParams` in both generated outputs and `lib/api-zod/src/index.ts` re-export collides. Design such endpoints as list responses instead.
- Postgres jsonb reorders object keys; compare stored config to live config by sorted entries, not JSON.stringify.
- `performance.now()` deltas round to 0 ms for tiny steps; clamp durations to >= 1 so "0 ms measured" never appears.
