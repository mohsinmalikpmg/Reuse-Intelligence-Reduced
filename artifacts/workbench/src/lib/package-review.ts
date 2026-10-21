export type MappingRow = {
  capabilityId: string;
  file: string;
  decision: "proposed" | "approved" | "rejected";
  note: string;
};

export function reviewDecisions(rows: MappingRow[]) {
  return rows.map(row => {
    if (!row.capabilityId || !row.file || row.decision === "proposed") {
      throw new Error("Explicitly approve or reject every mapping before saving.");
    }
    return { ...row, decision: row.decision };
  });
}
