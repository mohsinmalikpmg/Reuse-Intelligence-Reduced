---
name: Simplicity UX mandate
description: The user's non-negotiable UX rules for the workbench frontend and the verification lessons from the redesign.
---

The user's standing rule: "above all simplicity and tactile interaction, that's what will win." When adding anything to the frontend, keep the five-view structure (Describe → Match → Shape → Test → Decide), the information limits (≤3 options/reasons/metrics, 1 risk, 1 primary + 2 secondary actions, one sentence per card), and put everything else behind one drawer. Remove rather than add when in doubt.

**Why:** the user supplied a 550-line simplicity override spec (attached_assets/Pasted-NON-NEGOTIABLE-SIMPLICITY-OVERRIDE…); the full rules are summarised in replit.md "UX rules".

**How to apply:** no new pages or dashboards per role; role switch only changes copy/actions. Any new state change needs Undo. Keep the demo case seeded so the seeker has something to drag (recommended additions off).

Verification lessons:
- dnd-kit default `rectIntersection` picks the wrong step when the drag source is wide; use `pointerWithin` (with rect fallback).
- The testing subagent reported a false Undo failure and "clipped" drawers — both were stale/mid-animation screenshots. A scripted playwright-core run (chromium at /repl/tools/bin/chromium, `npm i playwright-core` in /tmp) is a cheap way to confirm before changing code.
