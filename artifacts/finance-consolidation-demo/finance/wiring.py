"""User-configurable, allowlisted wiring around unchanged reviewed engines."""
import hashlib
import json
import sys
import tempfile
import uuid
from pathlib import Path
from types import SimpleNamespace
from .adapter import ACCOUNTS, CENTRES, dollars, replace_forecast, validate_adjustment
from .fixtures import initialize
from .harness import ROOT, load_engine, verify_sources

DEFAULT_CONFIG = {
    "schemaVersion": 1, "method": "forecast", "account": "Contractors",
    "adjustment": 360, "centres": list(CENTRES), "period": "q4",
    "accountMapping": {name: i for i, name in enumerate(ACCOUNTS)},
}
METHODS = {"forecast": "Q3 forecast", "ytd": "Jan–Sep average", "last3": "Jul–Sep average"}
PERIODS = {"q4": "Q4 2026", "october": "October 2026", "november": "November 2026", "december": "December 2026"}
ADJUSTABLE = ["Contractors", "Software & Licences", "Professional Fees"]
METRICS = [(str(i), name, i) for i, name in enumerate(ACCOUNTS)] + [
    ("opex", "Operating Expenses", "opex"), ("profit", "Operating Profit", "profit")]


def canonical_config(config):
    if not isinstance(config, dict) or set(config) != set(DEFAULT_CONFIG):
        raise ValueError("Supply exactly the supported wiring fields; arbitrary connections are not executable.")
    if type(config["schemaVersion"]) is not int or config["schemaVersion"] != 1:
        raise ValueError("Unsupported wiring contract version.")
    if config["method"] not in METHODS:
        raise ValueError("Unsupported forecast method.")
    if config["account"] not in ADJUSTABLE:
        raise ValueError("Choose Contractors, Software & Licences or Professional Fees.")
    if config["period"] not in PERIODS:
        raise ValueError("Only open Q4 periods are supported; historical actuals cannot be rewired.")
    adjustment = validate_adjustment(config["adjustment"])
    centres = config["centres"]
    if not isinstance(centres, list) or not centres or any(type(c) is not str or c not in CENTRES for c in centres):
        raise ValueError("Select at least one reviewed Operations cost centre.")
    if len(centres) != len(set(centres)):
        raise ValueError("Duplicate cost centres are not allowed.")
    mapping = config["accountMapping"]
    if not isinstance(mapping, dict) or set(mapping) != set(ACCOUNTS):
        raise ValueError("Map every source account exactly once; missing and unknown accounts are blockers.")
    for source, target in mapping.items():
        allowed = [0] if source == "Revenue" else [1] if source == "COGS" else list(range(2, 10))
        if type(target) is not int or target not in allowed:
            raise ValueError(f"{source}: preserve revenue/COGS/expense classification; choose a supported target.")
    return {**config, "adjustment": adjustment,
            "centres": [c for c in CENTRES if c in centres],
            "accountMapping": {name: mapping[name] for name in ACCOUNTS}}


def fingerprint(config):
    # A saved receipt pins both the original engines and the connecting code.
    # Updating adapter semantics must not silently change an older export.
    bridge = {name: hashlib.sha256((ROOT / "finance" / name).read_bytes()).hexdigest()
              for name in ("adapter.py", "fixtures.py", "harness.py", "wiring.py")}
    payload = {"config": config, "sources": verify_sources(), "bridge": bridge}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate(config):
    try:
        canonical = canonical_config(config)
        return {"valid": True, "errors": [], "config": canonical, "fingerprint": fingerprint(canonical)}
    except (ValueError, TypeError) as error:
        return {"valid": False, "errors": [str(error)]}


def catalog():
    return {
        "defaultConfig": DEFAULT_CONFIG,
        "accounts": [{"id": i, "name": name} for i, name in enumerate(ACCOUNTS)],
        "centres": [{"id": ident, "name": name} for name, ident in CENTRES.items()],
        "methods": [{"id": key, "label": label} for key, label in METHODS.items()],
        "periods": [{"id": key, "label": label} for key, label in PERIODS.items()],
        "sources": verify_sources(),
        "connections": [
            {"from": "Synthetic forecast ledger", "to": "Budget & Forecast · project()",
             "contract": "FY2026, selected Operations centres; integer cents become dollar rows through original data.rows()."},
            {"from": "Projected dollar rows", "to": "Validated finance adapter",
             "contract": "Complete grid, null future actuals, explicit source→target accounts, dollars→integer cents."},
            {"from": "Reporting ledger (integer cents)", "to": "Management Reporting · totals()",
             "contract": "Original SQL/account grouping calculates the selected period; only final presentation converts to USD."},
        ],
        "limitations": [
            "Reviewed local components only; arbitrary uploads, code paths and connectors cannot run.",
            "Revenue and COGS cannot be reclassified as expenses. Expense mappings may combine into one target.",
            "Cost-centre identities are fixed by exact source matches; selection is editable, ambiguous remapping is not.",
            "Currency USD and the cents conversion are fixed safety contracts, not editable multipliers.",
            "Synthetic data only. Baseline uses the same mappings/centres with Q3 forecast and zero adjustment.",
            "Report figures are forecasts, not future actuals. No commentary or original export modules are claimed.",
        ],
    }


def run_config(raw_config):
    config = canonical_config(raw_config)
    config_hash = fingerprint(config)
    prefix = "_wiring_" + uuid.uuid4().hex
    try:
        forecasting, fd = load_engine(prefix + "_f", "forecast", "calculations")
        reporting, rd = load_engine(prefix + "_r", "reporting", "reporting")
        with tempfile.TemporaryDirectory(prefix="finance-wiring-", dir="/tmp") as tmp:
            fd.DB_PATH, rd.DB_PATH = Path(tmp) / "f.sqlite3", Path(tmp) / "r.sqlite3"
            initialize(fd, rd)
            # Wiring fixture has a documented recent run-rate change so choosing
            # an original projection method has an observable effect.
            with fd.connect() as db:
                db.execute("UPDATE actuals SET amount=amount+3000 WHERE account='Contractors' AND month BETWEEN 7 AND 9")
                db.execute("UPDATE forecast SET amount=amount+3000 WHERE account='Contractors' AND month BETWEEN 7 AND 9")
            # Filter input before original projection so total adjustment is allocated
            # by that engine over the selected centres, never redistributed afterward.
            with fd.connect() as db:
                for centre in CENTRES:
                    if centre not in config["centres"]:
                        for table in ("budget", "actuals", "forecast"):
                            db.execute(f"DELETE FROM {table} WHERE cost_centre=?", (centre,))
            def execute(method, amount):
                rows = forecasting.project(SimpleNamespace(method=method, revenueGrowth=0,
                    headcountCost=0, account=config["account"], accountAdjustment=amount))["rows"]
                with rd.connect() as db:
                    replace_forecast(db, rows, config["centres"], config["accountMapping"])
                return {
                    m: {key: reporting.totals(m, "month", selector)["forecast"] for key, _, selector in METRICS}
                    for m in (10, 11, 12)
                }
            baseline = execute("forecast", 0)
            current = execute(config["method"], config["adjustment"])
            def make_lines(before, after):
                return [dict(id=key, name=name, baseline=dollars(before[key]),
                             current=dollars(after[key]), difference=dollars(after[key] - before[key]))
                        for key, name, _ in METRICS]
            selected = [10, 11, 12] if config["period"] == "q4" else [
                {"october": 10, "november": 11, "december": 12}[config["period"]]]
            before = {key: sum(baseline[m][key] for m in selected) for key, _, _ in METRICS}
            after = {key: sum(current[m][key] for m in selected) for key, _, _ in METRICS}
            return {
                "config": config, "fingerprint": config_hash, "adjustment": config["adjustment"],
                "currency": "USD", "period": PERIODS[config["period"]],
                "lines": make_lines(before, after),
                "months": [{"period": f"2026-{m:02d}", "lines": make_lines(baseline[m], current[m])} for m in selected],
                "note": "Synthetic FY2026 forecast. Baseline: Q3 Forecast, zero adjustment, same selected centres and mappings. July–September contractor actuals are $30 higher per centre to demonstrate run-rate methods. Adjustment is total Q4 even when one report month is selected.",
                "sourceHashes": verify_sources(),
            }
    finally:
        for name in list(sys.modules):
            if name.startswith(prefix):
                del sys.modules[name]
