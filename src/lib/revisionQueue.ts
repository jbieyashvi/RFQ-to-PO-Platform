import type { LineItem, Quotation, QuoteVersion, RequestedChange } from '@/types';
import { computeTotals } from '@/lib/format';

// ---------------------------------------------------------------------------
// Deterministic prototype clock. Due Date = Revision Requested + exactly 24h,
// and overdue / due-soon / upcoming states are computed against this fixed
// "now" (Asia/Kolkata wall-clock) so the demo always shows a representative
// mix of overdue, due-soon and future-due revisions.
// ---------------------------------------------------------------------------
export const NOW = new Date('2026-08-13T13:00:00');
export const HOUR = 3600 * 1000;
export const DAY = 24 * HOUR;
export const DUE_SOON_WINDOW = 4 * HOUR;

// Minutes between NOW and each revision's Due Date, cycled by queue position.
// Negative = already overdue; 0…240 = due within the next four hours; else upcoming.
// Ordered so even a short queue shows a representative mix (overdue → due-soon →
// upcoming) rather than a run of the same state.
export const REV_DUE_OFFSET_MINUTES = [-180, 150, 1440, -2880, 720, -90, 480, -30, 180, -300];
// One revision in the queue is intentionally left Unassigned to exercise that state.
export const REV_UNASSIGNED_AT = 2;

export const OFFICE_PREFIX: Record<string, string> = {
  'off-mum': 'MUM',
  'off-del': 'DEL',
  'off-blr': 'BLR',
  'off-ahm': 'AHM',
  'off-che': 'CHE',
};

export type DueState = 'overdue' | 'due_soon' | 'upcoming';

// "01 Aug 2026" — Asia/Kolkata wall-clock date.
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "09:00 AM" — 12-hour time.
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

// "01 Aug 2026, 09:00 AM" — single-line, used in mobile cards.
export function fmtDateTime(iso: string): string {
  if (isNaN(new Date(iso).getTime())) return iso;
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

export function overdueLabel(ms: number): string {
  const hours = Math.floor(ms / HOUR);
  if (hours < 24) return `Overdue by ${Math.max(1, hours)}h`;
  return `Overdue by ${Math.floor(hours / 24)}d`;
}

export function dueStateFor(dueMs: number): { state: DueState; overdueLabel?: string } {
  const left = dueMs - NOW.getTime();
  if (left <= 0) return { state: 'overdue', overdueLabel: overdueLabel(NOW.getTime() - dueMs) };
  if (left <= DUE_SOON_WINDOW) return { state: 'due_soon' };
  return { state: 'upcoming' };
}

// ---------------------------------------------------------------------------
// Requested changes — derived deterministically from a quotation's real line
// items and cycled commercial asks, so every record shows valid old → new data.
// ---------------------------------------------------------------------------
// Commercial asks are phrased so they map cleanly onto the structured revised-SO
// form: delivery uses a real Delivery Terms Master option name, payment uses the
// four payment-bucket labels, and warranty is a plain year count. This keeps
// "Requested changes" and what "Apply to revised SO" actually sets consistent.
const COMMERCIAL_CHANGES: Omit<RequestedChange, 'id'>[] = [
  { type: 'delivery', label: 'Delivery Terms', oldValue: 'Ex Works — Vadodara', newValue: 'FOR Destination' },
  { type: 'payment', label: 'Payment Terms', oldValue: '100% Advance', newValue: '50% Advance, 50% Before Dispatch' },
  { type: 'warranty', label: 'Warranty', oldValue: '1 Year', newValue: '2 Years' },
];

function money(v: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(Math.round(v))}`;
}

export function buildRequestedChanges(q: Quotation, seq: number): RequestedChange[] {
  const changes: RequestedChange[] = [];
  const items = q.items;

  // 1) Unit-price reduction on the first line (real catalogue item).
  if (items[0]) {
    const proposed = Math.max(1, Math.round((items[0].unitPrice * 0.9) / 10) * 10);
    changes.push({
      id: `rc-${q.id}-price`,
      type: 'unit_price',
      label: `Unit price — ${items[0].description}`,
      oldValue: money(items[0].unitPrice),
      newValue: money(proposed),
      itemId: items[0].id,
      field: 'unitPrice',
      itemProposed: proposed,
    });
  }

  // 2) Quantity reduction on the second line, when present.
  if (items[1] && items[1].quantity > 1) {
    const proposed = Math.max(1, items[1].quantity - 1);
    changes.push({
      id: `rc-${q.id}-qty`,
      type: 'quantity',
      label: `Quantity — ${items[1].description}`,
      oldValue: `${items[1].quantity} ${items[1].unit}`,
      newValue: `${proposed} ${items[1].unit}`,
      itemId: items[1].id,
      field: 'quantity',
      itemProposed: proposed,
    });
  }

  // 3) One commercial ask, cycled by queue position.
  const commercial = COMMERCIAL_CHANGES[seq % COMMERCIAL_CHANGES.length];
  changes.push({ ...commercial, id: `rc-${q.id}-comm` });

  return changes;
}

// Apply the proposed line-level values to a baseline set of items, producing the
// editable starting point for the Quote Generator. Users can still correct these.
export function applyProposed(items: LineItem[], changes: RequestedChange[] = []): LineItem[] {
  return items.map((it) => {
    const patch = changes.find((c) => c.itemId === it.id && c.field && typeof c.itemProposed === 'number');
    if (!patch) return { ...it };
    return { ...it, [patch.field as 'unitPrice' | 'quantity']: patch.itemProposed as number };
  });
}

export function grandTotalOf(items: LineItem[], packingCharges = 0): number {
  return computeTotals(items, packingCharges).grandTotal;
}

// Snapshot the CURRENT quote items as an immutable version. Used before applying
// a revised quote so the previous version is preserved, never overwritten.
export function buildVersions(q: Quotation, currentBy: string): {
  existing: QuoteVersion[];
  baseline: QuoteVersion;
} {
  const existing = q.quoteVersions ?? [];
  // Seed a V1 from the latest submitted quote the first time we revise.
  const baseline: QuoteVersion =
    existing.length > 0
      ? existing[existing.length - 1]
      : {
          id: `qv-${q.id}-1`,
          label: 'V1',
          version: 1,
          createdAt: `${q.quoteDate}T11:30:00`,
          by: q.owner,
          value: q.value,
          items: q.items.map((it) => ({ ...it })),
          paymentTerms: q.paymentTerms,
          deliveryTerms: q.deliveryTerms,
          warranty: q.warranty,
          packingCharges: q.packingCharges,
          otherTerms: q.otherTerms,
          note: 'Original quotation issued to customer',
          sent: true,
          sentAt: q.sentAt ?? `${q.quoteDate}T16:45:00`,
        };
  return { existing: existing.length > 0 ? existing : [baseline], baseline };
}

// ---------------------------------------------------------------------------
// Version snapshots — the read model behind "View Latest Quote" / "View
// Previous Quote" and behind the old → new highlighting in the revision modal.
//
// A snapshot is a self-contained quote: lines PLUS the commercial terms that
// version quoted. Older QuoteVersion records only carried lines, so terms fall
// back to the quotation's own — and when no version has been cut yet, the
// quotation itself IS the latest thing the customer received.
// ---------------------------------------------------------------------------
export interface QuoteSnapshot {
  label: string;
  value: number;
  items: LineItem[];
  paymentTerms: string;
  deliveryTerms: string;
  warranty: string;
  packingCharges: number;
  otherTerms: string;
  createdAt?: string;
  sentAt?: string;
  by?: string;
  note?: string;
}

function snapshotOf(q: Quotation, v: QuoteVersion): QuoteSnapshot {
  return {
    label: v.label,
    value: v.value,
    items: v.items,
    paymentTerms: v.paymentTerms ?? q.paymentTerms,
    deliveryTerms: v.deliveryTerms ?? q.deliveryTerms,
    warranty: v.warranty ?? q.warranty,
    packingCharges: v.packingCharges ?? q.packingCharges,
    otherTerms: v.otherTerms ?? q.otherTerms ?? '',
    createdAt: v.createdAt,
    sentAt: v.sentAt,
    by: v.by,
    note: v.note,
  };
}

/** The most recent version — the quotation itself until a version is cut. */
export function latestQuoteSnapshot(q: Quotation): QuoteSnapshot {
  const versions = q.quoteVersions ?? [];
  const last = versions[versions.length - 1];
  if (last) return snapshotOf(q, last);
  return {
    label: 'V1',
    value: q.value,
    items: q.items,
    paymentTerms: q.paymentTerms,
    deliveryTerms: q.deliveryTerms,
    warranty: q.warranty,
    packingCharges: q.packingCharges,
    otherTerms: q.otherTerms ?? '',
    createdAt: `${q.quoteDate}T11:30:00`,
    sentAt: q.sentAt,
    by: q.owner,
    note: 'Original quotation issued to customer',
  };
}

/** The version before the latest — null while only one version exists. */
export function previousQuoteSnapshot(q: Quotation): QuoteSnapshot | null {
  const versions = q.quoteVersions ?? [];
  const prev = versions[versions.length - 2];
  return prev ? snapshotOf(q, prev) : null;
}

/** The commercial terms the customer asked for, keyed onto the quote's fields. */
export function proposedTerms(changes: RequestedChange[] = []): {
  paymentTerms?: string;
  deliveryTerms?: string;
  warranty?: string;
} {
  const out: { paymentTerms?: string; deliveryTerms?: string; warranty?: string } = {};
  for (const c of changes) {
    if (c.type === 'payment') out.paymentTerms = c.newValue;
    else if (c.type === 'delivery') out.deliveryTerms = c.newValue;
    else if (c.type === 'warranty') out.warranty = c.newValue;
  }
  return out;
}
