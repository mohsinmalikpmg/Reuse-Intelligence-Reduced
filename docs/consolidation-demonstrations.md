# Reproduce the consolidation demonstrations

## Access prerequisite

Sign in with a real account through the existing authentication flow. The demo
persona selector is not an authorization grant. A real administrator must
explicitly grant an existing account IT package-management access before
Library → Register sources (IT) can ingest the reviewed source packages.
Registration retains originals privately; it does not execute uploaded code.

## Invoice

1. Open `/library`, choose Invoice Operations and two or three original sources.
2. Enter the need, choose a selected starting app and the desired capabilities.
3. Choose Combine in Workbench. The `/workbench/cc_…` address is the saved case.
4. Remove a capability, then Undo. Reload to check the saved choice.
5. Try it → Open combined app. The app URL is
   `/invoice-consolidation/?consolidationCaseId=<saved case id>`.
6. Search with a supplier typo; select invoices, preview and confirm bulk
   approval/rejection; inspect project materials/labour lines. Only selected
   features appear. Status and approval stage remain separate.
7. Export on the case page. Download the ZIP, extract it and run `npm test`,
   `node verify-http.mjs`, then `npm start`. Node 20+; no installation needed.
8. Record a Replit workspace link after a user imports the export. A published
   URL is separate and optional. Before that, the status stays awaiting import.

Original runnable apps remain `/invoice-finder/`, `/approval-desk/` and
`/spend-tracker/`. Their local ledgers are not shared with the combined app.

## Finance

1. In Library choose Forecast to Report and retain both required source engines.
2. Describe the need and create the proposal.
3. Change the Q4 adjustment to 720, save, then try the combination.
4. `/finance-demo/?consolidationCaseId=<saved case id>` executes the exact
   saved configuration through the reviewed forecast/report adapter. Inspect
   the forecast difference, not an actual-versus-budget report.
5. Export and extract. Run `python3 -B test_snapshot.py`, `node verify-http.mjs`,
   then `python3 -B server.py`. Python 3.11+ standard library runs the app;
   Node is only required for the optional HTTP verification script.
6. Finance exports deliberately freeze configuration. Change it in Workbench
   and export a new snapshot instead of modifying the old package.

The original fixed `/finance-demo/` demonstration remains independently usable.
Private finance original ZIPs are not sanitized redistribution packages.

## Developer checks

From `artifacts/api-server`:

```sh
node_modules/.bin/esbuild scripts/consolidation-exports-check.ts \
  --bundle --platform=node --format=esm \
  --external:pg-native --external:@google-cloud/storage \
  --banner:js="import { createRequire as __testRequire } from 'node:module'; const require = __testRequire(import.meta.url);" \
  --outfile=node_modules/.cache/consolidation-exports-check.mjs
node node_modules/.cache/consolidation-exports-check.mjs
```

This builds and extracts three-source invoice, two-source/removed-feature invoice,
and changed-assumption finance packages, runs their selected scenario tests and
starts their extracted HTTP servers. It also rejects stale source fingerprints.
These are builder checks, not evidence of an external Replit import.

The similarly bundled `scripts/consolidation-integration-check.ts` checks the
privileged registration and persisted case journey. It requires an existing
IT-authorized account; it never creates accounts or grants itself permission.
For this demonstration the creator authorized account-based setup instead of
a registration step. Source ingestion and starter cases were completed under
that account, then its previous permission setting was restored. Users can now
choose the already-registered sources without a registration action.

## Verification boundary

The exported selected-scenario and HTTP checks passed locally. Privileged
idempotent ingestion, private downloads, persisted revisions/undo, owner
isolation and source/config failure recovery passed. A single authenticated
browser pass covered invoice two/three-source selection, feature removal/undo,
reload, invalid wiring, fuzzy search, staged bulk approvals/rejections, line
reconciliation, finance +720 adjustment, export idempotence, app links and
all three independent originals.

The extracted invoice bundle rendered correctly at root through a browser-side
file bridge; the remote browser could not reach the local extracted-server port.
Separate HTTP checks started and exercised both extracted applications directly.
The temporary test workspace link was removed and returned to awaiting import.
No deployment, external import, or published URL has been created or claimed.
