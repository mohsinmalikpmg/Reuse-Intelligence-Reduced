---
name: FUSEBOX circuit feedback
description: Rules for the four circuit experiences (Trace, Connect, Energize, Converge) so animation never claims more than the backend has done
---
Every circuit effect is driven by persisted or returned backend state, never by the user's intent:
- Connect: weld/seat plays only in the PUT configuration onSuccess, and only if the returned config shows the capability active. Sockets (drop targets) are cyan when ready, orange when hovered. Blocked tray cards show the reason and a lock, no drag handle.
- Energize: runs finish in ~1ms so the "running" panel is rarely visible; illumination uses `diff.stepsResponsible` from the real comparison (rows + workflow-map numbers) for ~2.4s. Nothing lights when nothing changed.
- Converge: three states from `successor` — null = "Illustrative preview" (grey dashed), draft = "Awaiting IT approval" (live traces, unlit cube), current = "Converged · vN" (draw-in animation, cube spark). Component is keyed by successor state so a persisted approval replays it once.
**Why:** the design kit and the user both forbid simulated success, evidence or approvals; the demo audience is IT governance.
**How to apply:** when adding any new animated feedback, find the server response or persisted field that proves the state first; if none exists, label the visual illustrative.
Pitfall: Playwright drag checks must pick a drop slot inside the viewport, and the page scrolls to the opened row after an add, so screenshot the row element rather than the viewport.
