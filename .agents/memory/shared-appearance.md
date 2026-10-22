---
name: Shared appearance and terminology
description: Cross-app theme consistency and source-registration constraints for visual changes.
---

The user requires a light/dark toggle that stays consistent throughout the app,
including linked demo apps, rather than switching back to light on another page.
Use “Fuse” and “Fusing” in user-facing language instead of “Energize” and “Energizing.”

**Why:** Explicit user requirements for consistency across the product.

**How to apply:** Keep one shared preference across the same-origin apps and apply
it before first paint. Preserve the source archives of registered originals:
host-level appearance wrappers must not change files in their source allowlists,
because those changes invalidate source hashes and existing combinations.
