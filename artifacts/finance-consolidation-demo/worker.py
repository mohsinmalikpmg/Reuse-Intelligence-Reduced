"""Fixed entry point: no arbitrary filenames, modules, SQL, or credentials from callers."""
import json
import sys
from finance.harness import run

try:
    request = json.loads(sys.stdin.read(4097))
    if not isinstance(request, dict) or set(request) != {"adjustment"}:
        raise ValueError("Supply only the required adjustment field.")
    print(json.dumps(run(request["adjustment"]), allow_nan=False))
except (ValueError, TypeError) as error:
    print(json.dumps({"error": str(error)}))
    sys.exit(2)
