import { Storage } from "@google-cloud/storage";
import { MAX_ARCHIVE } from "./solution-package-archive";
const storage = new Storage({ projectId: "", credentials: {
  audience:"replit",subject_token_type:"access_token",token_url:"http://127.0.0.1:1106/token",type:"external_account",
  credential_source:{url:"http://127.0.0.1:1106/credential",format:{type:"json",subject_token_field_name:"access_token"}},universe_domain:"googleapis.com",
} });
export function packageObject(path: string) {
  if (!/^solution-packages\/(staging\/[a-f0-9-]{36}|originals\/[a-f0-9]{64}\.zip)$/.test(path)) throw new Error("Invalid package object path.");
  const root = process.env.PRIVATE_OBJECT_DIR?.replace(/^\/+|\/+$/g,"");
  if (!root) throw new Error("Private package storage is not configured.");
  const [bucket,...parts] = root.split("/");
  if (!bucket || !parts.length || parts.some(p=>!p || p===".." || p===".")) throw new Error("Invalid private storage configuration.");
  return storage.bucket(bucket).file(`${parts.join("/")}/${path}`);
}
export async function packageUploadUrl(path: string) {
  const file = packageObject(path);
  const response = await fetch("http://127.0.0.1:1106/object-storage/signed-object-url", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({bucket_name:file.bucket.name,object_name:file.name,method:"PUT",expires_at:new Date(Date.now()+10*60_000).toISOString()}),
    signal:AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Storage upload signing failed.");
  const result = await response.json() as {signed_url?:unknown};
  if (typeof result.signed_url !== "string") throw new Error("Storage returned no upload URL.");
  return result.signed_url as string;
}
export async function readStagedPackage(path: string) {
  const file = packageObject(path);
  const [metadata] = await file.getMetadata();
  if (!metadata.generation || Number(metadata.size) > MAX_ARCHIVE) throw new Error("Uploaded ZIP exceeds 20 MiB or has no generation.");
  const pinned = file.bucket.file(file.name,{generation:metadata.generation});
  const stream = pinned.createReadStream();
  const timer = setTimeout(()=>stream.destroy(new Error("Package read timed out.")),20_000);
  const chunks:Buffer[]=[];let size=0;
  try {
    for await (const chunk of stream) {
      size+=chunk.length;
      if(size>MAX_ARCHIVE) { stream.destroy();throw new Error("Uploaded ZIP exceeds 20 MiB."); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {clearTimeout(timer);}
}
export async function savePackageOriginal(hash:string,data:Buffer) {
  const path=`solution-packages/originals/${hash}.zip`;
  try { await packageObject(path).save(data,{resumable:false,contentType:"application/zip",preconditionOpts:{ifGenerationMatch:0}}); }
  catch (e) { if ((e as {code?:number}).code!==412) throw e; }
  return path;
}
