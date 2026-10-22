# Forecast to Report — runnable integration proof

A bounded integration using **original Python calculation modules**, not a
rewrite of their formulas. Synthetic data only.

## Edit wiring inside FUSEBOX

Open **Workbench → Finance wiring** (also accessible from Library), at
`/workbench/wiring`. You do not need to edit source code:

- Inspect the actual source → adapter → reporting connections and contracts.
- Select forecast method, cost centres, assumption account, amount and report period.
- Expand account mappings to route expense accounts to supported reporting accounts.
- Validate, then run to see source-calculated account totals and differences.
- Sign in with your account to save an immutable version and its execution result.
- Discard unsaved edits, restore a previous saved version, or undo a restore.
- Download the runnable ZIP for an explicitly selected saved version.

The editor drives `finance/wiring.py` through the authenticated application's
bounded `/api/finance-wiring` endpoints; it is not a diagram over hidden fixed
wiring. Source identity/sign/unit restrictions are visible blockers, not guesses.
Saved versions are private to the signed-in user; demo personas are not permissions.
See `WIRING.md` for persistence, exact export behavior and supported connections.

## Run here

The registered web artifact is **Forecast to Report**, preview `/finance-demo/`.
Its own managed workflow runs:

```sh
pnpm --filter @workspace/finance-consolidation-demo run dev
```

Managed workflow supplies `PORT` and `BASE_PATH`. Vite serves both the React UI
and an artifact-local API middleware. Each calculation launches the fixed Python
worker with a scrubbed environment and private temporary databases.

## Standalone/import-ready project

Copy this directory (excluding node_modules, dist, caches and generated output)
to a new project directory. No parent workspace files, shared TypeScript config,
catalog versions, shared API clients or credentials are required.

Requirements: **Node 22.12+**, pnpm 10+, **Python 3.11+ with sqlite3** and writable
`/tmp`. Python dependencies are all standard library; no pip install.

```sh
pnpm install
PORT=3000 BASE_PATH=/ pnpm dev
# Open http://localhost:3000

pnpm typecheck
python3 -B tests/run_evidence.py

# Built frontend with the same local API middleware:
PORT=3000 BASE_PATH=/ pnpm build
PORT=3000 BASE_PATH=/ pnpm serve
```

Keep BASE_PATH identical at build and serve, with leading/trailing slashes.
`serve` uses Vite preview with the fixed Python middleware; **static hosting alone
will not work**. This is a bounded development/demo server, not a hardened
production deployment. The artifact registration is metadata for this workspace;
new project registration/hosting is a separate operation. This task does not
claim a new Replit import, publication, or exporter integration.

## Try it

1. Initial load executes baseline (0) while offering `360` as an unapplied input.
2. Select **Apply**: Q4 expenses increase $360 and operating profit decreases $360.
3. Each monthly report changes by $120. Revenue and COGS do not change.
4. Try `1` or an empty field: validation prevents Apply; the API also rejects it.
5. Reset runs zero on the server and restores the baseline. Repeating Apply does
   not accumulate adjustments. Reload begins a new baseline demonstration.
6. Expand source details to see the exact original member paths and hashes.

No data survives requests; simultaneous users have separate scenarios.
Failures retain the labelled last successful result and offer retry.

## Tests and evidence

```sh
# JSON output includes passing tests, negative/rejection tests and known result.
python3 -B tests/run_evidence.py
# Optional local evidence, ignored by Git:
mkdir -p generated-artifacts
python3 -B tests/run_evidence.py > generated-artifacts/evidence.json
# HTTP checks against a running instance:
python3 -B tests/test_http.py http://localhost:3000/
```

`evidence.json` is the recorded engine evidence snapshot; `http-evidence.json`
records transport checks, including rejection of an oversized multi-chunk body
and a successful calculation afterward. Neither replaces rerunning checks.
`SOURCE-REVIEW.md` contains the independent arithmetic and
review boundaries. Tests cover cents/dollars, signs, account sums, Q4 alignment,
closed months, null future actuals, missing fields/mappings, duplicate grains,
repeat application, atomic rejection, negative adjustments, concurrent
isolation and original source bytes. Original ZIP preservation is additionally
verified when the archives remain in the enclosing workspace.

## Handoff inventory

- `provenance.json`: archive and source SHA-256, exact paths and sizes.
- `vendor/{forecast,reporting}`: only four reviewed, unchanged source modules.
- `finance/adapter.py`: validated contract and atomic ledger replacement.
- `finance/fixtures.py`: deterministic private synthetic fixtures.
- `finance/harness.py`: reusable `run(adjustment)` entry point and source loading.
- `worker.py`: bounded JSON stdin/stdout executable interface.
- `finance-plugin.ts`: HTTP wiring/process limits.
- `src/finance-api.ts`: artifact-local typed request/response interface.
- `CONTRACT.md`: identity, period, scenario, money and missing-data rules.
- `SOURCE-REVIEW.md`: capability inventory, side-effect review, expected evidence.
- `package.json`: scoped JS requirements and run/build/test commands.
- `tests/`: local engine and HTTP checks; no external credentials required.

The dedicated Workbench Wiring download now packages a saved configuration with
the reviewed modules and a dependency-free Python demonstration server/UI.
It executes the same wiring on import; no Node install or original archives are
required. The existing general solution exporter and library app links remain
separate; this addition does not claim every solution can be wired this way.

A future general exporter can consume this directory as a cohesive recipe: include
the four vendor files and hashes, adapter/harness/fixtures/worker, frontend and
middleware, dependency manifest and these contracts/tests. Preserve the USD
integer-cent bridge and temporary-database isolation. Do not attach original
reporting commentary/exports to the lifted ledger without an explicit dollar
conversion. It must verify source licensing/hosting permission separately.
No changes to the existing general exporter or library-link contract are introduced.
