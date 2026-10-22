/** Test-only mapping snapshots. These exercise deterministic acceptance/planning code,
 * not semantic quality or requirement fulfillment. Real model paths have a separate smoke check. */
import type { Brief, LibraryCodePackage } from "@workspace/api-zod";
import { assessCode } from "../src/lib/code-assessment";
import { analyze } from "../src/lib/ai-analysis";

const mappings: Record<string, { ids: string[]; partial?: boolean; constraint?: boolean }> = {
  "Summarize maintenance notes": { ids: ["cap-summarize"] },
  "Identify recurring equipment issues": { ids: ["cap-recurring"] },
  "Provide a supervisor review queue": { ids: ["cap-review-queue"] },
  "Provide supervisor review": { ids: ["cap-review-queue"] },
  "Cluster similar equipment issues across sites": { ids: ["cap-clustering"] },
  "Highlight safety hazards": { ids: ["cap-safety-signals"] },
  "Cluster similar equipment issues across sites and highlight safety hazards": { ids: ["cap-clustering", "cap-safety-signals"] },
  "Rank issues": { ids: ["cap-similarity"] },
  "Provide original work-order links": { ids: ["cap-summarize"], partial: true },
  "Require human approval": { ids: ["cap-approval"], partial: true },
  "Send email notifications": { ids: ["cap-notify"], partial: true },
  "Do not perform automatic updates.": { ids: [], constraint: true },
  "Support read-only review across two sites.": { ids: [], constraint: true },
  "Do not summarize maintenance notes": { ids: [], constraint: true },
  "No automatic updates": { ids: [], constraint: true },
  "Don't summarize maintenance notes": { ids: [], constraint: true },
  "No safety alerts": { ids: [], constraint: true },
};
export async function fixtureAssessCode(brief: Brief, pkg: LibraryCodePackage) {
  const analyzer: typeof analyze = async opts => ({
    data: opts.schema.parse({ requirements: brief.requirements.map(r => {
      const mapping = mappings[r.text] ?? { ids: [] };
      return { id: r.id, capabilityIds: mapping.ids, constraint: !!mapping.constraint, complete: !!mapping.ids.length && !mapping.partial && !mapping.constraint,
        reason: "Injected mapping snapshot for deterministic downstream checks only.", limitations: mapping.partial ? ["Incomplete test mapping."] : [] };
    }) }),
    provenance: { id: "test-snapshot", model: "test-fixture", promptVersion: "test-only", inputFingerprint: "not-a-model-call", createdAt: new Date(0).toISOString(), cached: false },
  });
  return assessCode(brief, pkg, { analyzer });
}
