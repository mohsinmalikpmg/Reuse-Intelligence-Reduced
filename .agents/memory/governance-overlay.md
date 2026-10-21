---
name: Governance overlay over a static catalog
description: How persisted successor versions and dispositions are layered onto the code catalog, and the rules that keep experiments and labels honest.
---
Rule: the catalog stays code; governance state (successor versions, folded capabilities with provenance, dispositions, preferred marks) is a small persisted overlay held in memory and reloaded after every write, applied through a resolver hook so solution reads stay synchronous.

**Why:** many call sites read solutions synchronously (matching, configuration, analysis); making them async for a handful of rows was not worth it, and the demo reset must be able to wipe the overlay cleanly.

**How to apply:**
- Experiments must resolve their parent "as of" the version they branched from; otherwise publishing a successor silently changes the lineage/diff of every open experiment. New cases branch from the new current version.
- Labels are computed on the server from state, never stored: proposed dispositions read "Proposed: …"; a confirmed retire is "Retirement scheduled" until a migration note exists (the word "retired" is banned by the user).
- Ranking demotion applies only to confirmed dispositions; proposals must not move products in the library.
- IT approval requires owner approval first; folded experiments stay in their improvement group (settled, no further group actions) so the group page never 404s and the owner cannot re-adopt the same intent. Declined groups resolve via an "include settled" lookup.
- Governance side effects run before the case row is updated so the returned case already carries `foldedInto`.
