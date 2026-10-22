import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import {
  seedDemoConsolidationSources, consolidationSourceDownload,
  currentConsolidationSourceHash,
} from "../src/lib/consolidation-recipes";

// One-time operator setup of the five fixed, repository-owned demo inputs.
// No account is created or granted permission, and no arbitrary path is accepted.
try {
  const sources = await seedDemoConsolidationSources();
  assert.equal(sources.length, 5);
  for (const source of sources) {
    const download = await consolidationSourceDownload(source.id);
    assert.equal(download.bytes.length, source.size);
    assert.equal(await currentConsolidationSourceHash(source.id), source.sha256);
    console.info(`Verified: ${source.name}`);
  }
  console.info("Five sources registered and verified. Account permissions unchanged.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Demo registration failed.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
