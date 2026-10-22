# Three distinct source capabilities → one future product

These are deliberately constructed synthetic originals, not submissions by
actual Cenovus teams. Each is independently runnable with isolated browser
storage and its own implementation. No consolidated fourth app exists yet.

| Open original | Standout to extract | Deliberately simple overlaps |
|---|---|---|
| `/invoice-finder/` | Fuzzy, typo-tolerant search with ranked and explained matches | Single-invoice decisions; secondary spend summary |
| `/approval-desk/` | Multi-select and bulk decisions with per-invoice stage/role checks | Literal search; basic spend totals |
| `/spend-tracker/` | Project → materials/labour groups across invoices → source lines | Literal search; single-invoice decisions |

Invoice Finder is **not** the combined product. Do not add B's batch workflow or
C's line-group reporting to it as a shortcut.

## Presenter walkthrough

Use each original's confirmed reset only when previous demo decisions should
be discarded. AFE means project for this synthetic demonstration; PAR is its
suballocation. All money is CAD; calculations use integer cents.

### A — find records despite spelling errors

1. Search `borel parts`: see Boreal Parts invoices despite the missing letter.
2. Search `praire servces`: see Prairie Services invoices, with the match
   explanation. Compare a correctly spelled query or exact mode.
3. Narrow results using the structured supplier/date/amount/status/AFE/PAR
   filters. Those filters remain strict even when text matching is fuzzy.
4. Show I1 / BP-100 and I2 / `bp 100`: they are an exact-normalized duplicate
   pair. A fuzzy near match is **not** proof of a duplicate.
5. Show a nonsense query produces an honest empty state, not invented matches.

**Contribution:** the search engine returns ranked invoice identities and match
evidence, not approval decisions and not a second copy of the invoice data.

### B — review multiple invoices with one deliberate action

1. As reviewer, select pending I1 and I6 in the queue. Review a bulk approval
   with one nonblank reason, then confirm.
2. I1 (CAD 10,000) becomes approved-unpaid. I6 (CAD 60,000) remains pending at
   the controller stage. A batch must not flatten their different rules.
3. Open history: two individual events preserve each invoice's stage, role,
   reason and result. Reload to prove persistence.
4. As controller, approve I6. Its amount now becomes approved-unpaid.
5. In All invoices, select a mixed set including a terminal invoice or one
   assigned to another role. The preview explains why it cannot act on each
   ineligible record. No silent skipped records or unauthorized transitions.
6. Show bulk rejection requires a reason, and viewer cannot execute decisions.
   Selection after filtering must not secretly target hidden records.

**Contribution:** selected invoice IDs become an explicitly reviewed batch;
each record retains its own validation and append-only history.

### C — explain what the project is spending on

1. Open project AFE-200 / Facility upgrade, then its materials group.
2. Trace materials across I6 (CAD 40,000 pending), I7 (CAD 12,000
   approved-unpaid) and I8 (CAD 2,000 paid). Materials committed = CAD 14,000.
3. Switch to labour: I6 CAD 20,000 pending, I7 CAD 3,000 approved-unpaid,
   I8 CAD 8,000 paid. Labour committed = CAD 11,000.
4. Open a contributing invoice and inspect the actual source lines, category,
   description, amount, supplier and PAR. This is cross-invoice cost grouping,
   not just three invoice totals relabeled as materials.
5. Reconcile both groups to project committed CAD 25,000, pending CAD 60,000,
   remaining CAD 25,000 and projected overrun CAD 35,000.
6. Approve I6 in C's simple workflow: materials committed becomes CAD 54,000,
   labour committed CAD 31,000; project committed becomes CAD 85,000.
   Marking I6 paid changes the paid/approved buckets, not committed.
7. Reload. Decisions and tracing stay consistent; A and B remain unchanged.

**Contribution:** category rollups retain line and invoice provenance, classify
amounts using current invoice status and reconcile to project budgets.

## Wiring contract for a later fourth app (plan, not implemented)

Use one canonical dataset, not three concatenated fixture copies.

1. **Core identities:** supplier ID, invoice ID/number, project/AFE ID, PAR ID,
   invoice-line ID; integer CAD cents; line category and description.
2. **A's search adapter:** accepts a query plus strict filters; returns ranked
   invoice IDs with match explanations. Selection remains by stable ID, never
   supplier text or fuzzy score.
3. **B's batch adapter:** accepts selected invoice IDs, role, action and reason.
   Preview and confirmation must use current states. Revalidate every record,
   preserve threshold stages and persist the resulting individual events
   atomically. Preview changes require renewed confirmation.
4. **C's reporting adapter:** reads the same invoices, source lines and derived
   statuses after B commits. Aggregate line buckets by project/PAR/category,
   and link every amount back to its source invoice and line.
5. **Shared shell, not shared originals:** the future product wires search
   results → selection → reviewed batch → refreshed grouped spend, without
   navigating to disconnected apps or synchronizing three localStorage keys.
6. **Evidence:** retain original hashes and capability manifests; document
   adapters, adopted source functions and combined tests. Existing privileged
   package review remains the ingestion boundary. No grants, matching-rule
   changes or exporter changes are made to force this demonstration.

## Acceptance test of the future combined product

- Seed exactly 8 invoices and 16 source lines once. No double ingestion.
- Fuzzy `borel parts` finds I1, I2, I7; strict filters can narrow that set.
  Nonsense finds none; fuzzy proximity alone never labels a duplicate.
- Search/select I1 and I6, then bulk approve as reviewer. I1 moves CAD 10,000
  from pending to approved; I6 remains pending at controller stage.
  Its materials/labour pending amounts remain CAD 40,000/CAD 20,000.
- As controller approve I6; the same report updates its materials committed
  to CAD 54,000 and labour committed to CAD 31,000. Their sum is project
  committed CAD 85,000. No manual refresh into a different original app.
- Pay I6: project committed stays CAD 85,000. Project approved-unpaid becomes
  CAD 15,000 and paid CAD 70,000. Group totals remain reconciled.
- Reject I2 with a reason: pending materials decreases CAD 7,000, labour
  CAD 3,000; rejected buckets increase equivalently, not committed.
- Mixed eligibility, stale preview, wrong role, blank reason, duplicate IDs,
  missing line references and mismatched line sums fail or are explicitly
  excluded before confirmation. No partial writes presented as success.
- Reload, inspect individual decision history and source lines, and repeat
  on a phone viewport. Extract and test the combined ZIP independently.

Passing original tests proves only local behavior, not completed consolidation,
enterprise authorization, tamper-proof auditing, payments or Cenovus policy.
