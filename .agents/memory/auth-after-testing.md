---
name: Authentication after testing
description: Runtime-only OIDC test overrides can prevent real users signing in after browser verification.
---

After authenticated browser testing, restart the API workflow and verify that the login redirect goes to the real identity provider, not the test provider.

**Why:** The testing override remained active after verification and blocked the user's normal login. It was absent from the environment-variable settings because it was a runtime workflow override.

**How to apply:** Restore and check the API after the tester finishes, not just the frontend. Inspect only the redirect hostname; do not log cookies or authorization query parameters. Do not run another authenticated tester to verify restoration, since that can reinstate the override.
