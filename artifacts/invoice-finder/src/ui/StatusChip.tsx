import type { Status } from "../domain/types.ts";

const LABEL: Record<Status, string> = { pending: "Pending", approved: "Approved, unpaid", rejected: "Rejected", paid: "Paid" };
export function StatusChip({ status }: { status: Status }) {
  return <span className={`chip chip-${status}`} data-testid={`status-${status}`}>{LABEL[status]}</span>;
}
