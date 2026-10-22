# Reviewed reuse inventory

Exact original archive/member paths, byte sizes and SHA-256 hashes are recorded
in `provenance.json`. Copied files are byte-for-byte originals; runtime verifies
them before import. The test suite additionally compares original ZIP bytes
when the uploaded archives are available. Archives are never modified.

| Component | Original file below `artifacts/api-server/finance/` | Reused entry points | Input → output | Adaptation |
|---|---|---|---|---|
| Budget & Forecast | `data.py` | `initialize`, `rows` | cents SQLite → row dictionaries with dollar floats | private DB_PATH; replace generated sample with bounded synthetic fixtures |
| Budget & Forecast | `calculations.py` | `project` (internally `totals`) | fixed method, percentages and total account adjustment → projected rows + totals | no source changes; adapter selects rows |
| Management Reporting | `data.py` | `seed`, `connect` | schema and seed → SQLite connections | private DB_PATH; remove unrelated scenarios/KPIs/narrative before bridge |
| Management Reporting | `reporting.py` | `totals`, `account_ids` | month, month/YTD, account grouping → scenario sums | integer-cent ledger lift, final USD conversion outside source |

## Review before execution

Both archive READMEs identify the active implementation as Python/FastAPI/SQLite,
not the unused Express/TypeScript scaffolds. Both READMEs and all four full
selected modules were read before their first import/execution.

Imports are Python standard-library only: collections, math, os, sqlite3,
pathlib, base64, calendar and json. Module import defines constants, functions
and default paths. Forecast data reads `BUDGET_DB_PATH` at import; no connection
or seed occurs at import. Reporting defines a source-relative DB path but also
does not open it until called. The forecast reset/delete CLI is guarded by
`if __name__ == "__main__"`; it is not invoked. Both initializers write files
and seed tables, so paths are redirected before either is called.

All code executed is the reviewed, hash-checked local copy; there is no archive
upload endpoint, remote code download or runtime module selection.
The original FastAPI entry points, assistants, commentary, exports and frontends
are not imported. Secrets, .conversation, .agents, data files, unrelated assets
and existing source servers are excluded. No OpenAI or external service is used.

The adapter does not claim equivalence between differently named cost centres.
Only the two exact matching Operations centres are selected. Schema creation
uses originals so their actual SQLite contracts are exercised. Fixtures then
replace generated rows, keeping the two systems' original financial patterns
from being accidentally mixed.

## Independent expected example

Monthly source fixture dollars:

| Centre | Revenue | COGS | Salaries | Contractors |
|---|---:|---:|---:|---:|
| Service Delivery | 10,000.01 | 2,000.00 | 3,000.00 | 1,000.01 |
| Supply Chain | 20,000.02 | 4,000.00 | 6,000.00 | 2,000.02 |

Other six cost accounts are explicitly zero. Q4 baseline revenue = 90,000.09;
COGS = 18,000.00; OpEx = 36,000.09; profit = 36,000.00.
A $360 total contractor adjustment means $60 for each of six future rows.
Each month's OpEx increases $120 and profit decreases $120.
Q4 OpEx becomes $36,360.09 and profit $35,640.00. Revenue/COGS and Jan–Sep
do not change. These constants are independently asserted in tests.

## Evidence scope

Passing checks prove this bounded combination, not whole-app compatibility,
production readiness, correctness of uploaded claims, or approval to host sources.
Negative tests demonstrate rejection of bad mappings, fields, periods, money,
assumptions and incomplete grids. Their passing status means the bad input
was rejected, not that an invalid integration succeeded.
