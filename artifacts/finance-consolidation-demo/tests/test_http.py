"""Cheap end-to-end transport checks; run against managed preview or localhost."""
import concurrent.futures
import http.client
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

base = ""

def request(payload):
    req = urllib.request.Request(base + "api/run", data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

if __name__ == "__main__":
    base = sys.argv[1].rstrip("/") + "/"
    for amount, difference in [(0, "0.00"), (360, "-360.00"), (360, "-360.00"), (0, "0.00")]:
        code, data = request({"adjustment": amount})
        assert code == 200, (code, data)
        assert data["lines"][3]["difference"] == difference
    for invalid in ({}, {"adjustment": 1}, {"adjustment": 360, "path": "/tmp"}, {"adjustment": None}):
        code, data = request(invalid)
        assert code == 400 and "error" in data, (code, data)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(request, [{"adjustment": 360}, {"adjustment": -600}]))
    assert [r[1]["lines"][3]["difference"] for r in results] == ["-360.00", "600.00"]
    parsed = urllib.parse.urlsplit(base)
    connection_type = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_type(parsed.hostname, parsed.port, timeout=15)
    connection.putrequest("POST", parsed.path + "api/run")
    connection.putheader("Content-Type", "application/json")
    connection.putheader("Transfer-Encoding", "chunked")
    connection.endheaders()
    # Separate writes/events after the limit is crossed used to send 413 twice.
    for chunk in (b"x" * 4096, b"y" * 1024, b"z" * 1024, b"w" * 1024):
        connection.send(f"{len(chunk):X}\r\n".encode() + chunk + b"\r\n")
        time.sleep(0.05)
    connection.send(b"0\r\n\r\n")
    response = connection.getresponse()
    assert response.status == 413, response.status
    assert json.loads(response.read()) == {"error": "Request too large."}
    connection.close()
    code, data = request({"adjustment": 0})
    assert code == 200 and data["lines"][3]["difference"] == "0.00", "Server must remain healthy after rejection"
    print(json.dumps({"passed": True, "checks": ["baseline", "apply", "repeat", "reset", "invalid", "extra fields", "missing", "null", "concurrent isolation", "oversized multi-chunk request", "healthy after oversized rejection"]}))
