---
name: Finance source integration boundaries
description: Precision and period decisions for reuse of the uploaded finance engines
---

Keep forecast/report integration evidence bounded to the reviewed slice; never
infer equivalence between differently named source cost centres.

**Why:** The original forecasting projection affects open Q4 months, but the
reporting app's full report suppresses those months without actuals. Its aggregation
capability can still demonstrate forecast change without inventing actuals.

**How to apply:** Select forecast-only reporting explicitly and distinguish
reusing aggregation from reusing the full report/commentary/export product.

Preserve pennies through aggregation with an explicitly documented unit boundary.

**Why:** Forecast storage is cents but its projection returns dollar floats;
reporting originally expects whole dollars. Blind conversion either scales
twice or loses pennies. The bounded proof uses an integer-cent reporting ledger
and converts aggregate results to dollar strings, leaving vendor modules unchanged.

**How to apply:** Do not attach original reporting thresholds, commentary or exports
to a cent-lifted ledger without their own reviewed dollar conversion. Wider
input support must assess original float rounding and allocation residuals.

Wiring must be inspectable and editable inside Workbench, not managed by asking
the user to edit source files in a separate demonstration.

**Why:** The user explicitly rejected outside-the-solution code editing and
approved inspect/change/validate/run/save/undo controls driving the actual adapter.

**How to apply:** In-product controls must affect execution, and runnable downloads
must use the saved configuration. Explain unsupported connections as blockers;
never treat a configurable diagram as an executable integration.

Forecast to Report must use the same Library → saved combination Workbench → run
flow as Invoice Operations, not a separate global configuration experience.

**Why:** The user explicitly rejected finance as a different solution and configuration
from the rest of the workflow.

**How to apply:** Keep finance settings on the saved combination, run that exact
configuration, and return to that case for edits. Do not introduce independent
demo defaults or a second finance settings store into the primary journey.
