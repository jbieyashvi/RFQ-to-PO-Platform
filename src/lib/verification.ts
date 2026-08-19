import type { BadgeTone } from '@/lib/labels';
import type { FieldResolution, VerificationField, VerificationStatus } from '@/types';

// ---------------------------------------------------------------------------
// PO vs Quote verification — the single source of truth is the per-field
// resolution state on the Sales Order. The overall verification status shown in
// the list and the SO-generation gate are both DERIVED from these fields, never
// from a manual "Mark Verified" toggle.
// ---------------------------------------------------------------------------

export const FIELD_RESOLUTION_META: Record<
  FieldResolution,
  { label: string; tone: BadgeTone }
> = {
  pending: { label: 'Pending review', tone: 'slate' },
  matched: { label: 'Matched', tone: 'green' },
  mismatch: { label: 'Mismatch', tone: 'red' },
  pending_review: { label: 'Pending review', tone: 'blue' },
  awaiting_po: { label: 'Updated PO awaited', tone: 'amber' },
  awaiting_quote: { label: 'Updated quote sent', tone: 'violet' },
  resolved: { label: 'Resolved', tone: 'teal' },
};

// The effective resolution of a field — falls back to the automatic comparison
// result when no explicit working state has been recorded yet.
export function fieldResolution(f: VerificationField): FieldResolution {
  return f.resolution ?? (f.match ? 'matched' : 'mismatch');
}

// A field is resolved (and no longer blocks SO generation) only when it matched
// automatically or its corrected data was received & accepted.
export function isFieldResolved(f: VerificationField): boolean {
  const r = fieldResolution(f);
  return r === 'matched' || r === 'resolved';
}

// Fields still standing between the case and a Sales Order.
export function unresolvedFields(fields: VerificationField[]): VerificationField[] {
  return fields.filter((f) => !isFieldResolved(f));
}

// Fields the customer/quotation still owes a correction on (mismatch or pending
// review) — the ones a Request Updated PO / Send Updated Quote action targets.
export function actionableFields(fields: VerificationField[]): VerificationField[] {
  return fields.filter((f) => {
    const r = fieldResolution(f);
    return r === 'mismatch' || r === 'pending_review';
  });
}

// All required comparison fields resolved → the SO can be generated.
export function allResolved(fields: VerificationField[]): boolean {
  return fields.length > 0 && fields.every(isFieldResolved);
}

// Derive the list-level verification status from the field resolutions.
export function deriveVerificationStatus(
  fields: VerificationField[]
): VerificationStatus {
  if (fields.length === 0) return 'pending';
  if (fields.every(isFieldResolved)) return 'verified';
  const res = fields.map(fieldResolution);
  if (res.includes('awaiting_po')) return 'corrected_awaited';
  if (res.includes('awaiting_quote')) return 'updated_quote_sent';
  if (res.includes('mismatch')) return 'mismatch';
  if (res.includes('pending_review')) return 'pending_review';
  return 'pending';
}
