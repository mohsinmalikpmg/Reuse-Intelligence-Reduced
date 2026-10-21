import app from "./app";
import { logger } from "./lib/logger";
import { ensureSeeded } from "./lib/seed";
import { loadGovernance } from "./lib/governance";
import { loadPrototypes } from "./lib/prototypes";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// The governance overlay (successor versions, dispositions) must be merged onto the catalog before any request reads a solution.
loadGovernance()
  .then(() => loadPrototypes())
  .then(() => {
    ensureSeeded().catch((err) => {
      logger.error({ err }, "Failed to seed demo scenario");
    });

    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to load governance overlay");
    process.exit(1);
  });
