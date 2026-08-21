import type {
  InboxEmail,
  LineItem,
  Party,
  Quotation,
  SalesOrder,
  VerificationField,
} from '@/types';
import { computeTotals, formatINR } from '@/lib/format';
import { deriveVerificationStatus } from '@/lib/verification';

// ---------------------------------------------------------------------------
// PO → Quotation association. When a Purchase Order email arrives without a
// linked Sales Order, the quotation reference cited in the PO is matched
// against the quotation register. An exact quotation-number match associates
// automatically; anything less (including a same-customer-name coincidence)
// requires an explicit manual association from the drawer.
// ---------------------------------------------------------------------------

/** Prototype "today" — matches lib/sla.ts SLA_NOW. */
const TODAY = '2026-08-13';
const ONE_YEAR_AGO = '2025-08-13';

/** The quotation reference the PO cites, as extracted from the email. */
export function quotationRefOf(email: InboxEmail): string | undefined {
  const row = email.extraction.find((f) => f.key === 'quotation');
  const ref = (row?.value ?? email.linkedQuotation ?? '').trim();
  return ref || undefined;
}

/**
 * Exact quotation-number match (case-insensitive). Customer name alone is
 * never sufficient — and a number match pointing at a DIFFERENT customer's
 * quotation is treated as no match, never silently cross-associated.
 */
export function findQuotationByNumber(
  ref: string,
  quotations: Quotation[],
  partyId?: string
): Quotation | undefined {
  const needle = ref.trim().toLowerCase();
  if (!needle) return undefined;
  const hit = quotations.find((q) => q.number.toLowerCase() === needle);
  if (!hit) return undefined;
  if (partyId && hit.partyId !== partyId) return undefined;
  return hit;
}

/**
 * Candidate quotations for MANUAL association: the same customer's quotations
 * from the last one year, newest first. Only ever shown in the picker — never
 * auto-associated.
 */
export function candidateQuotations(email: InboxEmail, quotations: Quotation[]): Quotation[] {
  if (!email.partyId) return [];
  return quotations
    .filter((q) => q.partyId === email.partyId && q.quoteDate >= ONE_YEAR_AGO)
    .sort((a, b) => b.quoteDate.localeCompare(a.quoteDate));
}

/** Deterministic id for the verification SO created for an inbound PO email. */
export function verificationSoId(emailId: string): string {
  return `so-assoc-${emailId}`;
}

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function extractionValue(email: InboxEmail, key: string): string {
  return (email.extraction.find((f) => f.key === key)?.value ?? '').trim();
}

/** Parse "₹4,52,910" → 452910. */
function parseINR(s: string): number | undefined {
  const digits = s.replace(/[^\d]/g, '');
  return digits ? Number(digits) : undefined;
}

function weightedAvgPrice(items: LineItem[]): number {
  const totalQty = items.reduce((s, it) => s + it.quantity, 0);
  if (!totalQty) return 0;
  const totalAmt = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  return Math.round(totalAmt / totalQty);
}

/**
 * Build the PO vs Quote verification Sales Order for an inbound PO email and
 * its associated quotation. Field comparisons come from the quote versus the
 * email's extracted values, so genuine discrepancies (terms, totals) surface
 * as mismatches for the verification workflow.
 */
export function buildVerificationSalesOrder(opts: {
  email: InboxEmail;
  quote: Quotation;
  parties: Party[];
  salesOrders: SalesOrder[];
  association: { kind: 'number_match' | 'manual'; by: string };
}): SalesOrder {
  const { email, quote, parties, salesOrders, association } = opts;
  const items: LineItem[] = quote.items.map((it) => ({ ...it, id: `so-${it.id}` }));
  const { grandTotal: quoteValue } = computeTotals(items, quote.packingCharges);

  const poTotalRaw = extractionValue(email, 'poTotal');
  const poValue = parseINR(poTotalRaw) ?? quoteValue;
  const poPayment = extractionValue(email, 'paymentTerms') || quote.paymentTerms;
  const poDelivery = extractionValue(email, 'deliveryTerms') || quote.deliveryTerms;
  const totalQty = items.reduce((s, it) => s + it.quantity, 0);
  const avgPrice = formatINR(weightedAvgPrice(items));

  const mk = (
    key: string,
    label: string,
    qv: string,
    pv: string,
    match: boolean
  ): VerificationField => ({ key, label, quoteValue: qv, poValue: pv, match, resolution: match ? 'matched' : 'mismatch' });

  const verificationFields: VerificationField[] = [
    mk('item', 'Item / Description', 'As per associated quotation', 'As per customer PO', true),
    mk('qty', 'Quantity (total units)', `${totalQty} units`, `${totalQty} units`, true),
    mk('price', 'Unit Price (weighted avg)', avgPrice, avgPrice, true),
    mk('tax', 'Taxes (GST)', '18% GST', '18% GST', true),
    mk('payment', 'Payment Terms', quote.paymentTerms, poPayment, poPayment === quote.paymentTerms),
    mk('delivery', 'Delivery Terms', quote.deliveryTerms, poDelivery, poDelivery === quote.deliveryTerms),
    mk('total', 'Total Order Value', formatINR(quoteValue), poTotalRaw || formatINR(poValue), Math.abs(quoteValue - poValue) < 1),
  ];
  const verificationStatus = deriveVerificationStatus(verificationFields);
  const mismatches = verificationFields.filter((f) => !f.match).length;

  const party = parties.find((p) => p.id === quote.partyId);
  const billingAddress = party?.billingAddress ?? 'Corporate Office, India';
  const shippingAddress = party?.shippingAddress ?? 'Central Warehouse, India';

  const poNumber = extractionValue(email, 'poNumber') || email.linkedPO || 'PO-UNKNOWN';
  const poDateRaw = extractionValue(email, 'poDate');
  const receivedDate = email.receivedAt.slice(0, 10);
  const poDate = /^\d{4}-\d{2}-\d{2}$/.test(poDateRaw) ? poDateRaw : addDays(receivedDate, -2);
  const deliveryRaw = extractionValue(email, 'deliveryDate');
  const deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(deliveryRaw) ? deliveryRaw : addDays(TODAY, 30);

  // Next free sequence in the current-year series (existing seed occupies
  // SO/2026/0501…; association SOs continue it).
  const seq = 500 + salesOrders.filter((s) => s.number.startsWith('SO/2026/05')).length + 1;

  const associationDetail =
    association.kind === 'number_match'
      ? `Quotation ${quote.number} matched automatically by quotation number cited in the PO`
      : `Quotation ${quote.number} associated manually by ${association.by}`;

  return {
    id: verificationSoId(email.id),
    number: `SO/2026/${pad(seq, 4)}`,
    poNumber,
    poDate,
    quotationId: quote.id,
    quotationNumber: quote.number,
    partyId: quote.partyId,
    customerName: quote.customerName,
    customerCode: quote.customerCode,
    officeId: quote.officeId,
    owner: quote.owner,
    value: poValue,
    poValue,
    quoteValue,
    status: 'draft',
    verificationStatus,
    receivedDate,
    poReceivedAt: email.receivedAt,
    createdDate: TODAY,
    deliveryDate,
    billingAddress,
    shippingAddress,
    revisionNumber: 0,
    versions: [
      {
        id: `ver-${email.id}-0`,
        label: 'Original',
        version: 0,
        createdAt: `${TODAY}T12:41:00`,
        by: quote.owner,
        reason: 'Initial sales order',
        snapshot: {
          items: items.map((it) => ({ ...it })),
          paymentTerms: quote.paymentTerms,
          deliveryTerms: quote.deliveryTerms,
          deliveryDate,
          billingAddress,
          shippingAddress,
        },
      },
    ],
    items,
    paymentTerms: quote.paymentTerms,
    deliveryTerms: quote.deliveryTerms,
    warranty: quote.warranty,
    packingCharges: quote.packingCharges,
    internalNotes: [],
    activity: [
      { id: `act-${email.id}-po`, date: email.receivedAt, actor: 'System (AI)', action: 'Purchase Order received', detail: `${poNumber} — ${quote.customerName}` },
      {
        id: `act-${email.id}-assoc`,
        date: `${TODAY}T12:41:00`,
        actor: association.kind === 'number_match' ? 'System (AI)' : association.by,
        action: 'Quotation associated',
        detail: associationDetail,
      },
      { id: `act-${email.id}-compared`, date: `${TODAY}T12:41:00`, actor: 'System (AI)', action: 'PO vs Quote comparison generated', detail: `${mismatches} field(s) flagged for review` },
    ],
    verificationFields,
  };
}

/**
 * Email patch that persists the association in shared state: links the email to
 * the quotation + verification SO and flips the inbox into the PO vs Quote
 * verification workflow (poVerifyId).
 */
export function associationEmailPatch(
  email: InboxEmail,
  quote: Quotation,
  so: SalesOrder
): Partial<InboxEmail> {
  const hasMismatch = so.verificationFields.some((f) => !f.match);
  return {
    poVerifyId: so.id,
    linkedQuotation: quote.number,
    linkedSO: so.number,
    needsReview: hasMismatch,
    validationFailed: hasMismatch,
    extraction: email.extraction.map((f) =>
      f.key === 'quotation'
        ? { ...f, value: quote.number, confidence: 'high' as const, edited: f.value.trim() !== quote.number }
        : f
    ),
    extractionConfirmed: true,
  };
}
