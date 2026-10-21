# Cenovus | Solutions (Reuse Workbench)

A reuse-first solution discovery and A/B workbench: a maintenance supervisor describes a problem in plain language, finds that a governed solution already exists, tries it on real sample data, and proves a proposed change side by side against the current product (real outputs, real diff, recorded human preference) before owner and IT decisions.

## Run & Operate

- `artifacts/api-server: API Server` workflow — Express API (`pnpm --filter @workspace/api-server run dev`)
- `artifacts/workbench: web` workflow — React/Vite frontend at `/` (`pnpm --filter @workspace/workbench run dev`)
- `pnpm run typecheck` — full typecheck. Run `pnpm run typecheck:libs` first after changing anything in `lib/` or the api-server typecheck sees stale lib output.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate React Query hooks and Zod schemas after editing `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`. Optional: `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` — without them the interpreter falls back to cached/rule-based parsing and the demo still works.
- Reset the demo: "Reset demo" in the header, or `POST /api/demo/reset`.
- Demo deep links: append `?as=seeker|owner|it` to any route to sign in as that persona.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; DB: PostgreSQL + Drizzle ORM; Validation: Zod v4; codegen: Orval
- Frontend: React 19 + Vite, Tailwind, shadcn/ui, wouter, TanStack Query, dnd-kit (drag), @xyflow/react (Library tree view)
- AI: OpenAI via Replit AI Integrations (brief interpretation only; never produces numbers or outputs)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth); generated clients in `lib/api-client-react`, `lib/api-zod`
- `lib/db/src/schema/` — persisted tables: `briefs` (with `today`/`better`), `cases` (incl. jsonb `requirements` added in the workbench and `capability_requests`), `decisions`, `runs`, `evaluations`, `test_sessions`, `search_events`, `reuse_events` (every reuse check: trigger, need, best score, path recommended/taken, `demo` flag) (`experiments` is legacy synthetic simulation, unused by the UI)
- `artifacts/api-server/src/data/catalog.ts` — solution catalog: personas, 7 solutions, capabilities, business problems (TS constants, not DB)
- `artifacts/api-server/src/engine/` — the executable workflow engine: `workorders.ts` (16 seeded work orders, sample inputs incl. labelled expected findings), `steps.ts` (one deterministic executor per capability id; `EXECUTORS` order = execution order; capabilities without an executor are controls), `run.ts` (`executeWorkflow`), `diff.ts` (line diff by stable item keys + precision/recall vs labelled findings)
- `artifacts/api-server/src/lib/` — `workbench` (Version A = base defaults, Version B = case config; runs, comparison, explanation), `workbench-store` (runs/evaluations/sessions/search events), `evidence` (defensible A/B evidence from persisted data only), `matching` (brief → ranked solutions; `searchLibrary` hybrid global search), `brief-parser` (AI / cached / rule-based; `deriveTodayBetter`, `deriveRequirements`), `reuse-check` (deterministic reuse-fit scorer + requirement coverage), `reuse-store` (reuse events), `configuration` (module toggles, conflicts, portable modules), `analysis` (recommendation, review, pilot plan, decision rules), `seed` (demo reset), `store` (DB access)
- `artifacts/api-server/src/routes/` — `library` (solutions, `/search`), `briefs`, `cases`, `workbench` (solution workbench, sample inputs, runs, compare, evaluations, blind sessions), `overview` (my-solutions, portfolio, demo reset), `reuse` (`POST /reuse-check`, reuse events)
- `artifacts/workbench/src/pages/` — `/` sign-in, `/discover`, `/library`, `/solutions/:id`, `/search`, `/workbench/:caseId` (mapped A/B lanes: pinned input bar, sticky workflow map, step-aligned Version A / Version B rows with in-place expansion, Output and Verdict rows; `components/wb-lanes.tsx`), `/test/:sessionId` (blind tester view), `/my-solutions`, `/portfolio`. `components/frame.tsx` = header (nav, global search, Find/Own/Govern switcher, Reset demo)
- `artifacts/workbench/src/lib/persona.tsx` — persona in localStorage (`?as=` deep link); `lib/case.tsx` — current case id in localStorage, defaults to the demo case

## UX rules (spec + user mandate: simplicity and tactile interaction above everything)

- Six destinations only: Discover, Library, Workbench, My Solutions, Portfolio, plus the global search page. Roles never get separate dashboards; Find/Own/Govern only changes the available actions.
- One question or recommendation per screen, ≤3 primary objects, one dominant action; details behind expand / drawer. Every double-click action has a single-click alternative.
- Brand: slate blue #365860 (nav, primary, headings), sienna #C5683B (recommendations, A/B accents), green #8A9A36 (certified/approved), light blue #6E9EAF, bg #F7F8F6, text #26373B / #647174, borders #E3E8E7, Inter. No purple, no gradients.
- Drag-and-drop (dnd-kit) always has a click alternative; every change offers Undo. Drop target is decided by the pointer (`pointerWithin`), not by rect overlap.
- Discover shows editable "Today" and "Better" cards (not Pain/Need sections), an "It must" requirements list (derived from Better; add/edit/remove with Undo) and, under the best match, a coverage table. Only uncovered rows are clickable; the reuse check runs on request and shows at most two existing options (score ≥60) plus the create path. No banners.
- Workbench: no mode tabs or step drawer. The workflow map is an overview and jump list (scroll-spy highlight, Expand all / Collapse all), never a one-row stepper; rows open and close independently. Version B is edited inside its lane (switches, selects, Remove, "+ Add a step" slots that are also drop targets). Exactly one dominant button per state: Run (B equals A, no comparison) → Run both (B differs or stale) → vote → Propose limited pilot.
- Reuse-first additions in the workbench (`components/wb-reuse.tsx`): "+ Add a step" asks "What should happen here?" first and runs the reuse check on submit (trigger `add_step`); it shows at most the best capability (Try / See output example from its home product's saved run / Improve), the closest configuration or experiment, and "Create a different approach", which asks "What is missing?" and records a capability request (`POST /cases/{id}/capability-requests`). Requests render as dashed "Requested: …" rows and map entries after the step they were asked for; they are not capabilities, so runs and diffs never include them. "Browse capabilities" (the old tray) stays reachable. "Add a requirement" in the pinned bar appends to the case (`POST /cases/{id}/requirements`, trigger `add_requirement`), reports whether Version A already covers it, and offers the same options; a covered requirement shows nothing to add. Options appear only at score ≥60 (hard-excluded ones with their reason); scores stay behind "Why?"; everything is undoable. Changed output lines carry provenance ("Added by Safety Signals · from Incident Commander") from `DiffEntry.workflowStep`/`addedModule`.

## Architecture decisions

- Never fabricate an A/B advantage. Outputs are produced by actually executing both versions on the same input; the diff and the responsible steps come from the run traces; precision/recall appear only for inputs with labelled expected findings; summaries are computed only from recorded votes (blind votes and demo votes are labelled). The proposed version's production `performance` is `null` on purpose.
- The catalog is code, not data. Persisted: briefs, cases, decisions, runs, evaluations, test sessions, search events.
- A case doubles as a change proposal / A-B experiment: Version A = base solution production defaults, Version B = the case's moduleStates/configValues. Every new case starts with B equal to A (additions from other solutions off) so "Try this solution" shows the product as it is; the tray marks the recommended additions. The first `POST /cases/{id}/compare` moves a draft case to `tested`; any configuration change returns it to `draft` and marks older comparisons `staleB`.
- jsonb does not preserve key order: compare config objects by sorted entries, never by `JSON.stringify`.
- Blind sessions store pairs as `sampleInputId:runAId:runBId:left`; left/right is derived from the run id so it is stable but not guessable from order. Session responses are evaluations with `blind=true`.
- Decision flow: draft → tested → pilot_proposed → approved / changes_requested / deferred / rejected. Seeker proposes the pilot; owner approves/requests changes/rejects/defers; IT approves the consolidation direction (does not change case status). Rejections require a reason.
- AI is used only to interpret the pain point into the brief (cached for the demo prompt, 15s timeout, rule-based fallback). Editing Today/Better writes back into `painPoint`/`desiredOutcome` so matching follows the user's words. Editing Better re-derives the derived requirements (rule-based, instant) and keeps user-added ones.
- Reuse-fit scoring (`lib/reuse-check.ts`) is deterministic: problem fit 30 / input-output 20 / workflow position 15 / user context 10 / data-control 15 / maturity-evidence 10. Paths: ≥80 try existing, 60–79 start from and improve, <60 new experiment allowed; hard exclusions (cannot consume the base's output, control conflict, missing dependency, deprecated or unowned retirement candidate) override the score. Problem fit is DF-weighted over catalog words and needs ≥2 shared words; the other dimensions scale with relevance. Coverage: the best capability ≥60 decides — from the recommended product → covered, from a same-business-problem sibling → covered by a reusable capability, otherwise uncovered.
- Portable modules: a capability may declare `portableTo` business problems (Safety Signals from Incident Commander → work-order triage). It appears in the tray of cases for those problems and is recommended only when a brief requirement calls for it; sibling-solution candidates and lineage are unchanged. A case created from a reuse check (`moduleIds`, `reuseEventId`) starts with that module on in Version B and records the path taken.

## Product

- Personas: Alex Romero (seeker), Priya Natarajan (owner of Work Order Triage, ProcedureFinder, Incident Commander), Jordan Okafor (IT). No passwords; switch roles from the header.
- Anchor demo: Work Order Triage (certified) + Pattern Finder (pilot) + Action Tracker (unowned prototype) → consolidated "Work Order Intelligence". Turning clustering off removes pattern findings; removing action tracking removes the action output; a different input changes the findings.
- Demo reset seeds `brief_demo` (confirmed; three derived requirements plus the added "Flag maintenance issues that may create a safety risk", which only Safety Signals covers), six demo-labelled reuse events, `case_demo` (draft; Version B equals Version A until the seeker adds clustering/actions) and `case_procedure_search` (run on the sample question, two demo-labelled votes for B, pilot proposed).

## Gotchas

- Run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck`.
- Restart the API workflow after backend edits (it runs a build, not a watcher).
- Running a TS script against api-server code: bundle with esbuild from `artifacts/api-server` (`npx esbuild scripts/x.ts --bundle --platform=node --format=esm --packages=external --outfile=/tmp/x.mjs`) and run with node; `scripts/safety-check.ts` and `scripts/reuse-check-try.ts` are examples (engine safety output; reuse-fit scores for sample needs).
- Orval: an operation with both path and query params generates `XxxParams` in both the types and zod outputs and the re-exports collide; avoid that combination (return a list instead and filter client-side).
- Browser journeys: Playwright scripts under `/tmp/pw` (chromium at `/repl/tools/bin/chromium`, base `http://localhost:80`, `?as=seeker` to pass the persona gate); the preview screenshot tool cannot pass the gate.
- Pilot plan thresholds and guardrails are derived from recorded evidence and the base solution's locked capabilities; keep catalog `controlType`/`category` accurate.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
