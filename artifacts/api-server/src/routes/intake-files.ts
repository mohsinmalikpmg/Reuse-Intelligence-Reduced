import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { pool } from "@workspace/db";
import {
  IntakeFileError, MAX_FILE_BYTES, extractFile, inspectZip, privateObjectFile,
  safeFilename, saveOriginal, validateFile, type Extraction,
} from "../lib/intake-files";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
    fields: 1,
    parts: 2,
    fieldSize: 256,
    fieldNameSize: 40,
    headerPairs: 30,
  },
}).single("file");

function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated?.() || !req.user?.id) {
    res.status(401).json({ error: "Sign in to access intake files." });
    return;
  }
  next();
}

function sameOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.get("origin");
  const referer = req.get("referer");
  const site = req.get("sec-fetch-site");
  try {
    const source = new URL(origin || referer || "");
    // Do not trust a client-supplied X-Forwarded-Host as an origin allowlist.
    if (!["http:", "https:"].includes(source.protocol) ||
      source.host !== req.get("host") ||
      (site && site !== "same-origin" && site !== "none")) {
      throw new Error("cross-origin");
    }
  } catch {
    res.status(403).json({ error: "File uploads must originate from this application." });
    return;
  }
  next();
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function reportError(req: Request, res: Response, error: unknown, message: string) {
  if (error instanceof IntakeFileError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  // Never log source bytes/text, filenames, credentials, or upstream error bodies.
  req.log.error({ operation: "intake-files", errorType: error instanceof Error ? error.name : "Unknown" }, message);
  res.status(500).json({ error: message });
}

router.post("/intake/records/:id/files", requireUser, sameOrigin, async (req, res) => {
  const recordId = req.params.id;
  if (!validId(recordId)) {
    res.status(400).json({ error: "Invalid intake record ID." });
    return;
  }
  try {
    // Ownership is checked BEFORE multer reads or buffers any upload bytes.
    const record = await pool.query(
      "SELECT id FROM intake_records WHERE id = $1 AND user_id = $2",
      [recordId, req.user!.id],
    );
    if (!record.rowCount) {
      res.status(404).json({ error: "Intake record not found." });
      return;
    }
  } catch (error) {
    reportError(req, res, error, "Could not verify intake record ownership.");
    return;
  }
  upload(req, res, (error: unknown) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
          error: error.code === "LIMIT_FILE_SIZE"
            ? "Files must be 10 MB or smaller."
            : "Invalid multipart upload. Send exactly one file and one sourceId field.",
        });
      } else {
        res.status(400).json({ error: "The multipart file upload could not be read." });
      }
      return;
    }
    void processUpload(req, res, recordId);
  });
});

async function processUpload(req: Request, res: Response, recordId: string) {
  let objectPath: string | null = null;
  let stored = false;
  let persisted = false;
  try {
    const file = req.file;
    const sourceId: unknown = req.body?.sourceId;
    if (!file || !validId(sourceId) || !["problem", "prototype", "agent"].includes(sourceId) || Object.keys(req.body ?? {}).some((key) => key !== "sourceId")) {
      throw new IntakeFileError("Send one file and a sourceId of problem, prototype, or agent.");
    }
    const name = safeFilename(file.originalname);
    const validated = validateFile(name, file.mimetype, file.buffer);
    // Reject unsafe archives before saving. Inspection never extracts to disk.
    const zipResult = validated.kind === "zip" ? await inspectZip(file.buffer) : null;
    const id = randomUUID();
    objectPath = `intake/${id}`;
    await saveOriginal(objectPath, file.buffer, req.user!.id);
    stored = true;

    // Recheck ownership atomically with insertion (the record may have been
    // deleted during the upload). No updates to the intake model or revision.
    const inserted = await pool.query(
      `INSERT INTO intake_attachments
       (id, record_id, user_id, source_id, name, size, object_path, mime, status, text_content, error)
       SELECT $1, id, $3, $4, $5, $6, $7, $8, 'failed', '', $9
       FROM intake_records WHERE id = $2 AND user_id = $3
       RETURNING id`,
      [id, recordId, req.user!.id, sourceId, name, file.size, objectPath, validated.mime,
        "Extraction did not complete. Download the original or retry by re-uploading."],
    );
    if (!inserted.rowCount) throw new IntakeFileError("Intake record no longer exists.", 404);
    persisted = true;
    let extracted: Extraction;
    try {
      extracted = zipResult ?? await extractFile(file.buffer, validated);
    } catch (error) {
      req.log.warn({
        operation: "intake-file-extraction", fileId: id,
        errorType: error instanceof Error ? error.name : "Unknown",
      }, "Intake file extraction failed; original retained.");
      extracted = {
        status: "failed", text: "",
        error: validated.kind === "image"
          ? "Image reading failed or timed out. Your original is saved. Retry by re-uploading the image."
          : "Text extraction failed. The document may be corrupt, encrypted, or unsupported. Your original is saved; retry by re-uploading a readable version.",
      };
    }
    const updated = await pool.query(
      `UPDATE intake_attachments SET status = $1, text_content = $2, error = $3
       WHERE id = $4 AND user_id = $5 RETURNING id`,
      [extracted.status, extracted.text, extracted.error, id, req.user!.id],
    );
    if (!updated.rowCount) throw new IntakeFileError("Intake attachment no longer exists.", 404);
    res.status(201).json({ id, name, sourceId, size: file.size, ...extracted });
  } catch (error) {
    if (stored && !persisted && objectPath) {
      try {
        await privateObjectFile(objectPath).delete({ ignoreNotFound: true });
      } catch {
        req.log.error({ operation: "intake-file-cleanup" }, "Could not remove an unlinked private upload.");
      }
    }
    reportError(req, res, error, "Could not save the intake file. Please retry.");
  }
}

router.get("/intake/files/:fileId", requireUser, async (req, res) => {
  if (!validId(req.params.fileId)) {
    res.status(400).json({ error: "Invalid attachment ID." });
    return;
  }
  try {
    const result = await pool.query<{ name: string; object_path: string; size: number }>(
      `SELECT a.name, a.object_path, a.size FROM intake_attachments a
       JOIN intake_records r ON r.id = a.record_id
       WHERE a.id = $1 AND a.user_id = $2 AND r.user_id = $2`,
      [req.params.fileId, req.user!.id],
    );
    const attachment = result.rows[0];
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found." });
      return;
    }
    const file = privateObjectFile(attachment.object_path);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "The original file is no longer available in private storage." });
      return;
    }
    const name = safeFilename(attachment.name);
    const asciiName = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    const encodedName = encodeURIComponent(name).replace(/['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "Cache-Control": "private, no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    const stream = file.createReadStream();
    stream.once("error", () => {
      req.log.error({ operation: "intake-file-download" }, "Private attachment stream failed.");
      if (!res.headersSent) {
        res.removeHeader("Content-Disposition");
        res.status(502).json({ error: "The original file could not be downloaded. Please retry." });
      } else {
        res.destroy();
      }
    });
    res.once("close", () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    reportError(req, res, error, "Could not download the intake file.");
  }
});

export default router;
