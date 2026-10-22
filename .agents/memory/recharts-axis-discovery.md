---
name: Recharts axis discovery
description: Rendering constraint observed with Recharts 2 and React 19 in the workbench.
---

Keep XAxis and YAxis as direct children of BarChart rather than wrapping them in a conditional React fragment.

**Why:** With the installed Recharts 2 / React 19 combination, fragment-wrapped axes were not discovered. Charts silently used default axes, hid labels, and failed to draw capability bars despite correct nonzero input. Typechecking and builds did not catch it.

**How to apply:** Put conditional expressions around individual axis elements. For charts that render blank with valid data, check axis discovery before changing counts or inventing fallback data.
