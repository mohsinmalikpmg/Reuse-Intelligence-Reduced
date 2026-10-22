# Finance source ZIP import-readiness inventory

## Scope and safety

Static review of the two user-supplied attachments only: filesystem size/hash, ZIP directory listing and selective plain-text reads of README, manifests, launch/configuration and finance schema source. No uploaded application, script, dependency installer, database initializer or build was executed. No dependencies were installed from these uploads. Findings are source declarations, not independently verified runtime behavior or an integration.

| Attachment | ZIP bytes | Expanded bytes / listed entries, including directories | Original SHA-256 |
| --- | ---: | --- | --- |
| `Management-Reporting-Agent-main_1792619794108.zip` | 375477 | 1036366 / 282 | `369013b1523f1e1e6786ad8095e98402988565cfbc46ff1d885dfffef2422310` |
| `Budget-and-Forecast-Agent-main_1792619794109.zip` | 321126 | 891024 / 264 | `1f5c4f3e57430bdc6ea2de2856f7d127b5ef545ad44b29d2938ed71fc961b4b7` |

Both archives have a single enclosing project directory. Both list `.agents/memory/` and `.conversation/attached_assets/` artifacts. Their private contents were not needed for readiness review and were not read. Those paths, memory/conversation artifacts, known secret/credential paths, local databases and private keys must not be redistributed as runnable source. The runtime inspector omits known private paths from eligible file/dependency/mapping evidence; this is not a comprehensive content-level secret detector.

**Original downloads remain private, authenticated, unmodified uploads and may contain sensitive artifacts. No sanitized source ZIP export is implemented. Do not redistribute original downloads or treat an evidence manifest as a sanitized archive.** Upload/review requires the existing IT package-management grant; authenticated original-download access retains the existing policy. No public source route or authentication bypass is introduced.

Authorized IT can use Library → Solution ZIP intake to select a library solution (including non-live targets), give a version, upload the original ZIP and inspect it. This preserves the original with a SHA-256 while exposing eligible static evidence and review warnings. Keeping source, approving a mapping or linking a separate app does not change execution readiness. This inventory does not claim the attachments have already been uploaded into private object storage.

## Declared runtime and dependency inventory

| Area | Management reporting | Budget and forecast | Remaining work |
| --- | --- | --- | --- |
| Python API | `artifacts/api-server/finance/main.py`: FastAPI; `run.py` starts Uvicorn; package dev/start scripts call Python | `artifacts/api-server/finance/main.py`: FastAPI; `run-python.sh` invokes Uvicorn through uv | Verify Python >=3.11, entrypoints and host/runtime isolation. Existing Express scaffold is not evidence that these are Express services. No automatic embedding into workbench API. |
| Python dependencies | `pyproject.toml` declares FastAPI, Uvicorn, OpenAI, python-docx, reportlab; `uv.lock` present | `pyproject.toml` declares FastAPI, Uvicorn, OpenAI, openpyxl; `uv.lock` present | Review lock resolution, system libraries, licenses, vulnerabilities and optional server-side API-key setup. Keys must be supplied privately, never bundled. |
| Frontend | React/Vite under `artifacts/management-reporting/` | React/Vite under `artifacts/budget-forecast/` | Separate app/client contracts; no frontend code has been integrated into workbench. |
| JavaScript workspace | `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Same manifest/lockfile names | Audit workspace dependencies and install/build lifecycle scripts before any controlled build. Lockfile presence alone proves neither reproducibility nor security. |
| Ports and base paths | Uvicorn requires `PORT`; frontend Vite requires `PORT` and `BASE_PATH`; API endpoints use `/api` | Uvicorn shell launcher requires `PORT`; frontend Vite requires `PORT` and `BASE_PATH`; endpoints use `/api` | Allocate distinct API/frontend ports, configure mount paths and proxy routing, then check asset/client/API URLs. No fixed port was inferred, no app URL guessed and no route tested. |
| API documentation | FastAPI declares `/api/docs` and `/api/openapi.json` | FastAPI defaults to `/docs`; README notes public proxy only exposes `/api` | Validate routing and decide exposure/auth policy before hosting. |

## SQLite initialization and schema mapping — unresolved

Both source applications describe deterministic illustrative finance data and no application-level authentication. The workbench's private-source authentication does **not** add authentication to either standalone app. No live company dataset or production integration was verified.

Management reporting's `finance/data.py` declares SQLite at `finance/data/finance.sqlite3`, creates schema and seeds absent ledger data during FastAPI lifespan startup. Ledger amounts are integer **whole USD**. It uses numeric business-unit/cost-centre/account identifiers, a scenario-based `ledger` plus budget/actual/forecast/prior views, KPI/driver tables and persisted commentary/settings.

Budget and forecast's `finance/data.py` declares SQLite at `finance/budget.sqlite3`, overridable with `BUDGET_DB_PATH`. FastAPI lifespan calls `initialize()`, which creates schema and seeds if budget data is absent. Ledger amounts are integer **cents** with conversions at API boundaries described in the README. Separate `budget`, `actuals`, versioned `forecast`, `risks` and settings tables use cost-centre/account names as identifiers.

**Do not join or copy amounts between these schemas without an explicit reviewed mapping.** Outstanding decisions include:

- Whole dollars versus cents; conversion/rounding at every API, persistence and export boundary.
- Identifier crosswalks: cost-centre names differ; numeric identifiers are not shared keys.
- Scenario/version definitions, prior year and KPI availability; January–September actuals versus full-year estimates.
- Materiality behavior: reporting documents percent **AND** dollar thresholds, forecast documents **OR**; preserve intentional semantics.
- Currency, revenue/expense sign conventions, favourable/unfavourable variance, missing future actuals versus zero, and report grain.
- Writable database locations, single-instance SQLite concurrency, durable storage/backups, migration and restore; startup seeding is not a migration strategy. Do not run destructive reset/reseed actions against retained data.

No database file was found in either ZIP listing. Initialization, persistence, security and schema interoperability have not been run or validated.

## Product evidence and release gates

The existing `files` and `warnings` fields carry eligible file hashes, archive metadata and static readiness observations (Python/FastAPI, React/Vite, pnpm/uv locks, SQLite, ports/base paths and unresolved finance mapping). No API schema extension is required. Private artifact paths cannot be approved as capability mappings, including on older retained records.

The solution source-evidence panel lists **all** uploads for a solution, not only those with approved mappings, including waiting/failed inspection states. Download appears only when a retained original hash exists. Approved mappings remain clearly separated from source availability; none imply execution, sandbox testing, safe redistribution or integration.

Before any future runnable-source release: create a real sanitized export pipeline using a shared private-path denylist plus content/secret review; preserve originals privately; obtain dependency/license/security review; decide schema migration and auth; validate builds and runtime in an isolated, authorized environment; and test deployed ports, base paths, API contracts and persistence. These gates remain outstanding.
