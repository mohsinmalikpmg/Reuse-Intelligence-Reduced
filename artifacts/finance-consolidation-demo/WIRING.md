# Editable Workbench finance wiring

The original fixed proof remains `/finance-demo/`. The editable workflow is now
inside FUSEBOX at `/workbench/wiring`, with entry links from Workbench and Library.
The user explicitly requested this in-product control; source-file editing is
not the expected workflow.

## What the controls execute

`finance/wiring.py` validates a closed schema and invokes the original
`forecast.project()` and `reporting.totals()` functions in unique namespaces
with per-execution temporary databases. It uses the same cent-preserving adapter.
No uploaded/arbitrary code, paths, custom SQL, secret access or enterprise data.

| Editable choice | Runtime effect |
|---|---|
| Forecast method | Original Q3 forecast / Jan–Sep average / Jul–Sep average projection |
| Selected cost centres | Source input grid filtered **before** original adjustment allocation |
| Adjustment account | Original accountAdjustment applied to Contractors, Software & Licences or Professional Fees |
| Amount | Original total Q4 adjustment, multiples of $6, −$600 through $6,000 |
| Expense account mapping | Projected source account routed to reporting target ID; many-to-one merges use integer-cent SQLite accumulation |
| Report period | Q4 or October/November/December source-calculated totals |

All ten source accounts must be mapped. Revenue→Revenue and COGS→COGS are fixed.
Expense targets must remain expense accounts. Centre identities match exactly
between original sources and cannot be guessed/remapped. USD, calendar FY2026,
null future actuals and dollar→cent conversion are protected contract boundaries.

The configurable fixture deliberately raises contractor actuals by $30 per
selected centre in July–September. Source Q3 closed values are changed identically.
This demonstrates that choosing YTD/last-three-month methods really changes the
projection: without adjustment, two-centre Q4 expenses increase $60/$180 respectively
against Q3 baseline. Original fixed demo fixture remains unchanged.

Baseline uses the **same mappings and selected centres**, fixed Q3 forecast method
and zero adjustment. Editing a mapping affects displayed baseline/current target
account amounts; changing an assumption produces the displayed difference.
All ten report accounts are exposed, not only net totals, so reclassification is
observable even when profit is unchanged. Selecting a single report month does
not concentrate the whole Q4 adjustment into that month.

## Saved versions, undo and conflicts

State and immutable version/result snapshots live in new owner-scoped
`finance_wiring_states` / `finance_wiring_versions` tables. Identity comes only
from the authenticated session. There is no shared global active configuration.

Save executes on the server, stores canonical config, calculated result and
fingerprint, then atomically advances the active version. Requests carry the
expected state revision. A concurrent change returns 409 rather than silently
overwriting another tab. Restore changes the active pointer only; it does not
modify or delete a historical snapshot. The page can restore the prior active
version again to undo. Unsaved edits and prior-result freshness are visibly
distinguished; state reload must not silently replace a dirty form.

The fingerprint covers canonical configuration, original source hashes **and**
the bridge implementation hashes. Thus a changed adapter cannot silently alter
an older saved export. Save a newly executed version after implementation changes.

## Export

`GET /api/finance-wiring/versions/:id/export` resolves an owned immutable version
and passes only its config and receipt to fixed `export-wiring.py`.
The script verifies fingerprint/source integrity and reexecutes it before writing
an in-memory allowlisted ZIP. No original ZIP, memories, conversations, credentials,
database files, node_modules or unrelated application files are copied.

ZIP contents include the four untouched vendor modules, bridge, worker, source
provenance, `saved-wiring.json`, `expected-result.json`, `server.py`, `index.html`
and run instructions. Python 3.11+ and writable /tmp are sufficient:

```sh
PORT=3000 python3 -B server.py
```

The exported page runs the saved configuration through both source engines.
It intentionally does not let a caller replace the saved configuration; modify
and save wiring inside Workbench and export that new version instead.
The ZIP does not publish/register/import itself or establish source hosting rights.
This is a dedicated working finance export, not a claimed general-purpose exporter
integration or an integration of other demonstration products.

## Verification

```sh
cd artifacts/finance-consolidation-demo
python3 -B tests/run_evidence.py
# Focused configurable wiring + extracted ZIP reexecution:
python3 -B -W ignore::ResourceWarning -m unittest discover -s tests -p test_wiring.py -v
```

The source SQLite connection helpers use context managers without explicit close;
workers are bounded subprocesses, so process exit reclaims all resources. Python
3.13 unittest may report ResourceWarnings from these unchanged vendor helpers.
No resource warning is treated as numeric evidence.

Backend tests exercise state ownership and optimistic revisions. UI verification
covers the in-product edit/run/save/restore/download journey separately from source
provenance and engine tests.

Run backend tests from the workspace root (requires the development database):

```sh
pnpm --filter @workspace/api-server exec esbuild src/lib/finance-wiring.test.ts --bundle --platform=node --format=esm --external:pg-native --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" --outfile=node_modules/.cache/finance-wiring.test.mjs
node --test artifacts/api-server/node_modules/.cache/finance-wiring.test.mjs
```

Verified on 2026-10-21: 20 Python checks including extracted ZIP server execution,
four backend checks including owner isolation and concurrent-save conflict, and
the authenticated browser edit/run/save/reload/restore/undo/download flow.
Invalid amounts and empty selections were blocked without changing saved state;
an interrupted Run retained the last good report. Mobile had no page-level
overflow. A multi-tab UI conflict was not separately exercised; the backend
revision conflict was tested.
