---
name: Solution package evidence boundaries
description: Authorization and evidence rules for uploaded solution ZIPs
---

Treat ZIP management as a privileged account action, not a demo-persona action. New accounts must not gain IT permissions automatically.

**Why:** the workbench persona switch is for exploring workflows, not an authenticated authorization boundary. Uploaded enterprise source needs a real server-side permission check.

**How to apply:** preserve explicit administrative grants when adding management features; never derive upload/review permissions from a selected persona or request body.

Source registration is IT setup, not a step for a solution seeker completing intake.

**Why:** the user approved separating these after intake exposed a registration action their account could not perform.

**How to apply:** let seekers use the registered library; keep registration in the IT Owner view with a real account entitlement. Missing setup must be stated plainly, not bypassed by granting rights or relabeling every forbidden request as a permission failure.

Keep uploader claims, static source mappings, and executed sandbox results distinct. Approval of a file mapping does not establish runtime behavior or make a preview product executable.

**Why:** ZIP intake is intentionally non-executing. Human-reviewed source evidence cannot prove full requirements, integration compatibility, or production readiness.

**How to apply:** downstream assessment must preserve provenance and test scope rather than treating an approved ZIP as a passed acceptance test.

## Workbench output goal
The user wants the Workbench to produce an integrated, importable Replit ZIP that combines features from library solution sources and, when provided, the user's supplied solution sources. A diagram, configuration export, or collection of untouched archives is not that deliverable.

**Why:** The user explicitly described the output as standing up the required solution and demonstrating successful consolidation.

**How to apply:** preserve source lineage; package actual wiring and runnable code; test the extracted artifact against requirements. Distinguish implemented features from open build gaps with concise statuses. The user strongly approved the simplified visual Workbench proposal as the direction to retain.

## Export/import evidence boundary

An extracted trusted demo ZIP passing tests does not verify the user's Replit
import or deployed app. Keep workspace and published links separate and
user-entered; never infer deployment URLs or claim an import occurred from a
button click. Uploaded finance products remain source material until an
explicitly agreed composition addresses dollar/cents conversion and schemas.

**Why:** The requested scope excludes unattended provisioning, arbitrary
uploaded-code execution and automatic finance-product merging.

**How to apply:** preserve immutable export lineage and exact-output test
evidence; leave external launch awaiting import or link recorded/unverified
until actual user-participating launch verification is available.

## Exported UI evidence

Check the mounted exported application, not just a successful HTTP response and
engine tests.

**Why:** a relative-asset build can serve valid HTML and pass all domain tests
while its client router shows a missing-page screen at the exported root.

**How to apply:** when changing export routing or build bases, include one
extracted-bundle UI check. Report remote-browser connectivity limitations
separately from direct local HTTP and calculation checks.
