import type { InboxEmail } from '@/types';

export function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s ?? '').trim());
}

/** Required extraction fields that are still missing or low-confidence & unresolved. */
export function unresolvedMandatory(email: InboxEmail): string[] {
  return email.extraction
    .filter((f) => f.required)
    .filter((f) => {
      if (f.confidence === 'missing') return !f.value.trim();
      if (f.confidence === 'low') return !f.edited && !email.extractionConfirmed;
      return false;
    })
    .map((f) => f.label);
}

/** Every reason Approve & Send must be disabled. Empty array = safe to send. */
export function sendBlockers(email: InboxEmail, canSend: boolean): string[] {
  const b: string[] = [];
  const d = email.draft;
  if (!d) {
    b.push('No draft has been prepared');
    if (!canSend) b.push('You do not have Send permission');
    return b;
  }
  if (!isValidEmail(d.to)) b.push('Recipient is missing or invalid');
  if (!d.subject.trim()) b.push('Subject is empty');
  if (!d.body.trim()) b.push('Email body is empty');
  if (email.requiredAttachment && d.attachments.length === 0) b.push('Required attachment is missing');
  const um = unresolvedMandatory(email);
  if (um.length) b.push(`Unresolved required field(s): ${um.join(', ')}`);
  if (email.classification === 'unclassified') b.push('Email must be classified before sending');
  if (email.validationFailed) b.push('Commercial validation failed (PO vs Quote) — resolve before sending');
  if (!canSend) b.push('You do not have Send permission');
  return b;
}

export function confidenceBucket(n: number): 'high' | 'medium' | 'low' {
  if (n >= 80) return 'high';
  if (n >= 55) return 'medium';
  return 'low';
}
