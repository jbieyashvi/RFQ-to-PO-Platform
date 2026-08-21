import type { ExtractionField, InboxEmail, Quotation, SalesOrder } from '@/types';
import { emailSignature } from '@/lib/brand';
import { officeName } from '@/data/offices';
import { formatINR } from '@/lib/format';

export function isValidEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((s ?? '').trim());
}

// Prototype attach timestamp — kept consistent with the app's seeded clock.
export const SO_ATTACH_TS = '2026-08-13T12:40:00';

/**
 * The email patch that attaches the generated Sales Order PDF to the middle
 * composer and prefills the customer email (compose intent `so-send`). Shared
 * by the SO Generation drawer ("Generate & Add to Email") and the generated-SO
 * panel ("Add Sales Order to Email") so both produce the identical payload.
 * Pass the SO with any just-saved edits merged in, so value/items are current.
 */
export function soSendEmailPatch(email: InboxEmail, so: SalesOrder): Partial<InboxEmail> {
  const contact = (so.customerName.split(' ')[0] || 'Sir/Madam').trim();
  return {
    composeIntent: 'so-send',
    attachedQuote: undefined,
    attachedSalesOrder: {
      fileName: `${so.number.replace(/\//g, '-')}.pdf`,
      soNumber: so.number,
      fileType: 'PDF',
      value: so.value,
      addedBy: 'system',
      addedAt: SO_ATTACH_TS,
      sizeLabel: `${140 + so.items.length * 8} KB`,
    },
    draft: {
      from: email.recipient,
      to: email.senderEmail,
      cc: email.cc.join(', '),
      subject: `Sales Order ${so.number} against PO ${so.poNumber}`,
      body:
        `Dear ${contact},\n\nThank you for Purchase Order ${so.poNumber}.\n\n` +
        `Please find attached our Sales Order ${so.number} raised against your PO, for a total value of ${formatINR(so.value)}. ` +
        `Kindly review and confirm so we may proceed with processing.\n\n` +
        emailSignature(so.owner, officeName(so.officeId)),
      relatedDoc: so.number,
      aiGenerated: true,
    },
  };
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

/**
 * Whether AI Extraction is relevant for this email at all. Generic mail
 * (Finance / Other) and still-unclassified / spam messages do not initiate a
 * business workflow, so the extraction section is hidden entirely (State C) and
 * never blocks a normal reply.
 */
export function extractionRelevant(email: InboxEmail): boolean {
  if (email.classification === 'finance_other' || email.classification === 'unclassified') return false;
  return email.extraction.length > 0;
}

/**
 * The extraction fields that need a human's attention — missing, low-confidence
 * (uncertain) or a required field left empty. These are the only ones surfaced
 * in the "needs review" state so the user sees the gaps, not the whole grid.
 */
export function affectedFields(email: InboxEmail): ExtractionField[] {
  return email.extraction.filter(
    (f) => f.confidence === 'missing' || f.confidence === 'low' || (!!f.required && !f.value.trim())
  );
}

export type ExtractionState = 'confirmed' | 'needs_review' | 'hidden';

/**
 * The single source of truth for which of the three extraction states an email
 * is in. `hidden` → State C (generic mail). `confirmed` → State A (all required
 * fields resolved AND a human has confirmed). Everything else → State B.
 */
export function extractionState(email: InboxEmail): ExtractionState {
  if (!extractionRelevant(email)) return 'hidden';
  if (email.extractionConfirmed && unresolvedMandatory(email).length === 0) return 'confirmed';
  return 'needs_review';
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
  // Extraction gating only applies to emails that actually initiate a business
  // workflow — generic Finance / Other mail (State C) replies freely.
  if (extractionRelevant(email)) {
    const um = unresolvedMandatory(email);
    if (um.length) b.push(`Missing / low-confidence required field(s): ${um.join(', ')}`);
    if (!email.extractionConfirmed) b.push('Confirm the AI-extracted details before sending');
    else if (email.needsReview) b.push('Low-confidence fields still need review');
  }
  if (email.validationFailed) b.push('PO / commercial validation is still pending');
  return b;
}

export function confidenceBucket(n: number): 'high' | 'medium' | 'low' {
  if (n >= 80) return 'high';
  if (n >= 55) return 'medium';
  return 'low';
}
