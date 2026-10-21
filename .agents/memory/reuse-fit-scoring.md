---
name: Reuse-fit scoring lessons
description: Why the reuse-check scorer is a keyword scorer over the hand-written catalogue and the tuning traps that produced false "covered" verdicts.
---
Rule: tune reuse-fit by changing catalogue keywords/IO tables or the shared normaliser, never with per-need special cases or model calls.

**Why:** the client spec requires published weights and explainable "Why?" dimensions, and the user forbids fabricated numbers. With a catalogue of ~30 capabilities, inverse-document weighting makes rare generic verbs ("apply", "one") dominate, which once made a retention-policy step "cover" a cross-site review requirement.

**How to apply:**
- Keep the two guards: a single shared word is zero fit for needs with more than two known words, and generic verbs are stop words.
- Dimensions other than problem fit scale with relevance; without that, mature well-connected steps outscore the relevant one on maturity and control points alone.
- The matching stemmer maps "issues" and "issue" to different stems; the reuse scorer uses its own plural normaliser on purpose. Do not unify them without re-checking the demo verdicts.
- A hard-excluded option that scores >=60 is shown with its reason (UI and API) even when nothing viable exists; `best` and the recommended path ignore it.
- Portable capabilities (`portableTo`) are never auto-"covered" in the coverage table; they surface only through an explicit reuse check, which is what the demo relies on.
- Seeded demo reuse events are scored by the live scorer at reset so history cannot disagree with the product.
