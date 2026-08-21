import type { InboxEmail, Quotation, SalesOrder } from '@/types';
import { OFFICE_PREFIX } from '@/lib/revisionQueue';

// ---------------------------------------------------------------------------
// Inquiry identity
// ---------------------------------------------------------------------------
// An "inquiry" is the customer's original enquiry and everything that follows
// from it — the quotation, its revisions, the PO received against it, the Sales
// Order and any SO revision. The QUOTATION is the natural key: every downstream
// record already points back to it (SalesOrder.quotationId, and the workflow ids
// carried on the emails themselves), so the quotation id is the inquiry id.
//
// The identity is derived from the record — never from a list position — so the
// same inquiry keeps the same number on every screen, after a reload, and while
// navigating between its messages.
// ---------------------------------------------------------------------------

export interface Inquiry {
  id: string; // quotation id — the stable inquiry key
  number: string; // e.g. INQ/MUM/25-26/00007
  quotationId: string;
  quotationNumber: string;
  partyId: string;
  customerName: string;
  customerCode: string;
  owner: string;
  officeId: string;
}

// Trailing digits of an id ("qtn-007" → 7). Stable for the life of the record.
function seqOf(id: string): number {
  const m = /(\d+)\s*$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** Complete inquiry identifier for a quotation, e.g. INQ/MUM/25-26/00007. */
export function inquiryNumberFor(q: Quotation): string {
  const prefix = OFFICE_PREFIX[q.officeId] ?? 'INQ';
  return `INQ/${prefix}/25-26/${String(seqOf(q.id)).padStart(5, '0')}`;
}

export function inquiryOf(q: Quotation): Inquiry {
  return {
    id: q.id,
    number: inquiryNumberFor(q),
    quotationId: q.id,
    quotationNumber: q.number,
    partyId: q.partyId,
    customerName: q.customerName,
    customerCode: q.customerCode,
    owner: q.owner,
    officeId: q.officeId,
  };
}

function quotationIdOfSo(soId: string | undefined, salesOrders: SalesOrder[]): string | undefined {
  if (!soId) return undefined;
  return salesOrders.find((s) => s.id === soId)?.quotationId;
}

function quotationIdByNumber(num: string | undefined, quotations: Quotation[]): string | undefined {
  if (!num) return undefined;
  const needle = num.trim().toLowerCase();
  return quotations.find((q) => q.number.toLowerCase() === needle)?.id;
}

/**
 * The inquiry a single email belongs to, or null when it is not linked to one
 * yet (a Purchase Order still awaiting quotation association, a cold enquiry).
 *
 * Resolution walks from the strongest link to the weakest so an email joins its
 * inquiry even when it arrived as a completely separate email thread:
 *   workflow ids → Sales Order → quoted document numbers.
 */
export function inquiryIdOfEmail(
  email: InboxEmail,
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): string | null {
  const candidate =
    email.revisionSendId ??
    email.quotationSendId ??
    quotationIdOfSo(email.poVerifyId, salesOrders) ??
    quotationIdOfSo(email.soRevisionId, salesOrders) ??
    quotationIdByNumber(email.linkedQuotation, quotations) ??
    // Outgoing/manually-linked mail often carries only the SO or PO number.
    (email.linkedSO ? salesOrders.find((s) => s.number === email.linkedSO)?.quotationId : undefined) ??
    (email.linkedPO ? salesOrders.find((s) => s.poNumber === email.linkedPO)?.quotationId : undefined);

  const quote = candidate ? quotations.find((q) => q.id === candidate) : undefined;
  if (!quote) return null;
  // Same guard the quotation association uses: a document number cited in an
  // email NEVER pulls it into another customer's inquiry.
  if (email.partyId && quote.partyId !== email.partyId) return null;
  return quote.id;
}

/** The resolved inquiry for an email, or null when it belongs to none yet. */
export function inquiryOfEmail(
  email: InboxEmail,
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): Inquiry | null {
  const id = inquiryIdOfEmail(email, quotations, salesOrders);
  if (!id) return null;
  const q = quotations.find((x) => x.id === id);
  return q ? inquiryOf(q) : null;
}

/** The inquiry for a quotation id, or null when it cannot be resolved. */
export function inquiryById(id: string, quotations: Quotation[]): Inquiry | null {
  const q = quotations.find((x) => x.id === id);
  return q ? inquiryOf(q) : null;
}
