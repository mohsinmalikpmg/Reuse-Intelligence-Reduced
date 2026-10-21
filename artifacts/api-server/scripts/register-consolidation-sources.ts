import { pool } from "@workspace/db";
import { registerConsolidationSources } from "../src/lib/consolidation-recipes";

// Explicit existing privileged actor; never create users or change authorization.
const actor = process.argv[2];
try {
  if (!actor || process.argv.length !== 3) throw new Error("Usage: register-consolidation-sources <existing-IT-user-id>");
  const registered = await registerConsolidationSources(actor);
  console.info(JSON.stringify(registered.map(s => ({ id: s.id, sha256: s.sha256, version: s.version })), null, 2));
} finally {
  await pool.end();
}
