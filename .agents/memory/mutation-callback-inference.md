---
name: Mutation callback inference
description: TypeScript inference when sharing React Query mutation lifecycle callbacks.
---

Keep the full mutation variables type generic when sharing lifecycle callbacks; a shared callback accepting only `{ id: string }` can cause `useMutation` to infer that narrower type even when the mutation function needs additional fields.

**Why:** Spreading the callback into mutation options narrowed callers to only `id`; wrapping the callback parameter in `NoInfer` did not resolve the inference.

**How to apply:** Use a generic shared mutation hook with explicit `useMutation` type arguments derived from the supplied mutation function, rather than casting the callers or weakening their variable types.
