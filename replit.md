# Reuse Workbench

A reuse-first AI solution discovery and consolidation decision workbench: a seeker describes a pain point in plain language, the app shows what already exists, lets them assemble and simulate a consolidated version, and routes the proposal through owner and IT decisions.

## Run & Operate

- `artifacts/api-server: API Server` workflow — Express API (`pnpm --filter @workspace/api-server run dev`)
- `artifacts/workbench: web` workflow — React/Vite frontend at `/` (`pnpm --filter @workspace/workbench run dev`)
- `pnpm run typecheck` — full typecheck. Run `pnpm run typecheck:libs` first after changing anything in `lib/` or the api-server typecheck sees stale lib output.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate React Query hooks and Zod schemas after editing `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`. Optional: `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` (Replit OpenAI integration) — without them the interpreter falls back to cached/rule-based parsing and the demo still works.
- Reset the demo: "Reset demo" button in the header, or `POST /api/demo/reset`.
- Demo deep links: append `?as=seeker|owner|it` to any route to sign in as that persona.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; DB: PostgreSQL + Drizzle ORM; Validation: Zod v4; codegen: Orval
- Frontend: React 19 + Vite, Tailwind, shadcn/ui, wouter, TanStack Query, framer-motion
- AI: OpenAI via Replit AI Integrations (brief interpretation only)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth); generated clients in `lib/api-client-react`, `lib/api-zod`
- `lib/db/src/schema/` — persisted tables: `briefs`, `cases`, `experiments`, `decisions`
- `artifacts/api-server/src/data/catalog.ts` — solution catalog: personas, 7 solutions, capabilities, business problems, synthetic user profiles, demo prompt (TS constants, not DB)
- `artifacts/api-server/src/lib/` — `matching` (brief → ranked solutions), `brief-parser` (AI / cached / rule-based), `configuration` (module toggles, conflicts, impact), `simulation` (seeded synthetic test), `analysis` (recommendation, compare, review, pilot plan, decision rules), `seed` (demo reset), `store` (DB access)
- `artifacts/api-server/src/routes/` — `library`, `briefs`, `cases`, `overview` (home views, portfolio, decision queue, demo reset)
- `artifacts/workbench/src/pages/` — login, home (per role), discover, brief, library, solution, cases, workspace (Overview/Compare/Configure/Test), review, experiments, portfolio, queue
- `artifacts/workbench/src/lib/persona.tsx` — persona stored in localStorage; role drives navigation and allowed actions

## Architecture decisions

- The catalog is code, not data: solutions/capabilities are constants so the demo is deterministic and resettable. Only briefs, cases, experiments and decisions are persisted.
- Simulation numbers never come from the LLM. `runSimulation` uses a mulberry32 PRNG seeded from a fixed constant XOR a hash of the configuration, so the same configuration always produces the same result. Seeds are masked to 31 bits to fit a Postgres `integer` column.
- AI is used only to interpret the pain point into the "What I heard" brief. The demo prompt uses a cached interpretation; any other text goes to OpenAI with a 15s timeout and falls back to rule-based parsing. `source` on the brief records which path ran.
- Matching: readiness and evidence are scaled by relevance (semantic score), so a mature product for a different problem cannot outrank a relevant pilot. A solution is only "recommended" with fit ≥ 30; results below fit 20 are dropped.
- Candidate modules for a case are capabilities from other solutions sharing the base's business problem. A candidate conflicting with a base capability is "incompatible" if its risk class is high, otherwise "duplicate/retiring". Any configuration change invalidates the previous simulation (case returns to draft).
- Decision flow: draft → simulated → pilot_proposed → approved / changes_requested / deferred / rejected. Seeker can only approve a simulation; owner approves pilots; IT approves consolidation. Rejections require a reason. Owner approval is not downgraded by IT approval.

## Product

- Personas: Alex Romero (seeker), Priya Natarajan (owner of WorkOrder Insight, ProcedureFinder, Incident Commander), Jordan Okafor (IT). No passwords; switch roles from the header.
- Anchor demo: maintenance work-order triage with three overlapping products (WorkOrder Insight certified, Site Pattern Finder pilot, Maintenance Action Tracker unowned prototype). Recommended path: base on WorkOrder Insight, add clustering + action tracking, retire Action Tracker.
- Demo reset seeds `brief_demo` (confirmed), `case_demo` (draft, recommended config) and `case_procedure_search` (already simulated and proposed, so the owner and IT queues are populated).

## Gotchas

- Run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck`.
- Restart the API workflow after backend edits (it runs a build, not a watcher).
- Pilot plan thresholds and guardrails are derived from the base solution's locked capabilities; keep catalog `controlType`/`category` accurate.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
