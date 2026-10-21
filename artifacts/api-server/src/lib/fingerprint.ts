/**
 * Configuration fingerprints. A run's fingerprint is computed on the server from exactly what executed:
 * the sorted enabled capability ids (with their catalog versions), the sorted setting values, and the
 * catalog version. Evidence only counts when run B's fingerprint equals the case's current Version B.
 */
import { createHash } from "node:crypto";
import { CATALOG_VERSION, getCapability } from "../data/catalog";

export function configFingerprint(enabledCapabilityIds: string[], configValues: Record<string, string>): string {
  const caps = [...enabledCapabilityIds].sort().map((id) => `${id}@${getCapability(id)?.version ?? "?"}`);
  const settings = Object.entries(configValues)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  const material = `catalog:${CATALOG_VERSION}|caps:${caps.join(",")}|cfg:${settings.join(",")}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}
