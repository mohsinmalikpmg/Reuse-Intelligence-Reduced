export type ReportLine = { id: string; name: string; baseline: string; current: string; difference: string };
export type FinanceResult = {
  adjustment: number;
  currency: string;
  period: string;
  lines: ReportLine[];
  months: { period: string; lines: ReportLine[] }[];
  note: string;
  sourceHashes: { path: string; sha256: string }[];
};

export async function applyForecast(adjustment: number, signal?: AbortSignal): Promise<FinanceResult> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/run`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adjustment }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The calculation could not be completed. Please retry.");
  return data;
}
