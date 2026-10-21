---
name: Experiment lineage and grouping
description: Rules for keeping experiments under their parent product — stated intent drives grouping, capability match is the fallback; save/propose wording; grouped owner decisions.
---

- Grouping and the similar-work prompt follow the person's stated intent (normalized) first; the added capability or an identical configuration only matches when at least one side has no stated intent.
  **Why:** a code review caught that keying on the capability made "same intent, different approach" invisible and merged "different intent, same capability" into one owner decision. Intent is what defines an improvement; the change is only a hint.
  **How to apply:** two described experiments with different intents never group, even if they add the same capability; an undescribed experiment joins the one group whose members make the same change, otherwise stands alone.
- Lineage (what changed vs. the parent) is derived from the stored configuration on every read, never persisted, so it cannot drift from the fingerprint.
- Any configuration edit withdraws a proposal: status and promotion state both return to "experiment". Keep them in sync whenever one is reset.
- Wording mandate: "Save experiment", "Continue testing", "Propose this improvement to <parent>", "Propose as reusable capability", "Request new solution family" (reason required, the exception). "Save version", "Publish", "New solution" never appear as actions. Pilot exposure is a detail inside the proposal, not a step.
- Similar-work prompt never rejects (Join / Compare / Continue separately); it shows after a successful save, never instead of it, and before any proposal.
- A grouped owner decision applies to every member; adopting one approach keeps the rest as local experiments, and once any member is approved the group offers no further grouped actions. Counts use current-configuration evidence only.
