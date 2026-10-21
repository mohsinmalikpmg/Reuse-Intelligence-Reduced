---
name: Solution package evidence boundaries
description: Authorization and evidence rules for uploaded solution ZIPs
---

Treat ZIP management as a privileged account action, not a demo-persona action. New accounts must not gain IT permissions automatically.

**Why:** the workbench persona switch is for exploring workflows, not an authenticated authorization boundary. Uploaded enterprise source needs a real server-side permission check.

**How to apply:** preserve explicit administrative grants when adding management features; never derive upload/review permissions from a selected persona or request body.

Keep uploader claims, static source mappings, and executed sandbox results distinct. Approval of a file mapping does not establish runtime behavior or make a preview product executable.

**Why:** ZIP intake is intentionally non-executing. Human-reviewed source evidence cannot prove full requirements, integration compatibility, or production readiness.

**How to apply:** downstream assessment must preserve provenance and test scope rather than treating an approved ZIP as a passed acceptance test.
