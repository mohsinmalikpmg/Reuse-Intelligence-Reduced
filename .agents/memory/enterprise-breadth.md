---
name: Enterprise breadth without new engines
description: How the library was broadened beyond maintenance (preview products, execution flag, Decision View) and the honesty rules that go with it
---
Rule: a catalogued product either runs (`execution: "live"`, has executors in the engine) or only has a deterministic sample-data `outputPreview`. Preview products never run, never open cases, never appear as "Try in"/"addable" targets, and their preview is labelled "not a run, not evidence" wherever it is shown.

**Why:** the engine silently succeeds with 0 output lines for capabilities without executors, so an experiment on a preview product would show "same output" as if it were measured evidence. The brief forbids fabricated evidence and forbids building ten working domain workflows; the flag is the cheapest honest boundary.

**How to apply:** gate at the API (`requireExecutable` in run paths, 409 on `POST /cases`, `addableTo`/`tryIn` null) *and* in the UI (`isLive`). Work Order Intelligence stays the only live family; introduce it as "one example of the model". Shared cross-function capabilities (evidence validator, approval routing, source summarizer) are what makes the enterprise board interesting — keep them genuinely shared across families' `capabilityIds`.

Decision View: read-only, built from persisted records only; "measured value" lists only measured deltas and otherwise says "No measured value yet"; experiment-simulation recommendations are labelled as seeded simulations. `baselineMetrics.successRate` is already a percentage (72), not a ratio.
