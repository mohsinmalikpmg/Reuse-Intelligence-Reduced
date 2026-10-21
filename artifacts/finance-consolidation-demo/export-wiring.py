"""Allowlisted runnable source ZIP for one immutable saved configuration."""
import io
import json
from pathlib import Path
import sys
import zipfile
from finance.wiring import canonical_config, fingerprint, run_config
from finance.harness import ROOT, verify_sources

FILES = [
    "finance/adapter.py", "finance/fixtures.py", "finance/harness.py", "finance/wiring.py",
    "wiring-worker.py", "provenance.json",
    "vendor/forecast/data.py", "vendor/forecast/calculations.py",
    "vendor/reporting/data.py", "vendor/reporting/reporting.py",
        "CONTRACT.md", "SOURCE-REVIEW.md", "WIRING.md",
]


def build_export(request):
    if not isinstance(request, dict) or set(request) != {"config", "version"}:
        raise ValueError("Export requires a saved configuration and version receipt.")
    config = canonical_config(request["config"])
    version = request["version"]
    if not isinstance(version, dict) or set(version) != {"id", "number", "fingerprint"}:
        raise ValueError("Invalid version receipt.")
    if not isinstance(version["id"], str) or len(version["id"]) > 100 or type(version["number"]) is not int:
        raise ValueError("Invalid version identity.")
    if version["fingerprint"] != fingerprint(config):
        raise ValueError("Saved source/configuration fingerprint no longer matches; run and save a new version.")
    verify_sources()
    result = run_config(config)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.writestr(name, (ROOT / name).read_bytes())
        archive.writestr("server.py", (ROOT / "standalone-server.py").read_bytes())
        archive.writestr("index.html", (ROOT / "standalone.html").read_bytes())
        archive.writestr("saved-wiring.json", json.dumps({"config": config, "version": version}, indent=2))
        archive.writestr("expected-result.json", json.dumps(result, indent=2))
        archive.writestr("README.md", """# Saved finance wiring — executable snapshot

This ZIP runs the exact saved Workbench configuration using the four reviewed,
hash-checked original Python finance modules. Synthetic data only. It is not a
diagram export, a full merger of the original apps, or a production service.

## Run

Requires Python 3.11+ with sqlite3; no external packages, secrets or Node install.

    PORT=3000 python3 -B server.py

Open http://localhost:3000. Select Run saved wiring; the server executes both
original calculation engines. The page exposes the saved configuration, version
receipt, account/period results and hashes. No frontend financial calculation.

Configuration is intentionally immutable here. Edit, validate, run and save in
the Workbench Wiring view, then download that version. Do not edit vendor files.

    echo '{"action":"run","config":...}' | python3 -B wiring-worker.py

For a machine-readable run, pass the config object from saved-wiring.json to
the worker as shown above. expected-result.json records the export-time result;
compare a new run to it for reproducibility. All temporary databases use /tmp
and are removed after each execution. saved-wiring.json contains no user identity.

## Wiring contract

The baseline uses the same selected centres and mappings with Q3 Forecast and
zero adjustment. The scenario uses the saved forecast method and Q4 adjustment.
Adjustment is spread over selected centres and all three Q4 months by the original
forecast engine, even when one report month is selected. Expense-to-expense
account mappings can combine amounts; Revenue and COGS classifications are fixed.
Centres are selected from exact reviewed source matches, never fuzzy-mapped.
Forecast dollar rows become integer cents in the private reporting ledger, then
aggregate output becomes USD decimal strings. Currency conversion is not editable.

Original bounded proof documentation is included as CONTRACT.md and
SOURCE-REVIEW.md; the editable wiring extension above supersedes its fixed
Contractors/two-centre/Q4 assumptions. provenance.json records original hashes.
Only reviewed source files are included, never original archives or conversations.

The stdlib HTTP service is for local demonstration. Add production authentication,
limits and operational hardening before hosting sensitive data. This export
does not publish an app, register a Replit project, or upload source externally.
""")
    return buffer.getvalue()


if __name__ == "__main__":
    try:
        text = sys.stdin.read(32769)
        if len(text) > 32768:
            raise ValueError("Export request too large.")
        sys.stdout.buffer.write(build_export(json.loads(text)))
    except (ValueError, TypeError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
