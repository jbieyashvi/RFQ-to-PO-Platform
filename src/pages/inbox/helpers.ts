import type { InboxEmail, Quotation } from '@/types';

export function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s ?? '').trim());
}

/**
 * A stable signature of a quotation's sendable contents. It changes whenever the
 * grand total or any line item's quantity / price / discount changes — used to
 * detect a quote that was edited AFTER being attached to an outgoing email.
 */
export function quoteSignature(q: Pick<Quotation, 'value' | 'items'>): string {
  return `${q.value}|${q.items
    .map((i) => `${i.id}:${i.quantity}:${i.unitPrice}:${i.discountPct}`)
    .join(',')}`;
}

export interface QuoteSendState {
  to: string;
  subject: string;
  body: string;
  reviewDate: string;
  hasAttachment: boolean;
  attachmentStale: boolean;
}

/**
 * Blocking reasons the focused quote-send email cannot go out yet. Empty array
 * means every send precondition is satisfied. Messages match the PM-confirmed
 * copy for the attachment and review-date rules.
 */
export function quoteSendBlockers(s: QuoteSendState): string[] {
  const b: string[] = [];
  if (!isValidEmail(s.to)) b.push('A valid recipient (To) address is required.');
  if (!s.subject.trim()) b.push('Subject is required.');
  if (!s.body.trim()) b.push('Email body is required.');
  if (!s.hasAttachment) b.push('Add the latest quotation to the email before sending.');
  else if (s.attachmentStale) b.push('The quotation has changed. Add the latest version before sending.');
  if (!s.reviewDate) b.push('Select the next review date before sending the quotation.');
  return b;
}

export interface ComposerState {
  to: string;
  subject: string;
  body: string;
  reviewDate: string;
  hasAttachment: boolean;
  attachmentStale: boolean;
  /** Revision / corrected-quote sends require the system PDF; a PO-correction request does not. */
  requireAttachment: boolean;
}

/**
 * Blocking reasons a prepared workflow email (revision, corrected quote, or
 * updated-PO request) cannot be sent from the shared middle composer yet. The
 * next review date is compulsory for every one of these follow-up sends.
 */
export function composerBlockers(s: ComposerState): string[] {
  const b: string[] = [];
  if (!isValidEmail(s.to)) b.push('A valid recipient (To) address is required.');
  if (!s.subject.trim()) b.push('Subject is required.');
  if (!s.body.trim()) b.push('Email body is required.');
  if (s.requireAttachment) {
    if (!s.hasAttachment) b.push('Add the latest quotation to the email before sending.');
    else if (s.attachmentStale) b.push('The quotation has changed. Add the latest version before sending.');
  }
  if (!s.reviewDate) b.push('Select the next review date before sending.');
  return b;
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
