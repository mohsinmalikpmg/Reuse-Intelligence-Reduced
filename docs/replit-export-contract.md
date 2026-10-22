# Replit import contract

Checked 2026-10-21 against https://docs.replit.com/build/import-from-providers
and the live https://api.replit.com/openapi.json.

ZIP import is user-driven: open https://replit.com/import, select ZIP, upload
the downloaded archive (maximum 200 MB), supply any requested environment
configuration and approve Import/setup. Opening the page does not prove an
app exists or started. Migration assistance may consume Replit credits.

The public OpenAPI exposes GET /projects, not project creation or ZIP import.
Publishing-request review endpoints are not project provisioning APIs.
No ZIP-URL prefill, callback, unattended provisioning or automatic publishing
is used here. GitHub creation is outside this implementation.

Workspace and optional published addresses are entered separately. Stored
links remain unverified; neither opening import nor saving a URL counts as a
successful Replit launch. Artifact tests prove the exact ZIP only, not the
user's imported or subsequently edited app.
