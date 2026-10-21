---
name: Solution families (Library "By problem")
description: Durable rules for the family view, approved-configuration previews and "Try" cases.
---
- A fresh demo reset has no published versions or dispositions; approved configurations and "Being consolidated" only exist after the governance journey (owner adopts → IT approves). Play it before judging the library UI.
- "Standard" = the catalog version of a product, not the live one. Version A of any case must resolve as of its own `parentVersion`; building it from the live product shows steps the A run never executes.
- Version B for an approved configuration must be the fully resolved target version (every earlier fold included), never catalog + that version's own folds.
- Any "Try in <product>" offer must be gated by the same addability rules the workbench applies (conflicts, support, dependencies); otherwise the case opens with B equal to A.
- Output diff marks must be keyed by section + item; item keys such as `none` repeat across sections.
**Why:** each of these produced a visibly wrong demo state (empty cards, mislabelled A, false "Added" marks, B unchanged) before being fixed.
