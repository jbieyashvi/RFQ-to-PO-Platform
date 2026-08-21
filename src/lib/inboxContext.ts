import type { InboxEmail, Quotation, SalesOrder } from '@/types';
import { inquiryIdOfEmail } from '@/lib/inquiry';

// ---------------------------------------------------------------------------
// The Global Inbox context object
// ---------------------------------------------------------------------------
// Every "Open" into the inbox — Quotes Pending, Quotes Needing Revision, PO vs
// Quote Verification, Sales Order Revision — describes the SAME record with the
// same five things: the email, its customer, its inquiry, the workflow mode and
// the business document.
//
// They are always derived together, from one record, through the helpers below.
// That is the whole point: a link can never pair one inquiry's id with another
// inquiry's email (?email=em-002&inquiryId=qtn-032), which is what used to make
// the inbox appear to switch inquiry after a reload.
// ---------------------------------------------------------------------------

export type InboxMode = 'quote-send' | 'quote-revision' | 'po-verification' | 'so-revision';

/** The workflow half of the context — the mode and its business document. */
export interface InboxWorkflow {
  mode: InboxMode;
  /** Quotation — id for quote-send / quote-revision, number for po-verification. */
  qtn?: string;
  /** Purchase Order number (po-verification). */
  po?: string;
  /** Sales Order number (so-revision). */
  so?: string;
}

export interface InboxContext extends Partial<InboxWorkflow> {
  emailId: string;
  customerId: string | null;
  inquiryId: string | null;
}

/** The context as inbox query params — empty values are never written. */
export function inboxParams(ctx: InboxContext): Record<string, string> {
  const p: Record<string, string> = { email: ctx.emailId };
  if (ctx.customerId) p.customerId = ctx.customerId;
  if (ctx.inquiryId) p.inquiryId = ctx.inquiryId;
  if (ctx.mode) p.mode = ctx.mode;
  if (ctx.qtn) p.qtn = ctx.qtn;
  if (ctx.po) p.po = ctx.po;
  if (ctx.so) p.so = ctx.so;
  return p;
}

/** `/inbox?…` for one context object — the only way Open links are built. */
export function inboxUrl(ctx: InboxContext): string {
  return `/inbox?${new URLSearchParams(inboxParams(ctx)).toString()}`;
}

/**
 * The context of an email: its customer and its inquiry read off the EMAIL
 * itself, so the three ids always describe one record. The workflow is passed
 * in by the screen that opens the inbox.
 */
export function contextForEmail(
  email: InboxEmail,
  quotations: Quotation[],
  salesOrders: SalesOrder[],
  workflow?: InboxWorkflow
): InboxContext {
  return {
    emailId: email.id,
    customerId: email.partyId ?? null,
    inquiryId: inquiryIdOfEmail(email, quotations, salesOrders),
    ...workflow,
  };
}

/**
 * True when the email really belongs to this quotation's inquiry — same
 * customer, and a link that resolves back to this quotation. Used by the Open
 * buttons to reject a lookalike (an email that merely cites a similar document
 * number, or another customer's mail) instead of deep-linking a mismatch.
 */
export function emailBelongsToInquiry(
  email: InboxEmail,
  quotationId: string,
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): boolean {
  return inquiryIdOfEmail(email, quotations, salesOrders) === quotationId;
}
