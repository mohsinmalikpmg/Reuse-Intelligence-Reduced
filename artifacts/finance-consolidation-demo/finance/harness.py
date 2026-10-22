"""Local reusable integration entry point; each invocation has private SQLite paths."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import types
import uuid
from pathlib import Path
from types import SimpleNamespace
from .adapter import dollars, replace_forecast, validate_adjustment
from .fixtures import initialize

ROOT = Path(__file__).resolve().parents[1]
METRICS = [(0, "Revenue"), (1, "COGS"), ("opex", "Operating Expenses"), ("profit", "Operating Profit")]


def verify_sources():
    manifest = json.loads((ROOT / "provenance.json").read_text())
    for entry in manifest["modules"]:
        if hashlib.sha256((ROOT / entry["path"]).read_bytes()).hexdigest() != entry["sha256"]:
            raise RuntimeError(f"Original source integrity check failed: {entry['path']}")
    return [{"path": e["originalPath"], "sha256": e["sha256"]} for e in manifest["modules"]]


def load_engine(namespace, directory, module):
    package = types.ModuleType(namespace)
    package.__path__ = [str(ROOT / "vendor" / directory)]
    sys.modules[namespace] = package
    spec = importlib.util.spec_from_file_location(f"{namespace}.{module}", ROOT / "vendor" / directory / f"{module}.py")
    engine = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = engine
    spec.loader.exec_module(engine)
    return engine, sys.modules[f"{namespace}.data"]


def summarize(reporting, month, view="month"):
    # No financial formulas here: sign and account aggregation belong to source totals().
    return {str(key): reporting.totals(month, view, key)["forecast"] for key, _ in METRICS}


def lines(baseline, current):
    return [dict(id=str(key), name=name, baseline=dollars(baseline[str(key)]),
                 current=dollars(current[str(key)]), difference=dollars(current[str(key)] - baseline[str(key)]))
            for key, name in METRICS]


def run(adjustment=0):
    adjustment = validate_adjustment(adjustment)
    hashes = verify_sources()
    prefix = "_finance_" + uuid.uuid4().hex
    try:
        forecasting, fd = load_engine(prefix + "_forecast", "forecast", "calculations")
        reporting, rd = load_engine(prefix + "_report", "reporting", "reporting")
        with tempfile.TemporaryDirectory(prefix="finance-proof-", dir="/tmp") as tmp:
            fd.DB_PATH = Path(tmp) / "forecast.sqlite3"
            rd.DB_PATH = Path(tmp) / "report.sqlite3"
            initialize(fd, rd)
            def projection(amount):
                return forecasting.project(SimpleNamespace(method="forecast", revenueGrowth=0,
                    headcountCost=0, account="Contractors", accountAdjustment=amount))["rows"]
            with rd.connect() as db:
                replace_forecast(db, projection(0))
            base = {m: summarize(reporting, m) for m in range(1, 13)}
            with rd.connect() as db:
                replace_forecast(db, projection(adjustment))
            current = {m: summarize(reporting, m) for m in range(1, 13)}
            # Period selection through original YTD aggregator, not a new report algorithm.
            full = summarize(reporting, 12, "ytd")
            closed = summarize(reporting, 9, "ytd")
            quarter = {key: full[key] - closed[key] for key in full}
            with rd.connect() as db:
                replace_forecast(db, projection(0))
            base_full, base_closed = summarize(reporting, 12, "ytd"), summarize(reporting, 9, "ytd")
            base_quarter = {key: base_full[key] - base_closed[key] for key in base_full}
            return dict(adjustment=adjustment, currency="USD", period="Q4 2026",
                lines=lines(base_quarter, quarter),
                months=[dict(period=f"2026-{m:02d}", lines=lines(base[m], current[m])) for m in (10, 11, 12)],
                note="Synthetic Operations / Service Delivery + Supply Chain. Q3 Forecast baseline; Q4 projection, not actuals. Integer-cent bridge; original engines unchanged.",
                sourceHashes=hashes)
    finally:
        for name in list(sys.modules):
            if name.startswith(prefix):
                del sys.modules[name]
