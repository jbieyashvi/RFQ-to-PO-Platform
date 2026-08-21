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

/**
 * The inquiry identifier for an enquiry that has NOT been quoted yet. A new
 * enquiry is an inquiry from the moment it arrives — it simply has no quotation
 * behind it, so the number is derived from the email's own sequence instead.
 * Stable for the life of the email, and replaced by the quotation-derived
 * number the moment the enquiry is quoted.
 */
export function inquiryNumberForEmail(email: InboxEmail): string {
  if (email.inquiryNo) return email.inquiryNo;
  const prefix = OFFICE_PREFIX[email.officeId] ?? 'INQ';
  return `INQ/${prefix}/25-26/${String(seqOf(email.id)).padStart(5, '0')}`;
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
    // Explicitly stamped on the email when it was created / seeded — the
    // strongest link there is, and independent of any document number.
    email.inquiryId ??
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

/** When an email actually happened — sent time for outgoing, arrival otherwise. */
export function emailTimeOf(e: InboxEmail): string {
  return e.sent && e.sentAt ? e.sentAt : e.receivedAt;
}

/**
 * Every email that belongs to ONE inquiry, oldest first — however many separate
 * email threads they arrived in (RFQ, quotation sent, revision ask, Purchase
 * Order, Sales Order acknowledgement, SO revision request).
 */
export function inquiryEmailsOf(
  inquiryId: string,
  emails: InboxEmail[],
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): InboxEmail[] {
  return emails
    .filter((e) => inquiryIdOfEmail(e, quotations, salesOrders) === inquiryId)
    .sort((a, b) => (emailTimeOf(a) < emailTimeOf(b) ? -1 : 1));
}

/** The inquiry for a quotation id, or null when it cannot be resolved. */
export function inquiryById(id: string, quotations: Quotation[]): Inquiry | null {
  const q = quotations.find((x) => x.id === id);
  return q ? inquiryOf(q) : null;
}

// ---------------------------------------------------------------------------
// Quoting an enquiry that has no quotation yet
// ---------------------------------------------------------------------------
// Most inbox enquiries already point at a quotation record. A brand-new
// enquiry does not — nobody has quoted it. Quoting one therefore CREATES the
// quotation, which is exactly what "Generate Quote" means; it is not a reason
// to send the user to a list to hunt for a record that does not exist.
//
// The draft starts empty and unsent (`pending_send`, so it lands in Quotes
// Pending to be Sent) with no line items: the quotation builder fills them from
// the confirmed extraction the moment it opens.
// ---------------------------------------------------------------------------

/** Next free sequence across every quotation id, so ids and inquiry numbers stay unique. */
function nextQuotationSeq(quotations: Quotation[]): number {
  return quotations.reduce((max, q) => Math.max(max, seqOf(q.id)), 0) + 1;
}

export function draftQuotationForEnquiry(
  email: InboxEmail,
  quotations: Quotation[],
  actor: string,
  today: string
): Quotation | null {
  if (!email.partyId) return null;
  const seq = nextQuotationSeq(quotations);
  return {
    id: `qtn-${String(seq).padStart(3, '0')}`,
    number: `QTN/2026/${String(1000 + seq).padStart(4, '0')}`,
    partyId: email.partyId,
    customerName: email.customerName ?? email.senderName,
    customerCode: email.customerCode ?? '—',
    officeId: email.officeId,
    owner: email.owner,
    status: 'open',
    stage: 'no_followup',
    workState: 'pending_send',
    deliveryState: 'not_sent',
    value: 0,
    quoteDate: today,
    reviewDate: '',
    createdDate: today,
    lastUpdated: today,
    items: [],
    paymentTerms: '100% advance along with purchase order',
    deliveryTerms: 'Ex Works — Vadodara',
    warranty: '12 months against manufacturing defects',
    packingCharges: 0,
    revisions: [],
    activity: [
      {
        id: `act-qtn-${seq}-new`,
        date: `${today}T12:30:00`,
        actor,
        action: 'Quotation created',
        detail: `From enquiry — ${email.subject}`,
      },
    ],
  };
}
