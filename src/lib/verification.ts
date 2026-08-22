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
//
// Verified means EVERY field reconciles; anything short of that — a live
// mismatch, an updated PO still awaited, a corrected quote out with the
// customer, a comparison that has not run at all — is Mismatch Found. Which of
// those it is stays legible on the field rows themselves (FIELD_RESOLUTION_META
// above), where it drives the next action, rather than fragmenting the record
// status the list filters on.
export function deriveVerificationStatus(
  fields: VerificationField[]
): VerificationStatus {
  return allResolved(fields) ? 'verified' : 'mismatch';
}
