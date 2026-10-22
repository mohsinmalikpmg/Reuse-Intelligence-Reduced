---
name: A/B evidence rules
description: Why the workbench executes real workflows and how "never fabricate an advantage" is enforced; Orval and jsonb pitfalls met on the way.
---
Rule: every A/B number shown must be traceable to a persisted run, a labelled sample input, or a recorded vote. No projections for the proposed version.

**Why:** the client spec (Cenovus) states "never fabricate A/B advantages"; an earlier synthetic-simulation Test view was rejected for exactly that reason.

**How to apply:** new measures go through the engine (`engine/`) or the evaluations table; if a number cannot be computed from stored data, show "not measured" rather than an estimate. Demo-seeded votes must carry `demo=true` and be labelled in the UI.

Rule 2: a vote is evidence only for the exact configuration it was cast on. Runs and votes carry a server-computed configuration fingerprint; any aggregate counts only current-fingerprint votes and reports older ones as "set aside" (never merged, never silently dropped). Votes on stale pairs are refused server-side, not just disabled in the UI.

**Why:** the client wants evidence tied to the exact Version B; a vote cast before a module was toggled says nothing about the configuration being promoted. Reporting set-aside counts keeps the history honest instead of making votes disappear when B changes.

**How to apply:** when adding any new vote-derived number, filter through the current fingerprints first and surface the set-aside count next to it. Any seed that inserts evaluations must copy the fingerprints from the runs it references, or the seeded votes count as set aside.

Pitfalls hit:
- Step results must represent the output at that step's execution time, not final output rewritten downstream. Attribute ranking/presentation changes to their writer and distinguish them from new findings.
  **Why:** Ranking rewrote clustering's lines; the UI falsely blamed clustering/upstream input and showed blank A step results despite identical findings.
  **How to apply:** Preserve immutable step evidence; never reconstruct missing historical step output from the final result. Do not infer causality from a text difference alone.
- Orval: an operation with path + query params emits `XxxParams` in both generated outputs and `lib/api-zod/src/index.ts` re-export collides. Design such endpoints as list responses instead.
- Postgres jsonb reorders object keys; compare stored config to live config by sorted entries, not JSON.stringify.
- `performance.now()` deltas round to 0 ms for tiny steps; clamp durations to >= 1 so "0 ms measured" never appears.
