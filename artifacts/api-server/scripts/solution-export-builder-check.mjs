import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "export-builder-check-"));
try {
  const outfile = join(directory, "builder.test.cjs");
  await build({
    entryPoints: [join(root, "src/lib/solution-export-builder.test.ts")],
    bundle: true, platform: "node", format: "cjs", outfile,
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ["--test", outfile], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => resolveExit(code ?? 1));
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}
