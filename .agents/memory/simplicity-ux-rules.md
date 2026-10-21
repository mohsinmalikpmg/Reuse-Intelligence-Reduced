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

## Shell navigation decision (Oct 21, 2026)
The user reversed the earlier "keep the top nav" rule: the shell moves to the Power Cube kit's 224px Electric Ink left sidebar (icon rail on tablet, top bar with menu on mobile), still with the same six destinations and no added controls. Once that lands, the 101px two-band header offset noted in the lanes-layout memory no longer applies; sticky offsets come from the slim top bar.
**Why:** the user felt the kit's design theme was invisible in the app and chose the sidebar when asked.
**How to apply:** do not reintroduce a top primary nav; group destinations under the stages 01 Trace / 02 Connect + Energize / 03 Converge.

## Reuse prompts never fire per keystroke
Any input whose purpose is a reuse check ("What should happen here?", "It must also...") submits explicitly (Enter/button). A covered requirement shows a one-line note, not options.
**Why:** every check is a logged reuse event feeding the IT metrics; per-keystroke checks would flood them, and offering options for something Version A already does is noise.
**How to apply:** new reuse-check entry points in any surface follow the same submit-then-options shape; keep scores behind "Why?".
