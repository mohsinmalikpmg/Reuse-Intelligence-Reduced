---
name: Workbench mapped-lanes layout
description: Non-obvious constraints of the A/B lanes workbench page (sticky offsets, Version A gaps, scripted drag checks)
---
- The app header is two bands (56px bar + 44px nav + border ≈ 101px). Anything `sticky` on a page must offset from 101px, not `top-14`; the pinned input bar adds ~75px more, so the map and row `scroll-margin` sit at ~12rem.
  **Why:** the first cut used `top-14` and the input bar slid under the nav.
- Version A (`/solutions/:id/workbench` blocks) omits base optional steps that are off in production. A base step missing from A is "off in A", not "B-only"; only non-base optional capabilities are B-only.
- Scripted drag checks: the map tray is inside a sticky, internally scrolling column. Hovering a handle may scroll the window, so pick a drop slot by bounding box that is actually inside the viewport; dnd-kit reports "dropped" with no target for off-screen slots. This is a test-geometry issue, not an app bug.
