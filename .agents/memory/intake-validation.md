---
name: Intake as collaborative validation
description: User intent for the intake redesign and the boundary between confirmation and proof.
---

Intake should be one of FUSEBOX's most critical steps: validate understanding of the user's needs and the components/capabilities of presented prototypes or solutions through a highly interactive, iterative experience.

**Why:** The user wants smaller iterations and shared understanding before comparison or consolidation, not immediate recommendations from an unvalidated submission.

**How to apply:** Support business needs, existing prototypes/solutions, and configured agents. Interpret by input type, normalize a shared profile and deduplicated requirements, then let users correct and confirm. Corrections revisit affected interpretation before approval. Include drag-and-drop ordering of requirements by priority, with accessible click alternatives. Keep supplied statements, inferences, and open gaps distinct; confirming an accurate description is not evidence that a capability works. The provided slide's sequence is collect → extract by input type → normalize → validate with users → confirm intake and open gaps.

Intake outputs must visibly include a MECE requirements breakdown for business-problem inputs. Solution inputs must show both the understood business problem and the MECE supplied features/capabilities. Automatically suggest a representative descriptive name from the inputs, with user editing preserved.

Interpretation and analytical conclusions must use active AI analysis, not canned deterministic outputs or silent rule-based fallbacks.

**Why:** The user explicitly requested AI connections wherever required and rejected deterministic/automated outputs where active analysis and interpretation are expected.

**How to apply:** Configure and verify the provider, ground analysis in input/source evidence, and expose errors rather than substituting canned conclusions. Preserve deterministic calculations, authorization, source integrity and measured evidence; those are not interpretive judgments.

**Why:** The user reiterated that these breakdowns were still not visible and explicitly requested automatic descriptive naming.

**How to apply:** Treat these as reviewable intake outputs before comparison, not hidden interpretation data. Completeness is relative to supplied scope; expose gaps and inferences rather than inventing requirements or proof.

Saved group boundaries are user-owned scope decisions during reinterpretation, just like manually corrected statements. Preserve their meaning while invalidating affected reviews; regenerating only the name must not change the reviewed breakdown.

**Why:** Replacing a boundary can change what several otherwise unchanged requirements mean. Naming is a separate action and must not silently undo review work.

**How to apply:** Keep content preservation separate from confirmation validity: preserve corrections even before confirmation, but require re-review when their source, boundary, or linked clarification changes.

The approved canvas intake has a standalone artifact; the user subsequently chose to replace Discover's initial intake screen in Reuse Workbench with this design, keeping comparison results and IT Owner pages.

**Why:** The user explicitly selected “Replace Discover’s intake screen” when asked where to integrate the selected design.

**How to apply:** Preserve the standalone artifact and canvas reference. Integrate collection and iterative validation into Discover, then hand off confirmed needs to matching without reinterpreting them. Never turn confirmed intake into portfolio approval.

Intake's outcome is synthesis against the solution library, not a report or an IT Owner handoff. Library solutions should include ZIP files of functioning code and components. Evaluate existing capabilities, capabilities borrowed from multiple solutions, the best overall starting solution, and missing capabilities to create.

**Why:** The user explicitly corrected the report interpretation and confirmed this reuse-and-gap outcome. Descriptions alone are not the intended basis for comparison.

**How to apply:** Ground capability mappings in versioned solution elements and source evidence. Distinguish code-inspected capability claims from runtime verification, and proposed combinations from proven integrations. Do not fabricate functioning ZIP packages for preview-only catalogue entries.

The user chose the implemented demo solution as the first source-code-backed library assessment, before supplying external solution ZIPs.

**Why:** The user explicitly selected this starting point to keep the work iterative.

**How to apply:** Clearly scope coverage to the indexed local demo engine, not full enterprise integrations. Treat prohibitions such as “no automatic updates” as acceptance constraints to verify, never as missing features to build.

Acceptance runs deliberately verify narrowly stated observable demo outputs, not semantic fulfillment of the original requirement. Unknown behaviors, partial integrations, and prohibitions remain untestable rather than inheriting a green result from nearby output.

**Why:** A synthetic input can exercise a shared-engine element successfully while leaving the seeker's real requirement and production controls unproven. Treating these as equivalent would overstate the evidence.

**How to apply:** Keep the reviewed assertion alongside the original requirement in saved evidence. Changing assertion semantics must change the acceptance-plan version/fingerprint, even if the displayed assertion text stays the same. Never execute indexed or uploaded archive contents as part of this local-engine validation.
