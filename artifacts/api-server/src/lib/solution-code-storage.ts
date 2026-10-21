import { Storage } from "@google-cloud/storage";

// App Storage sidecar credentials, identical to intake-files; never public URLs.
const storage = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: "http://127.0.0.1:1106/token",
    type: "external_account",
    credential_source: {
      url: "http://127.0.0.1:1106/credential",
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export function storedCodePackageFile(objectPath: string) {
  if (!/^solution-code\/[a-f0-9]{64}\.zip$/.test(objectPath)) {
    throw new Error("Invalid code package object path.");
  }
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!root) throw new Error("Private code package storage is not configured.");
  const parts = root.replace(/^\/+/, "").split("/");
  const bucket = parts.shift();
  if (!bucket || !parts.length || parts.some((part) => !part || part === ".." || part === ".")) {
    throw new Error("Private code package storage configuration is invalid.");
  }
  return storage.bucket(bucket).file(`${parts.join("/")}/${objectPath}`);
}
