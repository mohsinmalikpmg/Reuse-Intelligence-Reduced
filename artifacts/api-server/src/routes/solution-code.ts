import { Router, type IRouter } from "express";
import { pipeline } from "node:stream/promises";
import manifest from "../data/solution-code-manifest.json";
import { storedCodePackageFile } from "../lib/solution-code-storage";

const router: IRouter = Router();

router.get("/library/code-package", (_req, res) => {
  const { objectPath: _privatePath, ...publicManifest } = manifest;
  res.setHeader("Cache-Control", "no-store");
  res.json(publicManifest);
});

router.get("/library/code-packages/:packageId/download", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.isAuthenticated?.()) {
    res.status(401).json({ error: "Sign in to download the demo engine source package." });
    return;
  }
  if (req.params.packageId !== manifest.packageId) {
    res.status(404).json({ error: "Code package not found." });
    return;
  }
  try {
    const file = storedCodePackageFile(manifest.objectPath);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(503).json({ error: "The code package is unavailable in private storage." });
      return;
    }
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="demo-engine-${manifest.sha256.slice(0, 16)}.zip"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    await pipeline(file.createReadStream(), res);
  } catch {
    if (res.headersSent) res.destroy();
    else res.status(503).json({ error: "Could not download the private code package." });
  }
});

export default router;
