---
name: Typecheck order and codegen quirks
description: Lib typecheck must precede api-server typecheck; api-client-react tsconfig needed dom.iterable.
---
The dev visual-instrumentation plugin can insert attributes before explicit JSX generic arguments (for example `<Filter<T>`) and produce invalid JSX, despite production builds and typechecks passing.

**Why:** This occurred on the portfolio filters in dev preview.

**How to apply:** Prefer inferred generic JSX props (use `NoInfer` for contextual constraints when needed), or a typed component alias, and check the running preview after adding generic components.

Run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck`.

**Why:** the api-server typecheck resolves `lib/*` through TypeScript project references and reads their emitted declaration output; if libs were changed (schema, openapi codegen) but not rebuilt, the api-server check reports errors against stale lib output.

**How to apply:** after any edit under `lib/`, or after `pnpm --filter @workspace/api-spec run codegen`, run the libs typecheck first. Also: the template's `lib/api-client-react/tsconfig.json` needed `"dom.iterable"` in `lib` for the generated client to typecheck.
