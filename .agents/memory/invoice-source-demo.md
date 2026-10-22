---
name: Invoice source-demo boundaries
description: Provenance and independence requirements for the three synthetic invoice originals
---

The user requires three deliberately constructed invoice originals, not claims
of software authored by actual independent Cenovus teams. Shared fixture data
and expected outcomes are allowed; shared mutable data or feature implementations
behind three frontends are not.

**Why:** these originals are evidence for a later cross-source consolidation
demonstration, so manufacturing implementation overlap would invalidate the demo.

**How to apply:** preserve original packages and source lineage when integrating.
Do not retrofit the originals to use the final combined engine. Their local tests
do not establish successful consolidation. Keep real permissions in the existing
privileged intake flow; demo role selectors never grant source-management access.

The user's intended standout capabilities are fuzzy search in Invoice Finder,
multi-select and bulk actions in Approval Desk, and project spend traced through
materials/labour line-item groups across invoices in Spend Tracker.

**Why:** the user found that Invoice Finder looked like the consolidation of
the other two; the originals need obvious, distinct features to identify and
wire into a fourth product.

**How to apply:** keep other overlaps basic and secondary. Do not make Invoice
Finder the fourth app. Demonstrate search → bulk decisions → grouped source-line
reporting as the future combined workflow, not already completed integration.

The invoice value demonstration must also show redundant features across the three originals and the opportunity to consolidate development and maintenance, not only combine their standout capabilities.

**Why:** The user explicitly identified redundancy reduction as part of the product's value demonstration.

**How to apply:** Expose source-backed overlaps and meaningful differences, then show proposed retain/replace/combine decisions. Keep proposed redundancy reduction distinct from verified replacement, retirement and measured maintenance savings.
