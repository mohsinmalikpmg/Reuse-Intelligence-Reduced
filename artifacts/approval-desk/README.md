# Approval Desk: bulk review with a skip-explained preview (synthetic, single-browser demo)

A demo invoice reviewer sees what needs their decision and exactly why a large
invoice needs a second approval. Synthetic data from `SCENARIO.md` (variant B).
Role selection is a simulation, not authentication. No real approvals or payments.

## Run
Requires Node 24 and pnpm 10. Extract the ZIP into its own directory.

    pnpm install --frozen-lockfile
    pnpm run dev        # PORT (default 5173) and BASE_PATH (default /) honored
    pnpm test
    pnpm run typecheck && pnpm run build

Use different PORT values when running the originals simultaneously.
`pnpm run serve` serves `dist/public`. No monorepo imports, secrets, database
service or migrations are needed. `python3 package-source.py` reproduces a
content-addressed ZIP from `package-files.json`; its `source-hashes.json` records
source hashes. Dependencies, browser data, credentials and build clutter are
excluded. See `DEMONSTRATION.md` for the later consolidation acceptance plan.

## Standout: multi-select bulk approve / reject
- Queue and All invoices have row checkboxes and a select-all-visible box with a
  live count and CAD total. Only visible rows count; selections hidden by a
  filter are listed in a banner ("Drop hidden") and never acted on.
- Review bulk approve / reject requires a nonblank reason, then a frozen
  preview lists every invoice as Eligible (with its transition, e.g. I6
  pending/reviewer to pending/controller) or Skipped with the specific
  role/stage/status reason (viewer, terminal, already approved, wrong stage).
  Duplicate selections are counted once and reported. Nothing is bypassed.
- Confirm re-reads storage, re-derives the preview and refuses if any selected
  invoice changed status/stage (stale preview) or the selection changed. Each
  eligible invoice gets its own sequential event sharing a `batchId`; the whole
  batch is one `setItem`. A failed write reports an error and nothing applies.
- Logic: `src/domain/bulk.ts` (`previewBulk`, `applyBulk`), tests in
  `src/domain/bulk.test.ts`; UI in `src/bulk.tsx`.

## Design: event-sourced ledger
- `src/domain/seed.ts` immutable frozen fixture, reference validation, duplicate detection.
- `src/domain/ledger.ts` pure `decide`, `replay`, `appendDecision`, totals.
- `src/domain/storage.ts` versioned persistence over a Storage-like interface.
- Current state is never stored; it is derived by replaying events on the seed.

## Rules
- Amount <= 1000000 cents: reviewer approval. Larger: reviewer then controller;
  first approval keeps status `pending` at `controller` stage.
- Reject: nonblank reason at the current pending stage, by that stage's role.
- Approve: nonblank reason. Pay: controller only, approved only (note optional).
- Viewer cannot decide. Paid and rejected are terminal.

## Storage schema
localStorage key `approval-desk:ledger:v1`:

    { "version": 1, "events": [ { "seq": 1, "id": "uuid", "invoiceId": "I6",
      "action": "approve|reject|pay", "role": "reviewer|controller",
      "at": "ISO-8601", "reason": "text", "fromStatus": "pending", "toStatus": "pending",
      "fromStage": "reviewer", "toStage": "controller",
      "batchId": "optional, bulk only" } ] }

On load every event is re-derived; wrong seq, duplicate id, backwards time,
unknown fields, invalid transitions or mismatched fields fail the load and are
shown as an error (never reseeded). Reset requires confirmation. Other tabs
refresh via the `storage` event; decisions re-read storage before appending.
Simulated role is stored at `approval-desk:simulated-role`.

## Seed
Absent storage key = empty ledger = seed statuses: totals pending 8000000,
approved-unpaid 4000000, paid 3000000, rejected 500000, committed 7000000,
remaining 8000000, projected 0. Browser storage is not a security boundary.
