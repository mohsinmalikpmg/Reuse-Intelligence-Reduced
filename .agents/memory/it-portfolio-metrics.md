---
name: IT portfolio metrics
description: Measurement principles for the IT health view — what may count as reuse, how absence of data is shown, and why seeded cases are backdated.
---

- IT Owner needs separate Analytics, Capabilities, and Review destinations, not a combined dashboard.
  **Why:** The user requested the split and explicitly followed up when it was only discussed rather than implemented.
  **How to apply:** Keep decision actions in Review; provide analytics drill-downs and searchable capabilities grouped by feature, business problem, or implementation. Untracked adoption is “Not tracked yet”; absent implementation metadata is “Not assessed.”
- Registered source apps must count alongside registered prototypes, separately from seeded catalog entries.
  **Why:** The invoice and finance originals are registered sources, not prototype-entrance products; catalog-only metrics omit real registrations.
  **How to apply:** Distinguish provenance and deduplicate real registrations; governance approval status is not an implementation architecture.

- Exploration is not reuse. Opening a solution page or an experiment from a reuse check is recorded as `explored` and never enters a reuse metric; only an action that changes a workbench (capability tried or improved, case created from the check, new approach or request recorded, or an explicit dismissal) is a choice. Hard-excluded options never count as reuse even if someone acts on them.
  **Why:** the first version counted "Explore it" / "See why" clicks as reuse and the review rejected it; a prevention metric that counts navigation is unreliable.
- A "proposal" is a recorded decision (seeker proposed, or owner adopted from a grouped review), never a status. A case rejected or kept local without a proposal is not in the denominator.
- Empty denominator → the literal "No data yet" with null numerator/denominator, never 0%. Catalog-derived metrics always have data and are always flagged demo; verify the empty path by deleting rows, not by reset (reset re-seeds).
- A product leaves production only when its retirement is confirmed *and* a migration note is recorded; until then it is "scheduled" and still counts as a variant.
- Seeded experiments must be backdated after seeding or any duration metric collapses to seconds.
- The queue is exception-only; decisions invalidate the portfolio query, so the row the person acted on is pinned until closed, and `?case=<id>` reopens a settled consolidation record (the only path to Withdraw once all migrations are recorded).
