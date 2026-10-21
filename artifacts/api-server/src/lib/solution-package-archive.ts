import { createHash } from "node:crypto";
import yauzl from "yauzl";

export const MAX_ARCHIVE = 20 * 1024 * 1024;
const MAX_EXPANDED = 60 * 1024 * 1024;
export const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");
export function validateEntry(path: string, mode: number, flags: number) {
  if (path.length > 500 || /[\\:\x00-\x1f\x7f]/.test(path) || path.startsWith("/") ||
      path.replace(/\/$/, "").split("/").some(p => p === ".." || p === "." || !p)) throw new Error("Unsafe ZIP entry path.");
  if ((mode & 0xf000) !== 0 && ![0x8000, 0x4000].includes(mode & 0xf000)) throw new Error("ZIP links and special files are forbidden.");
  if (flags & 1) throw new Error("Encrypted ZIP entries are forbidden.");
  if (/\.(zip|jar|war|tar|gz|tgz|bz2|xz|7z|rar|zst)$/i.test(path)) throw new Error("Nested archives are forbidden.");
}

export async function inspectSolutionArchive(buffer: Buffer) {
  if (buffer.length > MAX_ARCHIVE || buffer.length < 22) throw new Error("ZIP must be between 22 bytes and 20 MiB.");
  const files: {path:string;size:number;sha256:string}[] = [];
  const dependencies: {name:string;version:string;source:string}[] = [];
  const warnings = ["Static inspection only. Uploaded code has not been executed or sandbox-tested.", "Dependency declarations are unverified; no vulnerability or license audit was performed."];
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) { reject(error ?? new Error("Invalid ZIP.")); return; }
      let expanded = 0, count = 0, settled = false;
      const paths = new Set<string>();
      const fail = (e: Error) => { if (!settled) { settled = true; clearTimeout(timer); zip.close(); reject(e); } };
      const timer = setTimeout(() => fail(new Error("ZIP inspection timed out.")), 15_000);
      zip.on("error", fail);
      zip.on("end", () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } });
      zip.on("entry", entry => {
        try {
          if (++count > 500) throw new Error("ZIP exceeds 500 entries.");
          validateEntry(entry.fileName, entry.externalFileAttributes >>> 16, entry.generalPurposeBitFlag);
          const key = entry.fileName.normalize("NFC").toLowerCase().replace(/\/$/, "");
          if (paths.has(key)) throw new Error("Duplicate ZIP entry.");
          paths.add(key);
          if (entry.uncompressedSize > 5 * 1024 * 1024 || (expanded += entry.uncompressedSize) > MAX_EXPANDED ||
              entry.uncompressedSize > Math.max(1, entry.compressedSize) * 100) throw new Error("ZIP expansion limit exceeded.");
          if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) { fail(err ?? new Error("Cannot read ZIP entry.")); return; }
            const chunks: Buffer[] = []; let size = 0;
            stream.on("error", fail);
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > entry.uncompressedSize || size > 5 * 1024 * 1024) { stream.destroy(); fail(new Error("ZIP entry expansion mismatch.")); }
              else chunks.push(chunk);
            });
            stream.on("end", () => {
              if (settled) return;
              try {
                const data = Buffer.concat(chunks);
                if (size !== entry.uncompressedSize) throw new Error("Truncated ZIP entry.");
                if ((data[0]===0x50 && data[1]===0x4b && [0x03,0x05,0x07].includes(data[2])) ||
                    data.subarray(0,2).equals(Buffer.from([0x1f,0x8b])) ||
                    data.subarray(0,6).equals(Buffer.from("377abcaf271c","hex")) ||
                    data.subarray(0,4).toString() === "Rar!" ||
                    data.subarray(0,3).toString() === "BZh" ||
                    data.subarray(0,6).equals(Buffer.from("fd377a585a00","hex")) ||
                    data.subarray(0,4).equals(Buffer.from("28b52ffd","hex")) ||
                    data.subarray(257,262).toString() === "ustar") throw new Error("Nested archive content is forbidden.");
                files.push({ path: entry.fileName, sha256: digest(data), size });
                if (/(^|\/)package\.json$/.test(entry.fileName)) {
                  try {
                    const json = JSON.parse(data.toString("utf8"));
                    for (const field of ["dependencies","devDependencies","peerDependencies","optionalDependencies"]) {
                      if (json[field] && typeof json[field] === "object") for (const [name, version] of Object.entries(json[field])) {
                        if (dependencies.length >= 2000) throw new Error("Too many dependency declarations.");
                        if (typeof version === "string") dependencies.push({name:name.slice(0,200),version:version.slice(0,300),source:entry.fileName});
                      }
                    }
                  } catch { warnings.push(`Could not fully parse dependency declarations in ${entry.fileName}.`); }
                }
                if (/(^|\/)requirements[^/]*\.txt$/.test(entry.fileName)) {
                  for (const line of data.toString("utf8").split(/\r?\n/).slice(0,2000)) {
                    const m = line.match(/^([A-Za-z0-9_.-]+)\s*([=<>!~].*)?$/);
                    if (m && dependencies.length < 2000) dependencies.push({name:m[1], version:m[2] ?? "unspecified",source:entry.fileName});
                  }
                }
                zip.readEntry();
              } catch (e) { fail(e instanceof Error ? e : new Error("Invalid ZIP content.")); }
            });
          });
        } catch (e) { fail(e instanceof Error ? e : new Error("Invalid ZIP entry.")); }
      });
      zip.readEntry();
    });
  });
  if (!files.length) throw new Error("ZIP contains no files.");
  return { files, dependencies, warnings };
}
