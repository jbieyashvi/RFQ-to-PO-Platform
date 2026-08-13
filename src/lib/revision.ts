import type {
  LineItem,
  Role,
  SalesOrder,
  SORevisionSnapshot,
} from '@/types';
import { computeTotals, formatINR, formatDate } from '@/lib/format';

// ---------- Snapshots ----------
export function snapshotOf(so: SalesOrder): SORevisionSnapshot {
  return {
    items: so.items.map((it) => ({ ...it })),
    paymentTerms: so.paymentTerms,
    deliveryTerms: so.deliveryTerms,
    deliveryDate: so.deliveryDate,
    billingAddress: so.billingAddress,
    shippingAddress: so.shippingAddress,
  };
}

export function cloneSnapshot(s: SORevisionSnapshot): SORevisionSnapshot {
  return { ...s, items: s.items.map((it) => ({ ...it })) };
}

/** The original (pre-revision) snapshot — always versions[0], never overwritten. */
export function originalSnapshot(so: SalesOrder): SORevisionSnapshot {
  const original = so.versions.find((v) => v.version === 0);
  return original ? original.snapshot : snapshotOf(so);
}

export function snapshotValue(s: SORevisionSnapshot, packingCharges: number): number {
  return computeTotals(s.items, packingCharges).grandTotal;
}

// ---------- Roles ----------
export function canApproveRevision(role: Role): boolean {
  return role === 'super_admin' || role === 'office_admin';
}

// ---------- Diff ----------
export interface ItemDiff {
  id: string;
  description: string;
  itemCode: string;
  unit: string;
  quantity: { prev: number; next: number; changed: boolean };
  unitPrice: { prev: number; next: number; changed: boolean };
  taxPct: { prev: number; next: number; changed: boolean };
  changed: boolean;
}

export interface FieldDiff {
  key: string;
  label: string;
  prev: string;
  next: string;
  changed: boolean;
}

function num(a: number, b: number) {
  return Math.abs(a - b) > 0.0001;
}

export function diffItems(prev: LineItem[], next: LineItem[]): ItemDiff[] {
  return next.map((n) => {
    const p = prev.find((x) => x.id === n.id) ?? n;
    const qtyChanged = num(p.quantity, n.quantity);
    const priceChanged = num(p.unitPrice, n.unitPrice);
    const taxChanged = num(p.taxPct, n.taxPct);
    return {
      id: n.id,
      description: n.description,
      itemCode: n.itemCode,
      unit: n.unit,
      quantity: { prev: p.quantity, next: n.quantity, changed: qtyChanged },
      unitPrice: { prev: p.unitPrice, next: n.unitPrice, changed: priceChanged },
      taxPct: { prev: p.taxPct, next: n.taxPct, changed: taxChanged },
      changed: qtyChanged || priceChanged || taxChanged,
    };
  });
}

export function diffFields(
  prev: SORevisionSnapshot,
  next: SORevisionSnapshot,
  packingCharges: number
): FieldDiff[] {
  const prevValue = snapshotValue(prev, packingCharges);
  const nextValue = snapshotValue(next, packingCharges);
  return [
    { key: 'paymentTerms', label: 'Payment Terms', prev: prev.paymentTerms, next: next.paymentTerms, changed: prev.paymentTerms !== next.paymentTerms },
    { key: 'deliveryTerms', label: 'Delivery Terms', prev: prev.deliveryTerms, next: next.deliveryTerms, changed: prev.deliveryTerms !== next.deliveryTerms },
    { key: 'deliveryDate', label: 'Delivery Date', prev: formatDate(prev.deliveryDate), next: formatDate(next.deliveryDate), changed: prev.deliveryDate !== next.deliveryDate },
    { key: 'billingAddress', label: 'Billing Address', prev: prev.billingAddress, next: next.billingAddress, changed: prev.billingAddress !== next.billingAddress },
    { key: 'shippingAddress', label: 'Shipping Address', prev: prev.shippingAddress, next: next.shippingAddress, changed: prev.shippingAddress !== next.shippingAddress },
    { key: 'value', label: 'Order Value', prev: formatINR(prevValue), next: formatINR(nextValue), changed: num(prevValue, nextValue) },
  ];
}

export function hasAnyChange(
  prev: SORevisionSnapshot,
  next: SORevisionSnapshot,
  packingCharges: number
): boolean {
  const itemsChanged = diffItems(prev.items, next.items).some((d) => d.changed);
  const lengthChanged = prev.items.length !== next.items.length;
  const fieldsChanged = diffFields(prev, next, packingCharges).some((d) => d.changed);
  return itemsChanged || lengthChanged || fieldsChanged;
}

export function changedFieldCount(
  prev: SORevisionSnapshot,
  next: SORevisionSnapshot,
  packingCharges: number
): number {
  const items = diffItems(prev.items, next.items).filter((d) => d.changed).length;
  // exclude derived Order Value from the "fields changed" tally to avoid double-counting
  const fields = diffFields(prev, next, packingCharges).filter((d) => d.changed && d.key !== 'value').length;
  return items + fields;
}

// ---------- Validation ----------
/** Mandatory-field errors on the revised snapshot. */
export function validateSnapshot(s: SORevisionSnapshot): string[] {
  const errs: string[] = [];
  if (s.items.length === 0) errs.push('At least one line item is required.');
  s.items.forEach((it, i) => {
    if (!(it.quantity > 0)) errs.push(`Line ${i + 1} (${it.itemCode || 'item'}): quantity must be greater than zero.`);
    if (it.unitPrice < 0) errs.push(`Line ${i + 1} (${it.itemCode || 'item'}): unit price cannot be negative.`);
    if (it.taxPct < 0) errs.push(`Line ${i + 1} (${it.itemCode || 'item'}): tax % cannot be negative.`);
  });
  if (!s.paymentTerms.trim()) errs.push('Payment terms are required.');
  if (!s.deliveryTerms.trim()) errs.push('Delivery terms are required.');
  if (!s.deliveryDate.trim()) errs.push('Delivery date is required.');
  if (!s.billingAddress.trim()) errs.push('Billing address is required.');
  if (!s.shippingAddress.trim()) errs.push('Shipping address is required.');
  return errs;
}

// ---------- Completion / submit gating (req 6) ----------
export interface CompletionInput {
  original: SORevisionSnapshot;
  draft: SORevisionSnapshot;
  notes: string;
  previewed: boolean;
  packingCharges: number;
}

/**
 * Blockers that prevent a revision from being marked completed / submitted.
 * (Approval-permission is enforced separately at the Approve step.)
 */
export function completionBlockers(input: CompletionInput): string[] {
  const { original, draft, notes, previewed, packingCharges } = input;
  const blockers: string[] = [];
  if (!hasAnyChange(original, draft, packingCharges)) {
    blockers.push('Make at least one change to a Sales Order field before continuing.');
  }
  if (!notes.trim()) {
    blockers.push('Enter revision notes describing the correction.');
  }
  const invalid = validateSnapshot(draft);
  if (invalid.length) blockers.push(...invalid);
  if (!previewed) {
    blockers.push('Preview the revised Sales Order before submitting.');
  }
  return blockers;
}

// ---------- Existence check (req 9) ----------
/** A revised version physically exists once it has been submitted (or beyond). */
export function revisedVersionExists(so: SalesOrder): boolean {
  return (
    so.revisionNumber > 0 ||
    so.revisionState === 'awaiting_approval' ||
    so.revisionState === 'revision_approved' ||
    so.revisionState === 'revised_sent'
  );
}

/** SOs in the active (not-yet-sent) revision pipeline. */
export const ACTIVE_REVISION_STATES = [
  'revision_required',
  'draft_in_progress',
  'awaiting_approval',
  'revision_approved',
] as const;

export function isActiveRevision(so: SalesOrder): boolean {
  return !!so.revisionState && (ACTIVE_REVISION_STATES as readonly string[]).includes(so.revisionState);
}

// ---------- Document rendering (preview / download) ----------
export function renderRevisedSO(so: SalesOrder, s: SORevisionSnapshot, revLabel: string): string {
  const totals = computeTotals(s.items, so.packingCharges);
  const lines = s.items
    .map((it) => `  - ${it.itemCode} ${it.description} | ${it.quantity} ${it.unit} @ ${formatINR(it.unitPrice)} | Tax ${it.taxPct}%`)
    .join('\n');
  return [
    `REVISED SALES ORDER — ${so.number} (${revLabel})`,
    `Customer: ${so.customerName} (${so.customerCode})`,
    `Linked PO: ${so.poNumber} (${formatDate(so.poDate)})`,
    `Revision reason: ${so.revisionReason ?? '—'}`,
    ``,
    `Items:`,
    lines,
    ``,
    `Payment Terms: ${s.paymentTerms}`,
    `Delivery Terms: ${s.deliveryTerms}`,
    `Delivery Date: ${formatDate(s.deliveryDate)}`,
    `Billing Address: ${s.billingAddress}`,
    `Shipping Address: ${s.shippingAddress}`,
    ``,
    `Order Value: ${formatINR(totals.grandTotal)}`,
    `Revision notes: ${so.revisionNotes ?? '—'}`,
  ].join('\n');
}
