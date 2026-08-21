import type { InboxEmail, Party, Quotation } from '@/types';
import { formatINR } from '@/lib/format';
import { PARTIES } from './masters';
import { USERS } from './users';
import { QUOTATIONS } from './quotations';
import { SALES_ORDERS } from './salesOrders';

// ---------------------------------------------------------------------------
// Freshly-arrived Purchase Order emails that are NOT yet associated with a
// quotation (no poVerifyId). They exercise the three association scenarios:
//
//   em-po-in-001  cites a real quotation number  → auto-match → verification
//   em-po-in-002  cites an unknown number        → manual pick from last year
//   em-po-in-003  new customer, no reference     → no candidates → Create SO
//
// Received earlier than em-001 (2026-08-13T09:12) so the inbox default
// selection stays unchanged.
// ---------------------------------------------------------------------------

function domainOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|corp|company|and|&)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return `${slug || 'customer'}.com`;
}

function ownerFor(party: Party): string {
  return (USERS.find((u) => u.officeId === party.officeId && u.active) ?? USERS[0]).fullName;
}

const partyOf = (id: string): Party => PARTIES.find((p) => p.id === id)!;

// Matched scenario target: a current-period quotation that was sent to the
// customer but has no Sales Order yet, so auto-association creates a fresh one.
const usedQuoteIds = new Set(SALES_ORDERS.map((s) => s.quotationId));
const matchedQuote: Quotation =
  QUOTATIONS.find(
    (q) => !q.id.startsWith('qtn-h-') && !usedQuoteIds.has(q.id) && q.deliveryState === 'sent' && q.status === 'open'
  ) ?? QUOTATIONS[0];

function poEmail(opts: {
  id: string;
  party: Party;
  poNumber: string;
  receivedAt: string;
  quoteRef: string; // cited quotation reference ('' = none cited)
  quoteRefConfidence: 'high' | 'low' | 'missing';
  poTotal: number;
  paymentTerms: string;
  deliveryTerms: string;
  itemsSummary: string;
  bodyIntro: string;
}): InboxEmail {
  const { party } = opts;
  const domain = domainOf(party.companyName);
  const contact = party.contactPerson;
  const owner = ownerFor(party);
  const refLine = opts.quoteRef
    ? `issued against your quotation ${opts.quoteRef}`
    : 'for the items discussed with your sales team';

  return {
    id: opts.id,
    senderName: contact,
    senderEmail: `${contact.toLowerCase().split(' ')[0]}@${domain}`,
    recipient: 'sales@flowtech-instruments.com',
    cc: [`accounts@${domain}`],
    subject: `Purchase Order ${opts.poNumber}${opts.quoteRef ? ` against ${opts.quoteRef}` : ''}`,
    receivedAt: opts.receivedAt,
    body: `Dear ${owner.split(' ')[0]},\n\n${opts.bodyIntro}\n\nPlease find our Purchase Order ${opts.poNumber}, ${refLine}.\n\nOrder value: ${formatINR(opts.poTotal)}\nPayment terms: ${opts.paymentTerms}\nDelivery terms: ${opts.deliveryTerms}\n\nKindly acknowledge the order and confirm the delivery schedule.\n\nRegards,\n${contact}\n${party.companyName}`,
    thread: [],
    classification: 'purchase_order',
    aiConfidence: opts.quoteRefConfidence === 'high' ? 92 : 74,
    read: false,
    needsReview: true,
    officeId: party.officeId,
    owner,
    partyId: party.id,
    customerName: party.companyName,
    customerCode: party.code,
    linkedPO: opts.poNumber,
    linkedQuotation: opts.quoteRef || undefined,
    extraction: [
      { key: 'customer', label: 'Customer', value: party.companyName, confidence: 'high', required: true },
      { key: 'poNumber', label: 'PO Number', value: opts.poNumber, confidence: 'high', required: true },
      { key: 'poDate', label: 'PO Date', value: '2026-08-12', confidence: 'high' },
      { key: 'quotation', label: 'Linked Quotation', value: opts.quoteRef, confidence: opts.quoteRefConfidence, required: true },
      { key: 'items', label: 'Items, Quantities & Rates', value: opts.itemsSummary, confidence: 'medium' },
      { key: 'poTotal', label: 'PO Total', value: `₹${opts.poTotal.toLocaleString('en-IN')}`, confidence: 'high' },
      { key: 'paymentTerms', label: 'Payment Terms', value: opts.paymentTerms, confidence: 'high' },
      { key: 'deliveryTerms', label: 'Delivery Terms', value: opts.deliveryTerms, confidence: 'high' },
      { key: 'deliveryDate', label: 'Delivery Date', value: '2026-09-25', confidence: 'medium' },
    ],
    extractionConfirmed: false,
    draftSaved: false,
    sent: false,
  };
}

const matchedParty = partyOf(matchedQuote.partyId);

export const INBOUND_PO_EMAILS: InboxEmail[] = [
  // 1) Exact quotation-number match → auto-associate → PO vs Quote verification.
  //    Total and payment terms deliberately diverge from the quote so the
  //    verification workflow has real mismatches to resolve.
  poEmail({
    id: 'em-po-in-001',
    party: matchedParty,
    poNumber: `PO-${matchedParty.code.replace('CUST-', '')}-2214`,
    receivedAt: '2026-08-13T06:55:00',
    quoteRef: matchedQuote.number,
    quoteRefConfidence: 'high',
    poTotal: Math.round(matchedQuote.value * 0.97),
    paymentTerms: 'Net 60 days credit',
    deliveryTerms: matchedQuote.deliveryTerms,
    itemsSummary: `${matchedQuote.items.length} line item${matchedQuote.items.length === 1 ? '' : 's'}`,
    bodyIntro: 'Further to the final negotiation call last week, we are pleased to confirm the order.',
  }),

  // 2) Cited quotation number does not exist in the register (typo on the
  //    customer's side) → manual association from the last year's quotations.
  poEmail({
    id: 'em-po-in-002',
    party: partyOf('pty-02'),
    poNumber: 'PO-1002-8830',
    receivedAt: '2026-08-13T06:20:00',
    quoteRef: 'QTN/2025/0466',
    quoteRefConfidence: 'low',
    poTotal: 512400,
    paymentTerms: 'Net 45 days credit',
    deliveryTerms: 'FOR destination',
    itemsSummary: '3 line items',
    bodyIntro: 'As discussed with your Mumbai office, we are releasing the order for the instrumentation package.',
  }),

  // 3) Brand-new customer, no quotation reference and no quotation history →
  //    the association drawer is empty → "Create SO Manually".
  poEmail({
    id: 'em-po-in-003',
    party: partyOf('pty-16'),
    poNumber: 'PO-5002-0001',
    receivedAt: '2026-08-13T05:45:00',
    quoteRef: '',
    quoteRefConfidence: 'missing',
    poTotal: 318600,
    paymentTerms: '50% advance, 50% on delivery',
    deliveryTerms: 'FOR site delivery',
    itemsSummary: '2 line items',
    bodyIntro: 'We were referred to Flowtech by our group company and would like to place a direct order.',
  }),
];
