"""Build a deterministic source ZIP from the reviewed, explicit file allowlist.

Run with Python 3 from this app directory. No dependency installation is needed.
Generated outputs are ignored; original content-addressed archives are preserved.
"""
import hashlib
import io
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
files = json.loads((root / "package-files.json").read_text())
if not isinstance(files, list) or len(set(files)) != len(files):
    raise ValueError("Allowlist must contain unique relative file paths")
contents = {}
for name in sorted(files):
    path = root / name
    if (not isinstance(name, str) or name.startswith("/") or
        any(part in {"..", "node_modules", "dist", ".agents", ".git",
                     "generated-artifacts", ".replit-artifact"} for part in Path(name).parts) or
        any(part.startswith(".env") for part in Path(name).parts) or
        path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root)):
        raise ValueError(f"Unsafe or missing allowlisted source: {name}")
    contents[name] = path.read_bytes()
manifest = {
    "algorithm": "sha256",
    "scope": "Exact archive source bytes; excludes this derived manifest",
    "files": [{"path": name, "bytes": len(data),
               "sha256": hashlib.sha256(data).hexdigest()}
              for name, data in contents.items()],
}
contents["source-hashes.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, data in contents.items():
        info = zipfile.ZipInfo(name, date_time=(2026, 9, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data)
payload = buffer.getvalue()
digest = hashlib.sha256(payload).hexdigest()
output = root / "generated-artifacts"
output.mkdir(exist_ok=True)
slug = json.loads(contents["package.json"])["name"].split("/")[-1]
target = output / f"{slug}-{digest[:16]}.zip"
if target.exists() and target.read_bytes() != payload:
    raise ValueError("Refusing to overwrite an existing original archive")
target.write_bytes(payload)
target.with_suffix(".sha256").write_text(f"{digest}  {target.name}\n")
print(target)
