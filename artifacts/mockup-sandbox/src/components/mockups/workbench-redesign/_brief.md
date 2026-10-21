# Design brief — Workbench redesign (Cenovus | Solutions)

## Product
"Cenovus | Solutions" is an internal reuse-first tool for an energy company. A maintenance supervisor (not a developer) finds a governed solution that already exists, tries it on real sample data, and proves a proposed change (Version B) against the current product (Version A) side by side — real outputs, real diff, recorded human preference — before an owner and IT decide. The page being redesigned is the **Workbench**: the place where the user runs the workflow, edits Version B, and compares A against B.

It must feel calm, tactile, and trustworthy: one question at a time, a few objects on screen, one dominant action, details revealed by clicking in — never a wall of panels. The user said: "above all simplicity and tactile interaction", and asked for a "step-wise, consumable, but not rigid (as in one screen at a time only)" interface where they can "click in and out of workflow components" and see "the A/B workflows side by side as vertical flows so step for step the changes or deviations can be observed".

## Component analysis (what the current workbench does)
- Function: run a workflow on an input; create a Version B by adding/removing/toggling steps; compare A vs B on the same input; vote A/B/Neither; invite blind testers; propose a limited pilot.
- Content model: input (sample picker + text), workflow steps (ordered, each required / configurable / optional, some "added from another solution"), per-step run trace (what it received, what it did, what it produced, item count, ms), output (headline + sections of lines), diff (added / removed / changed lines each attributed to a responsible step), recorded measures (counts only, precision/recall when labelled), vote + summary, actions (Try another input, Invite testers, Propose limited pilot).
- Interaction model today: three panels (input+tray | workflow strip | output) and three mode tabs (Run / Version B / Compare A/B); Compare is a second screenful (two horizontal workflow strips, two outputs, diff list, measures table, vote, action row). Steps open a side drawer.
- Problem: everything is visible at once; the horizontal strips make A/B deviations hard to read; the drawer pulls the eye away from the flow.

## Hard constraints (keep in every variant)
- All features remain reachable: Run; Create/edit B (add a step by click; toggle optional steps; change a setting; remove an added step; Undo; Reset B); Compare (Run both); the diff with click-to-responsible-step; per-step trace; vote A / B / Neither with reason; recorded measures (never invent numbers — only counts from runs, and precision/recall vs labelled findings); Try another input; Invite testers; Propose limited pilot.
- Brand: Inter; slate #365860 (primary, headings), sienna #C5683B (Version B / proposals / recommendations), green #8A9A36 (approved / certified), light blue #6E9EAF, background #F7F8F6, cards white, text #26373B / muted #647174, borders #E3E8E7. No purple, no gradients, no emojis. WCAG AA contrast.
- Simplicity rules: one dominant action per state; at most three primary objects visible at once; details behind a click; every double-click has a single-click alternative.
- Page chrome: keep a thin version of the app header (text logo "Cenovus | Solutions", nav Discover / Library / Workbench / My Solutions / Portfolio with Workbench active) so the mockup reads as a page of the product.

## Variation axes (chosen)
1. Structural — how the page is organised (single spine of stages / the comparison as the page / map + focus panel).
2. Behavioral — how detail is disclosed (collapsible stages / row expansion in two lanes / one step in focus with a map).
Aesthetic treatment is held fixed (brand above). Content is held fixed (demo data below).

## Demo content (use exactly; this is real output from the engine)
Case title: "Work Order Intelligence" · base solution: Work Order Triage (certified) · status: Tested · input: "Two months, three sites" (16 notes, labelled findings).

Version A steps (production, locked): 1 Read work orders (required) · 2 Summarize notes (configurable: "Approved model: Enterprise LLM") · 3 Identify equipment concerns (required) · 4 Review queue thresholds (configurable: "Flag after 3 occurrences") · 5 Supervisor approval (required) · 6 Site routing rules (configurable: "Route by site") · 7 Notifications (configurable: "Daily digest") · 8 Weekly report view (optional, on) · Executive summary digest (optional, off).

Version B = A plus two added steps: "Cluster similar issues" (added from Pattern Finder, sits after Identify equipment concerns) and "Follow-up actions" (added from Action Tracker, sits after Notifications). Controls kept in both: Identity, Audit log, Retention.

Per-step traces (A and B identical unless noted):
- Read work orders — in: 2,590 characters of text · did: parsed each line into work order id, date, site, equipment tag and note · out: 16 work orders
- Summarize notes — in: 16 free-text notes · did: enterprise model: issue label plus the leading sentence of each note · out: 16 summaries
- Identify equipment concerns — in: 14 tagged work orders · did: extracted equipment tag and issue type per note, counted repeats of the same tag and issue within a site · out: 6 concerns, 4 recurring within a site
- Cluster similar issues (B only) — in: 14 tagged work orders · did: grouped notes by equipment class and issue type across all sites; kept groups with two or more reports · out: 3 cross-site patterns
- Review queue thresholds — A in: 6 concerns, 0 patterns → out: 3 items · B in: 6 concerns, 3 patterns → out: 3 items (different ones) · did: queued anything with 3+ reports for a supervisor; filed the rest
- Supervisor approval — in: 3 review items · did: marked every review item as held until a supervisor approves it · out: 3 held for approval
- Site routing rules — in: 3 review items · did: route by site · out: 2 queues (B: changed 2 lines because its input changed upstream)
- Notifications — in: 3 review items · did: daily digest through the enterprise notification channel · out: 2 recipients
- Follow-up actions (B only) — in: 3 patterns, 6 concerns · did: created one tracked action per recurring equipment problem, assigned a site owner and a due date 14 days out · out: 4 actions
- Weekly report view — in: run totals · did: added the standard weekly report line · out: 1 report line

Output headline — A: "16 work orders · 4 recurring concerns" · B: "16 work orders · 4 recurring concerns · 3 cross-site patterns · 4 tracked actions". Run time A 1 ms, B 1 ms. Items A 33, B 40. Sections: Work orders read; Issue summaries; Recurring concerns; Recurring patterns (B only); Supervisor review queue; Routing; Notifications; Follow-up actions (B only); Weekly report.

Diff: 10 added · 3 removed · 2 changed · 28 unchanged. Responsible steps: Review queue thresholds (6 changes), Follow-up actions (4), Cluster similar issues (3), Site routing rules (2).
Example diff lines:
- added · Recurring patterns · Cluster similar issues: "Centrifugal pump vibration: 6 reports across 2 sites (P-104, P-220)."; "Heat exchanger fouling: 3 reports across 1 site (HX-210)."; "Reciprocating compressor high temperature: 3 reports across 1 site (C-301)."
- added · Supervisor review queue · Review queue thresholds: "Centrifugal pump vibration (P-104, P-220): 6 reports — needs supervisor review." (and HX-210, C-301 equivalents)
- removed · Supervisor review queue · Review queue thresholds: "P-104 vibration at Plant Ops North: 4 reports — needs supervisor review."; "HX-210 fouling at Plant Ops North: 3 reports — needs supervisor review."
- changed · Routing · Site routing rules: "Plant Ops North planner: Centrifugal pump vibration (P-104, P-220); Heat exchanger fouling (HX-210)."
- added · Follow-up actions · Follow-up actions: "Inspect bearings and check coupling alignment on P-104 — owner: Plant Ops North reliability engineer · due 2026-11-03"; "Schedule chemical clean and pressure-drop check for HX-210 — owner: Plant Ops North reliability engineer · due 2026-11-03"; "Inspect discharge valves and intercooler on C-301 — owner: Plant Ops Central reliability engineer · due 2026-11-03"
Explanation lines: "Review queue thresholds (from Work Order Triage) added 3 lines, removed 3 because its input changed upstream." · "Follow-up actions (from Action Tracker) added 4 lines because it only runs in Version B." · "Cluster similar issues (from Pattern Finder) added 3 lines because it only runs in Version B." · "Site routing rules (from Work Order Triage) changed 2 because its input changed upstream."
Against labelled expected findings: A 4/4 found · 0 false positives · precision 100% · recall 100%; B 4/4 found · 0 false positives · precision 100% · recall 100%. Caption: "A longer or more detailed output is not evidence that it is more accurate."
Votes recorded so far: 1 for B (reason: "Cross-site patterns are what we actually chase."), 0 for A, 0 neither. Summary line must come only from recorded votes.
Available capabilities to add (tray): recommended — Cluster similar issues (Pattern Finder), Follow-up actions (Action Tracker); more — Similarity search (Pattern Finder), Executive summary digest.
People: Alex Romero (seeker, signed in), role switcher Find / Own / Govern.

## Deliverable rules (all variants)
- One self-contained React component (Tailwind utility classes; local state for interactivity). Import `./_group.css` and wrap everything in `<div className="cv-root min-h-screen">`. Use the CSS variables from that file (e.g. `style={{ color: "var(--cv-slate)" }}` or arbitrary classes like `text-[var(--cv-slate)]`).
- Make it genuinely clickable so the user can feel the interaction model: stages/rows/steps open and close on click, the vote buttons toggle, keyboard focus is visible. No fake variant switchers, no data fetching.
- Render the page in the **Compare** state (Version B has the two added steps, the comparison has been run, one vote exists) because that is where the current design is most overloaded — but make it obvious how the same structure looks before a comparison exists (e.g. a collapsed/quiet state for parts that are not yet relevant).
- Desktop width 1280. The iframe is 1280×900; the page may scroll inside it.
- No emojis. No gradients. No purple.
