---
name: Workbench mapped-lanes layout
description: Non-obvious constraints of the A/B lanes workbench page (sticky offsets, Version A gaps, scripted drag checks)
---
- Every `sticky` offset on the page (pinned input bar, workflow map, row `scroll-margin`, schematic inspectors) must be expressed from the shell's top-bar height variable (`--shell-top`), e.g. `calc(var(--shell-top) + Nrem)`, never a literal pixel/rem value.
  **Why:** two shells in a row broke this: a literal `top-14` slid the input bar under the old nav, and the old header's literal `101px` had to be hunted down across five files when the shell changed.
  **How to apply:** if the top bar height changes, change the variable only; when adding a pinned element, derive from it.
- Version A (`/solutions/:id/workbench` blocks) omits base optional steps that are off in production. A base step missing from A is "off in A", not "B-only"; only non-base optional capabilities are B-only.
- Scripted drag checks: the map tray is inside a sticky, internally scrolling column. Hovering a handle may scroll the window, so pick a drop slot by bounding box that is actually inside the viewport; dnd-kit reports "dropped" with no target for off-screen slots. This is a test-geometry issue, not an app bug.
- dnd-kit droppables must keep `setNodeRef` on one element that exists in both the idle and dragging render; swapping the ref between a compact button and an expanded drop zone leaves dnd-kit with the pre-drag rect (the resize observer ignores a newly observed element's first callback), so `isOver` never fires.
  **Why:** the schematic sockets were unreachable by drag until the ref moved to a stable wrapper.
- dnd-kit auto-scrolls the window when the pointer is within ~20% of its edge, so a drop target near the bottom of the viewport moves away mid-drag. Scripted drags should centre the target first; this is the same geometry issue as above.
