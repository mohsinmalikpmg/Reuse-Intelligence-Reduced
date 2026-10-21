import concurrent.futures
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid
import sys
import zipfile
from types import SimpleNamespace
from finance.adapter import adapt_rows, dollars_to_cents, dollars, replace_forecast, validate_adjustment
from finance.fixtures import initialize
from finance.harness import ROOT, load_engine, run, summarize, verify_sources


class IntegrationTests(unittest.TestCase):
    def test_known_change_independent_expectations(self):
        result = run(360)
        # Hand-derived from fixed fixture cents, not source helper calculations:
        # 2 centres: monthly revenue 30000.03, COGS 6000,
        # salaries 9000 + contractors 3000.03; Q4 = three months.
        expected = [
            ("90000.09", "90000.09", "0.00"),
            ("18000.00", "18000.00", "0.00"),
            ("36000.09", "36360.09", "360.00"),
            ("36000.00", "35640.00", "-360.00"),
        ]
        self.assertEqual([(r["baseline"], r["current"], r["difference"]) for r in result["lines"]], expected)
        self.assertEqual([m["period"] for m in result["months"]], ["2026-10", "2026-11", "2026-12"])
        for month in result["months"]:
            self.assertEqual(month["lines"][2]["difference"], "120.00")
            self.assertEqual(month["lines"][3]["difference"], "-120.00")

    def test_baseline_reset_repeat_and_negative(self):
        self.assertEqual(run(360), run(360))
        self.assertTrue(all(r["difference"] == "0.00" for r in run(0)["lines"]))
        self.assertEqual(run(-600)["lines"][3]["difference"], "600.00")

    def test_currency_precision(self):
        self.assertEqual(dollars_to_cents(10000.01), 1000001)
        self.assertEqual(dollars(1000001), "10000.01")
        self.assertEqual(dollars(-1), "-0.01")
        for value in (None, True, float("nan"), float("inf"), 0.001, "1.00"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                dollars_to_cents(value)

    def test_invalid_assumptions(self):
        for value in (None, True, "360", 1, 6.5, -606, 6006, float("nan"), float("inf")):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_adjustment(value)

    def test_concurrent_requests_isolated(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(run, [0, 360, -600]))
        self.assertEqual([r["lines"][3]["difference"] for r in results], ["0.00", "-360.00", "600.00"])

    def test_source_hashes_and_archive_preservation(self):
        self.assertEqual(len(verify_sources()), 4)
        manifest = json.loads((ROOT / "provenance.json").read_text())
        archive_dir = ROOT.parents[1] / "attached_assets"
        for archive in manifest["archives"]:
            path = archive_dir / archive["filename"]
            if not path.exists():
                continue  # standalone package has vendored hashes; original archives optional
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), archive["sha256"])
            with zipfile.ZipFile(path) as z:
                for module in manifest["modules"]:
                    if module["archive"] == archive["filename"]:
                        self.assertEqual(z.read(module["originalPath"]), (ROOT / module["path"]).read_bytes())


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="finance-test-", dir="/tmp")
        self.prefix = "_test_" + uuid.uuid4().hex
        self.forecast, self.fd = load_engine(self.prefix + "_f", "forecast", "calculations")
        self.report, self.rd = load_engine(self.prefix + "_r", "reporting", "reporting")
        self.fd.DB_PATH = Path(self.tmp.name) / "f.sqlite3"
        self.rd.DB_PATH = Path(self.tmp.name) / "r.sqlite3"
        initialize(self.fd, self.rd)
        self.rows = self.forecast.project(SimpleNamespace(method="forecast", revenueGrowth=0,
            headcountCost=0, account="Contractors", accountAdjustment=360))["rows"]

    def tearDown(self):
        for name in list(sys.modules):
            if name.startswith(self.prefix):
                del sys.modules[name]
        self.tmp.cleanup()

    def test_period_alignment_and_original_forecast_execution(self):
        for row in self.rows:
            if row["month"] <= 9:
                self.assertEqual(row["q3"], row["actual"])
            else:
                self.assertIsNone(row["actual"])
                expected = row["budget"] + (60 if row["account"] == "Contractors" else 0)
                self.assertAlmostEqual(row["q3"], expected, places=2)

    def test_idempotent_application_and_aggregation(self):
        with self.rd.connect() as db:
            replace_forecast(db, self.rows)
            replace_forecast(db, self.rows)
            self.assertEqual(db.execute("SELECT count(*) FROM ledger").fetchone()[0], 240)
        self.assertEqual(summarize(self.report, 10)["profit"], 1188000)
        self.assertEqual(summarize(self.report, 9)["profit"], 1200000)
        self.assertEqual(summarize(self.report, 12, "ytd")["profit"], 14364000)

    def test_missing_mapping_fields_duplicates_and_periods_rejected(self):
        mutations = [
            ("costCentre", "Finance"), ("businessUnit", "Corporate"), ("account", "Unknown"),
            ("month", 0), ("month", 13), ("month", True), ("q3", None),
            ("q3", 1.001), ("actual", None),
        ]
        for field, value in mutations:
            rows = copy.deepcopy(self.rows)
            rows[0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                adapt_rows(rows)
        rows = copy.deepcopy(self.rows)
        del rows[0]["q2"]
        for invalid in (rows, self.rows[:-1], self.rows + [self.rows[0]]):
            with self.assertRaises(ValueError):
                adapt_rows(invalid)
        rows = copy.deepcopy(self.rows)
        next(r for r in rows if r["month"] == 10)["actual"] = 0
        with self.assertRaises(ValueError):
            adapt_rows(rows)

    def test_bad_application_preserves_previous_report(self):
        with self.rd.connect() as db:
            replace_forecast(db, self.rows)
            before = db.execute("SELECT sum(amount) FROM ledger").fetchone()[0]
            with self.assertRaises(ValueError):
                replace_forecast(db, self.rows[:-1])
            self.assertEqual(db.execute("SELECT sum(amount) FROM ledger").fetchone()[0], before)

    def test_reporting_dollar_semantics_and_cent_lift_are_equivalent(self):
        with self.rd.connect() as db:
            db.executemany("INSERT INTO ledger(year,month,scenario,cc_id,account_id,amount) VALUES(2026,10,'forecast',3,?,?)",
                           [(0, 100), (1, 20), (3, 30)])
        self.assertEqual(self.report.totals(10, "month", "profit")["forecast"], 50)
        with self.rd.connect() as db:
            db.execute("UPDATE ledger SET amount=amount*100")
        self.assertEqual(dollars(self.report.totals(10, "month", "profit")["forecast"]), "50.00")


if __name__ == "__main__":
    unittest.main()
