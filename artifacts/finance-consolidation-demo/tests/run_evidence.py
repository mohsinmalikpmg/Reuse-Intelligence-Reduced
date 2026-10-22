"""Emit reproducible JSON, including negative checks, without committing build output."""
import contextlib
import io
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from finance.harness import run, verify_sources
from finance.adapter import validate_adjustment
from finance.wiring import DEFAULT_CONFIG, run_config

stream = io.StringIO()
suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_*.py")
result = unittest.TextTestRunner(stream=stream, verbosity=2).run(suite)
rejections = []
for value in [None, 1, -606, 6006, "360"]:
    try:
        validate_adjustment(value)
        rejections.append({"input": value, "rejected": False})
    except ValueError as error:
        rejections.append({"input": value, "rejected": True, "error": str(error)})
evidence = {
    "schemaVersion": 1, "passed": result.wasSuccessful(), "testsRun": result.testsRun,
    "failures": [{"test": str(test), "trace": trace} for test, trace in result.failures + result.errors],
    "testLog": stream.getvalue(), "sourceHashes": verify_sources(), "knownChange": run(360),
    "invalidInputEvidence": rejections,
    "editableWiringExample": run_config(DEFAULT_CONFIG),
    "scope": "Reviewed local modules and synthetic fixtures only; not full product certification."
}
print(json.dumps(evidence, indent=2))
sys.exit(0 if result.wasSuccessful() else 1)
