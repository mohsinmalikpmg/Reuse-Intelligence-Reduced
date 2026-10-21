---
name: Prototype intake matching and ranking
description: Durable rules for the "I have a prototype" entrance — how pasted outputs are matched honestly and why registered prototypes must not distort forward reuse checks or reuse metrics.
---
- Match a prototype's sections against the engine's *own* vocabulary (tokens a step adds beyond its input), taken from a family-wide run; raw overlap echoes the input and over-matches.
- A line is "reproduced" only on substantive agreement: shared content words (equipment tags and bare numbers excluded), overlap on both sides, same polarity. A shared tag alone said "P-104 critical" = "P-104 healthy".
  **Why:** reproduced lines feed the Duplicates verdict and the fold recommendation; a false match tells someone an existing product already does what their prototype does.
- Never rebuild the reuse scorer's document frequencies from registered prototypes: newly known rare words re-weight every forward check and move certified products.
  **Why:** forward checks on the demo brief must be identical before and after any registration.
- Registered prototypes are shown ("someone built this already") but capped below the improve/try threshold and never the recommended configuration.
- Registration is not reuse. The reuse event's path stays undecided until someone acts (opening the experiment = use; an actual fold = improve); only "nothing in the library does this" is a decided "create" at registration.
  **Why:** the portfolio counts decided paths as reuse actually performed.
- Undo across navigation: TanStack `mutate()` drops callbacks once the component unmounted; use `mutateAsync().then(...)` for toast Undo that fires on another page.
