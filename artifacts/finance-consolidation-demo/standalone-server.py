"""Local demonstration server for an immutable exported configuration."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parent
LIMIT = threading.BoundedSemaphore(4)


class Handler(BaseHTTPRequestHandler):
    def send(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self.send(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/config":
            self.send(200, (ROOT / "saved-wiring.json").read_bytes())
        else:
            self.send(404, b'{"error":"Not found"}')

    def do_POST(self):
        if self.path != "/api/run":
            return self.send(404, b'{"error":"Not found"}')
        try:
            self.connection.settimeout(10)
            if self.headers.get("Transfer-Encoding"):
                raise ValueError("Chunked requests are not supported.")
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 128:
                raise ValueError("Expected an empty JSON object.")
            if json.loads(self.rfile.read(size)) != {}:
                raise ValueError("This exported configuration is immutable. Edit it in Workbench.")
        except (ValueError, TimeoutError):
            self.close_connection = True
            return self.send(400, b'{"error":"Use an empty JSON object to run this saved version."}')
        if not LIMIT.acquire(blocking=False):
            return self.send(503, b'{"error":"Busy; please retry."}')
        try:
            saved = json.loads((ROOT / "saved-wiring.json").read_text())
            process = subprocess.run([sys.executable, "-B", str(ROOT / "wiring-worker.py")],
                input=json.dumps({"action": "run", "config": saved["config"]}).encode(),
                capture_output=True, timeout=15, cwd=ROOT,
                env={"PATH": os.defpath, "PYTHONNOUSERSITE": "1"})
            if process.returncode:
                return self.send(500, b'{"error":"Calculation failed. Check the saved configuration and source hashes."}')
            result = json.loads(process.stdout)
            if result["fingerprint"] != saved["version"]["fingerprint"]:
                return self.send(409, b'{"error":"Saved configuration or source fingerprint changed."}')
            self.send(200, process.stdout)
        except Exception:
            self.send(500, b'{"error":"Calculation failed or timed out."}')
        finally:
            LIMIT.release()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "3000"))
    print(f"Saved finance wiring listening on port {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
