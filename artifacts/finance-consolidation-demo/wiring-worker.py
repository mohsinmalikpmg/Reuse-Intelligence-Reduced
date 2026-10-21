"""Fixed JSON bridge for Workbench. No arbitrary module or path execution."""
import json
import sys
from finance.wiring import catalog, run_config, validate

try:
    text = sys.stdin.read(32769)
    if len(text) > 32768:
        raise ValueError("Wiring request too large.")
    request = json.loads(text)
    if not isinstance(request, dict):
        raise ValueError("Expected a wiring request.")
    if request == {"action": "catalog"}:
        result = catalog()
    elif set(request) == {"action", "config"} and request["action"] in ("validate", "run"):
        result = validate(request["config"]) if request["action"] == "validate" else run_config(request["config"])
    else:
        raise ValueError("Unsupported wiring action or fields.")
    print(json.dumps(result, allow_nan=False))
except (ValueError, TypeError) as error:
    print(json.dumps({"error": str(error)}))
    sys.exit(2)
