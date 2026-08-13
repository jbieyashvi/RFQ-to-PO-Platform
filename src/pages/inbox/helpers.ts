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

/**
 * Validation reasons Approve & Send must be disabled (permission is handled
 * separately by the caller). Empty array = content is safe to send.
 */
export function sendBlockers(email: InboxEmail): string[] {
  const b: string[] = [];
  const d = email.draft;
  if (!d) {
    b.push('No draft has been prepared');
    return b;
  }
  if (!isValidEmail(d.to)) b.push('Recipient is missing or invalid');
  if (!d.subject.trim()) b.push('Subject is empty');
  if (!d.body.trim()) b.push('Email body is empty');
  if (email.requiredAttachment && d.attachments.length === 0) b.push('Required attachment is missing');
  if (email.classification === 'unclassified') b.push('Email must be classified before sending');
  const um = unresolvedMandatory(email);
  if (um.length) b.push(`Missing / low-confidence required field(s): ${um.join(', ')}`);
  if (email.extraction.length > 0 && !email.extractionConfirmed) b.push('Confirm the AI-extracted details before sending');
  if (email.needsReview) b.push('Low-confidence fields still need review');
  if (email.validationFailed) b.push('PO / commercial validation is still pending');
  return b;
}

export function confidenceBucket(n: number): 'high' | 'medium' | 'low' {
  if (n >= 80) return 'high';
  if (n >= 55) return 'medium';
  return 'low';
}
