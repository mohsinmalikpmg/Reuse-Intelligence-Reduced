# Consolidation integration matrix

| Recipe | Pinned original source IDs | Executed capabilities / contract | Actual application |
|---|---|---|---|
| Invoice Operations | `invoice-finder`, `approval-desk`, `spend-tracker` (at least two; base must be selected) | `fuzzy-search` / `invoice-to-search`; `bulk-decisions` / `invoice-to-decisions`; `spend-tracing` / `invoice-to-spend`. Each selected capability requires its source and exact matching edge. Shared invoice identities and integer cents. | `/invoice-consolidation/?consolidationCaseId=cc_…` |
| Forecast to Report | `budget-and-forecast`, `management-reporting` (both required; forecast is base) | `forecast-projection` and `management-reporting`; `forecast-to-report` edge. Existing FinanceWiringConfig validates account classification, periods, centres and dollar-to-cent adapter. | `/finance-demo/?consolidationCaseId=cc_…` |

## Persistence and ownership

`consolidation_sources` stores immutable registered version/hash, provenance, actor and private object reference. Invoice archives use each untouched original app's explicit `package-files.json`; finance archives are exact delivered ZIPs verified against reviewed provenance. Downloads require authentication and verify SHA-256. Finance originals are **not scrubbed** and may contain sensitive files; do not redistribute them as safe source packages.

`consolidation_cases` stores owner, revision and full pinned recipe snapshot: need, base, selected versions/hashes, capabilities, wiring, config, fingerprint and actual run URL. Only the owner may read/update/run. PUT is full replacement with `expectedRevision`; undo is another validated PUT of the previous choices using the current revision. Concurrent changes return 409. Invalid compositions return 422. Maintenance cases and simulation routes remain unchanged.

All source bytes are re-read and hashed against the selected registered version during case validation, including run/export validation. Unsupported sources/code paths cannot enter the trusted recipe. Source registration and source presence do not assert security approval or production readiness.

## API / exporter integration

- Public `GET /api/consolidation/recipes`: default config, supported sources, bases, capabilities and edges.
- Authenticated `GET /api/consolidation/sources`; `GET /api/consolidation/sources/:id/download`.
- IT-only `POST /api/consolidation/sources/register`: ingest only server-owned allowlisted originals.
- Owner-scoped `GET/POST /api/consolidation/cases`; `GET/PUT /api/consolidation/cases/:id`.
- `POST /api/consolidation/cases/:id/run`: revalidate and return `{runUrl,fingerprint}`.
- Exporter imports `ownedConsolidationCase`, `validateConsolidationCase`, `consolidationFingerprint` from `lib/consolidation-recipes`. Dispatch `cc_` IDs separately; retain normal export ownership, revision/timestamp and lifecycle checks.
- OpenAPI generates React Query hooks and Zod/type contracts.

## Explicit privileged development ingestion

No automatic role grants or public ingestion bypass exist. An administrator must already have granted the actor `users.can_manage_solution_packages=true`. Use the authenticated register endpoint or bundle `artifacts/api-server/scripts/register-consolidation-sources.ts` with the existing esbuild setup and run with that existing actor ID as its sole argument. The service independently checks the grant. Configure private object storage first. The script never creates users or modifies permissions.

Tests cover source-byte determinism, both delivered finance archive hashes, blocked arbitrary source paths, minimum source count, exact wiring, fingerprint pinning and ingestion authorization. Browser runtime and standalone export verification belong to their respective integration owners.
