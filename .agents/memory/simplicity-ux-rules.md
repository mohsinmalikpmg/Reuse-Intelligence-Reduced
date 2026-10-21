---
name: Simplicity UX mandate
description: The user's non-negotiable UX rules for the workbench frontend and the verification lessons from the redesign.
---

The user's standing rule: "above all simplicity and tactile interaction, that's what will win." Keep the information limits (≤3 options/reasons/metrics, 1 risk, 1 primary + 2 secondary actions, one sentence per card). Remove rather than add when in doubt. The newer app-wide mandate below supersedes the old fixed-view and role-copy-only approach.

**Why:** the user supplied a 550-line simplicity override spec (attached_assets/Pasted-NON-NEGOTIABLE-SIMPLICITY-OVERRIDE…); the full rules are summarised in replit.md "UX rules".

**How to apply:** any new state change needs Undo. Keep the demo case seeded so the seeker has something to drag (recommended additions off). Role experiences now follow the newer mandate below, not the earlier copy/actions-only restriction.

## App-wide human-scale experience
The user confirmed that complexity is persistent across the app, including Library and Comparison—not just intake. Organize each view around one human decision and one primary action. Use plain-language outcomes; omit metrics unless they help that decision. Progressive disclosure alone is insufficient if the page still exposes the system's internal model.

**Why:** The user corrected a proposal to simplify only post-intake comparison, then explicitly confirmed app-wide simplification of navigation, page purposes and information hierarchy.

**How to apply:** Library starts from the user's need with a few concise solution cards and concrete input/output examples. Comparison offers one recommendation and at most two alternatives; introduce borrowed components and gaps after choosing a starting point, one decision at a time. Separate seeker and IT Owner workspaces, not merely role labels on equally dense screens. IT starts with what needs attention. Keep important limitations visible and technical evidence available on request.

Verification lessons:
- dnd-kit default `rectIntersection` picks the wrong step when the drag source is wide; use `pointerWithin` (with rect fallback).
- The testing subagent reported a false Undo failure and "clipped" drawers — both were stale/mid-animation screenshots. A scripted playwright-core run (chromium at /repl/tools/bin/chromium, `npm i playwright-core` in /tmp) is a cheap way to confirm before changing code.

## Shell navigation decision (Oct 21, 2026)
The user reversed the earlier "keep the top nav" rule: the shell moves to the Power Cube kit's 224px Electric Ink left sidebar (icon rail on tablet, top bar with menu on mobile), still with the same six destinations and no added controls. Landed Oct 21, 2026: sticky offsets now derive from the `--shell-top` CSS variable (top-bar height), never a hard-coded pixel value. Only one sidebar variant (full or icon rail, chosen with matchMedia) is mounted at a time — rendering both with CSS `hidden` duplicated every `link-nav-*`/`button-reset-demo` test id and broke strict-mode locators. Sora is for the page h1 only; h2/h3 stay Inter so cards do not get heavier.
**Why:** the user felt the kit's design theme was invisible in the app and chose the sidebar when asked.
**How to apply:** do not reintroduce a top primary nav; group destinations under the stages 01 Trace / 02 Connect + Energize / 03 Converge.

## Reuse prompts never fire per keystroke
Any input whose purpose is a reuse check ("What should happen here?", "It must also...") submits explicitly (Enter/button). A covered requirement shows a one-line note, not options.
**Why:** every check is a logged reuse event feeding the IT metrics; per-keystroke checks would flood them, and offering options for something Version A already does is noise.
**How to apply:** new reuse-check entry points in any surface follow the same submit-then-options shape; keep scores behind "Why?".
