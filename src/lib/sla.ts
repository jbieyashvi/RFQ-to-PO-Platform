import type { BadgeTone } from '@/lib/labels';
import type { SalesOrder } from '@/types';

// ---------------------------------------------------------------------------
// 24-hour workflow SLAs (calendar hours, prototype).
//
// Two workflows carry an automatic, system-generated due date:
//   • PO vs Quote Verification — due 24h after the customer PO email arrived.
//   • Sales Order Revision     — due 24h after the revision request arrived.
// The due date is never picked by the user. The manually selected "Next Review
// Date" (reviewDate) remains a separate follow-up field and plays no part in
// the SLA.
// ---------------------------------------------------------------------------

export const SLA_HOURS = 24;

// Fixed prototype "now" — a mid-workday instant on the seeded TODAY, because
// hour-level SLA maths needs a time of day (TODAY in lib/format is midnight).
export const SLA_NOW = new Date('2026-08-13T12:00:00');

const pad2 = (n: number) => String(n).padStart(2, '0');
const toLocalIso = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;

/** Local-ISO timestamp exactly `hours` calendar hours before the prototype now. */
export function hoursBeforeNow(hours: number): string {
  return toLocalIso(new Date(SLA_NOW.getTime() - hours * 3_600_000));
}

/** System-generated due date: received time + 24 calendar hours. */
export function slaDueAt(receivedAt: string): string {
  return toLocalIso(new Date(new Date(receivedAt).getTime() + SLA_HOURS * 3_600_000));
}

export type SlaState = 'due_later' | 'due_today' | 'overdue' | 'completed';

export interface SlaInfo {
  state: SlaState;
  label: string;
  tone: BadgeTone;
  dueAt: string;
}

export function slaInfo(
  receivedAt: string | undefined,
  completed: boolean,
  now: Date = SLA_NOW
): SlaInfo | null {
  if (!receivedAt) return null;
  const due = new Date(new Date(receivedAt).getTime() + SLA_HOURS * 3_600_000);
  const dueAt = toLocalIso(due);
  if (completed) return { state: 'completed', label: 'Completed', tone: 'green', dueAt };
  const hours = (due.getTime() - now.getTime()) / 3_600_000;
  if (hours < 0) {
    return { state: 'overdue', label: `Overdue by ${Math.max(1, Math.floor(-hours))}h`, tone: 'red', dueAt };
  }
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  if (sameDay) return { state: 'due_today', label: 'Due Today', tone: 'amber', dueAt };
  return { state: 'due_later', label: `Due in ${Math.ceil(hours)}h`, tone: 'blue', dueAt };
}

/** Received timestamp for the PO vs Quote Verification SLA. */
export function poReceivedAtOf(so: SalesOrder): string | undefined {
  return so.poReceivedAt ?? (so.receivedDate ? `${so.receivedDate}T08:30:00` : undefined);
}

/** PO vs Quote Verification SLA — completed once the PO is verified. */
export function verificationSla(so: SalesOrder): SlaInfo | null {
  return slaInfo(poReceivedAtOf(so), so.verificationStatus === 'verified');
}

/** Received timestamp for the Sales Order Revision SLA. */
export function revisionReceivedAtOf(so: SalesOrder): string | undefined {
  return (
    so.revisionRequestedAt ??
    (so.revisionRequestedDate ? `${so.revisionRequestedDate}T10:15:00` : undefined)
  );
}
