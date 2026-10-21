import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import socket
import unittest
import urllib.request
import urllib.error
import zipfile
from finance.harness import ROOT
from finance.wiring import DEFAULT_CONFIG, canonical_config, catalog, fingerprint, run_config, validate


def config(**changes):
    return {**copy.deepcopy(DEFAULT_CONFIG), **changes}


def line(result, key):
    return next(row for row in result["lines"] if row["id"] == str(key))


class WiringTests(unittest.TestCase):
    def test_default_matches_independent_quarter_expectation(self):
        result = run_config(config())
        self.assertEqual(line(result, "profit")["current"], "35640.00")
        self.assertEqual(line(result, 3)["difference"], "360.00")
        self.assertEqual(result["fingerprint"], fingerprint(result["config"]))

    def test_account_remapping_changes_real_report_rows(self):
        cfg = config()
        cfg["accountMapping"]["Contractors"] = 8
        result = run_config(cfg)
        self.assertEqual(line(result, 3)["current"], "0.00")
        self.assertEqual(line(result, 8)["current"], "9360.09")
        self.assertEqual(line(result, 8)["difference"], "360.00")
        self.assertEqual(line(result, "profit")["difference"], "-360.00")

    def test_selected_centre_receives_full_adjustment(self):
        result = run_config(config(centres=["Service Delivery"]))
        self.assertEqual(line(result, 0)["current"], "30000.03")
        self.assertEqual(line(result, 3)["current"], "3360.03")
        self.assertEqual(line(result, "profit")["current"], "11640.00")

    def test_report_period_does_not_change_total_adjustment_allocation(self):
        result = run_config(config(period="november"))
        self.assertEqual([r["period"] for r in result["months"]], ["2026-11"])
        self.assertEqual(line(result, "profit")["difference"], "-120.00")

    def test_original_projection_methods_change_run_rate(self):
        for method, extra in [("forecast", "0.00"), ("ytd", "60.00"), ("last3", "180.00")]:
            with self.subTest(method=method):
                result = run_config(config(method=method, adjustment=0))
                self.assertEqual(line(result, 3)["difference"], extra)

    def test_assumption_account_drives_selected_mapping(self):
        cfg = config(account="Software & Licences")
        cfg["accountMapping"]["Software & Licences"] = 8
        result = run_config(cfg)
        self.assertEqual(line(result, 8)["difference"], "360.00")
        self.assertEqual(line(result, 3)["difference"], "0.00")

    def test_invalid_connections_blocked(self):
        invalid = [config(method="unknown"), config(period="september"), config(centres=[]),
                   config(centres=["Unknown"]), config(centres=["Service Delivery"] * 2),
                   config(schemaVersion=True), config(adjustment=1), config(account="Revenue"),
                   {**config(), "currency": "EUR"}, config(accountMapping={})]
        cfg = config()
        cfg["accountMapping"]["Revenue"] = 3
        invalid.append(cfg)
        cfg = config()
        cfg["accountMapping"]["Contractors"] = True
        invalid.append(cfg)
        for cfg in invalid:
            with self.subTest(config=cfg):
                self.assertFalse(validate(cfg)["valid"])
                with self.assertRaises((ValueError, TypeError)):
                    run_config(cfg)

    def test_canonical_order_and_change_fingerprint(self):
        a = canonical_config(config())
        b = canonical_config(config(centres=list(reversed(a["centres"]))))
        self.assertEqual(fingerprint(a), fingerprint(b))
        self.assertNotEqual(fingerprint(a), fingerprint(canonical_config(config(period="october"))))
        self.assertEqual(len(catalog()["sources"]), 4)

    def test_changed_adjustment_matches_combined_and_export_workers(self):
        spec = importlib.util.spec_from_file_location("export_wiring", ROOT / "export-wiring.py")
        exporter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(exporter)
        results = []
        for adjustment in (0, 720):
            with self.subTest(adjustment=adjustment):
                cfg = config(adjustment=adjustment)
                payload = json.dumps({"action": "run", "config": cfg})
                # The combined app sends this full config to /api/finance-wiring/run;
                # the API executes this exact worker and action.
                combined = subprocess.run(
                    [sys.executable, "-B", str(ROOT / "wiring-worker.py")],
                    input=payload, text=True, capture_output=True, cwd=ROOT, timeout=20,
                    env={"PATH": os.defpath})
                self.assertEqual(combined.returncode, 0, combined.stderr)
                actual = json.loads(combined.stdout)
                self.assertEqual(actual["config"], cfg)
                archive_bytes = exporter.build_export({
                    "config": cfg,
                    "version": {"id": "adjustment-parity-test", "number": 1,
                                "fingerprint": actual["fingerprint"]},
                })
                with tempfile.TemporaryDirectory(prefix="finance-parity-", dir="/tmp") as folder:
                    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
                        archive.extractall(folder)
                    saved = json.loads((Path(folder) / "saved-wiring.json").read_text())
                    standalone = subprocess.run(
                        [sys.executable, "-B", str(Path(folder) / "wiring-worker.py")],
                        input=json.dumps({"action": "run", "config": saved["config"]}),
                        text=True, capture_output=True, cwd=folder, timeout=20,
                        env={"PATH": os.defpath})
                    self.assertEqual(standalone.returncode, 0, standalone.stderr)
                    self.assertEqual(json.loads(standalone.stdout), actual)
                    self.assertEqual(json.loads((Path(folder) / "expected-result.json").read_text()), actual)
                self.assertEqual(line(actual, 3)["difference"], f"{adjustment}.00")
                self.assertEqual(line(actual, "profit")["difference"], "0.00" if not adjustment else "-720.00")
                results.append(actual)
        self.assertNotEqual(results[0]["fingerprint"], results[1]["fingerprint"])
        self.assertNotEqual(results[0]["lines"], results[1]["lines"])

    def test_export_reexecutes_saved_config_without_workspace(self):
        spec = importlib.util.spec_from_file_location("export_wiring", ROOT / "export-wiring.py")
        exporter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(exporter)
        cfg = config(centres=["Supply Chain"], period="december", method="last3")
        cfg["accountMapping"]["Contractors"] = 8
        result = run_config(cfg)
        request = {"config": cfg, "version": {"id": "test-saved-version", "number": 2, "fingerprint": result["fingerprint"]}}
        archive_bytes = exporter.build_export(request)
        with tempfile.TemporaryDirectory(prefix="wiring-export-test-", dir="/tmp") as folder:
            with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
                names = archive.namelist()
                self.assertNotIn("node_modules", names)
                self.assertTrue(all(not name.startswith("/") and ".." not in Path(name).parts for name in names))
                archive.extractall(folder)
            proc = subprocess.run([sys.executable, "-B", str(Path(folder) / "wiring-worker.py")],
                input=json.dumps({"action": "run", "config": cfg}), text=True, capture_output=True,
                cwd=folder, timeout=20, env={"PATH": "/usr/bin:/bin"})
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(json.loads(proc.stdout), result)
            self.assertEqual(json.loads((Path(folder) / "saved-wiring.json").read_text()), request)
            self.assertEqual(json.loads((Path(folder) / "expected-result.json").read_text()), result)
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            server = subprocess.Popen([sys.executable, "-B", "server.py"], cwd=folder,
                env={"PATH": "/usr/bin:/bin", "PORT": str(port)}, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL)
            try:
                base = f"http://127.0.0.1:{port}"
                for attempt in range(30):
                    try:
                        with urllib.request.urlopen(base + "/api/config", timeout=1) as response:
                            self.assertEqual(json.load(response), request)
                        break
                    except OSError:
                        time.sleep(.1)
                else:
                    self.fail("Extracted server did not start")
                with urllib.request.urlopen(base, timeout=2) as response:
                    self.assertIn(b"Run saved wiring", response.read())
                run = urllib.request.Request(base + "/api/run", data=b"{}", headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(run, timeout=20) as response:
                    self.assertEqual(json.load(response), result)
                bad = urllib.request.Request(base + "/api/run", data=b'{"config":{}}', headers={"Content-Type": "application/json"})
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(bad, timeout=2)
                self.assertEqual(error.exception.code, 400)
            finally:
                server.terminate()
                server.wait(timeout=5)
        request["version"]["fingerprint"] = "0" * 64
        with self.assertRaises(ValueError):
            exporter.build_export(request)


if __name__ == "__main__":
    unittest.main()
