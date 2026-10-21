# Synthetic invoice scenario

These deliberately constructed examples illustrate overlapping needs in a Cenovus
scenario. They are not Cenovus data, policy, or applications authored by its teams.
No real payments or enterprise approvals occur.

All money is integer CAD cents; UI shows CAD dollars. No tax or FX.
Demo hierarchy: each PAR belongs to exactly one AFE; each invoice belongs to one
PAR and its parent AFE. AFE budgets equal their PAR allocations.

Suppliers: S1 Boreal Parts (synthetic), S2 Prairie Services (synthetic),
S3 Summit Equipment (synthetic).
AFE-100 Field maintenance: 10000000 cents; PAR-110 Pump renewal 6000000;
PAR-120 Site services 4000000.
AFE-200 Facility upgrade: 5000000 cents; PAR-210 Controls 5000000.

| ID | Supplier | Invoice number | Date | Cents | AFE | PAR | Initial status |
|---|---|---|---|---:|---|---|---|
| I1 | S1 | BP-100 | 2026-09-01 | 1000000 | AFE-100 | PAR-110 | pending |
| I2 | S1 | bp 100 | 2026-09-01 | 1000000 | AFE-100 | PAR-110 | pending |
| I3 | S2 | PS-201 | 2026-09-04 | 2500000 | AFE-100 | PAR-120 | approved |
| I4 | S3 | SE-301 | 2026-09-07 | 2000000 | AFE-100 | PAR-110 | paid |
| I5 | S2 | PS-202 | 2026-09-10 | 500000 | AFE-100 | PAR-120 | rejected |
| I6 | S3 | SE-302 | 2026-09-12 | 6000000 | AFE-200 | PAR-210 | pending |
| I7 | S1 | BP-101 | 2026-09-15 | 1500000 | AFE-200 | PAR-210 | approved |
| I8 | S2 | PS-203 | 2026-09-18 | 1000000 | AFE-200 | PAR-210 | paid |

Duplicates: only I1/I2 match supplier + invoice number normalized to uppercase
alphanumerics. Warnings do not automatically remove amounts or block decisions.

Baseline totals: pending 8000000, approved-unpaid 4000000, paid 3000000,
rejected 500000; committed = approved-unpaid + paid = 7000000.
Budget 15000000; remaining after committed 8000000; projected remaining
after pending 0. Rejected is excluded. Paid is NOT counted again as approved.
AFE-100: pending 2000000, approved 2500000, paid 2000000, rejected 500000;
committed 4500000, remaining 5500000, projected remaining 3500000.
AFE-200: pending 6000000, approved 1500000, paid 1000000, rejected 0;
committed 2500000, remaining 2500000, projected remaining -3500000.

Basic variants A/C: demo reviewer can approve pending or reject pending with
a nonblank reason; approved may be marked paid (simulation only).
B: amounts <= 1000000 need reviewer approval; larger amounts require reviewer
then controller. First approval keeps status pending at controller stage.
Viewer cannot decide; only controller marks approved invoices paid. Reject
requires a reason at the current pending stage. Paid/rejected are terminal.
Decision records append only through application actions, not editable. Browser
storage is not a security boundary or tamper-proof audit record.

Reproducibility: initial state is generated from this fixture locally in each app.
Persistence is isolated per app in this browser, not shared multi-user storage.
Storage failures/corruption must be visible, never silently reseeded. Reset is
explicit and requires confirmation. Missing supplier/PAR/AFE references fail.

## Distinct contributions to a future fourth app

A is the fuzzy-search source; B is the multi-select/bulk-decision source; C is
the project-to-line-item-group tracing source. Basic overlaps are intentional,
but none of the originals should already implement all three standout features.

In this demonstration an AFE is a project; a PAR is a project suballocation.
This is a demo assumption, not an assertion about Cenovus terminology or policy.

## Deterministic source invoice lines

Spend Tracker represents each invoice with two source lines, materials and
labour. IDs are `<invoice-id>-M` and `<invoice-id>-L`. These are synthetic
allocations, not estimates inferred from real invoice documents. All amounts
below are integer CAD cents, and each pair sums exactly to its invoice total.
The line's approval/payment classification follows its parent invoice.

| Invoice | Materials cents | Labour cents |
|---|---:|---:|
| I1 | 700000 | 300000 |
| I2 | 700000 | 300000 |
| I3 | 500000 | 2000000 |
| I4 | 1400000 | 600000 |
| I5 | 100000 | 400000 |
| I6 | 4000000 | 2000000 |
| I7 | 1200000 | 300000 |
| I8 | 200000 | 800000 |

Portfolio baseline materials: pending 5400000, approved-unpaid 1700000,
paid 1600000, rejected 100000, committed 3300000.
Portfolio baseline labour: pending 2600000, approved-unpaid 2300000,
paid 1400000, rejected 400000, committed 3700000.
Project AFE-200 materials: pending 4000000, approved-unpaid 1200000,
paid 200000, committed 1400000.
Project AFE-200 labour: pending 2000000, approved-unpaid 300000,
paid 800000, committed 1100000.

Grouping does not erase invoice/line provenance or remove duplicates.
Rejected amounts are displayed separately, never included in committed spend.
The two line groups must reconcile to their containing invoice, PAR, project
and portfolio totals before and after any supported decision.
