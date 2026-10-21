---
name: Governance overlay over a static catalog
description: Durable lessons from layering persisted successor versions onto the code catalog (as-of resolution, published configuration, label rules).
---
- Experiments must resolve their parent product "as of" the version they branched from; otherwise publishing a successor silently changes the lineage, diff and A/B baseline of every open experiment. New cases branch from the new current version.
- A successor version is not published until the product actually *runs* the approved configuration: capability membership alone is not enough — the approved optional-module states and configurable values must be recorded on the version and applied to production defaults. A reviewer caught this once; check both seeded approaches (a setting change and a limited-evidence folded capability) after any change here.
- Labels are computed from state, never stored: proposals read "Proposed: …"; a confirmed retire reads "Retirement scheduled" until a migration note exists (the user bans the word "retired"). Ranking demotion applies only to confirmed dispositions.
- Folded experiments stay in their improvement group (settled, no further group actions) so the owner cannot re-adopt the same intent and the group page never 404s.
