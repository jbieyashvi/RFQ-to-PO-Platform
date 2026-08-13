import type {
  LineItem,
  SalesOrder,
  SOStatus,
  VerificationField,
  VerificationStatus,
} from '@/types';
import { computeTotals, formatINR } from '@/lib/format';
import { QUOTATIONS } from './quotations';

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const SO_STATUSES: SOStatus[] = ['draft', 'so_sent', 'so_sent', 'revision_required', 'finalised'];
const VERIF: VerificationStatus[] = [
  'pending',
  'matched',
  'mismatch',
  'corrected_awaited',
  'verified',
  'verified',
];
const REVISION_REASONS = [
  'Customer PO revised — quantity increased',
  'Delivery address correction required',
  'Payment terms mismatch to be corrected',
  'Line item price to be updated per PO',
];

function buildVerificationFields(
  rand: () => number,
  quoteValue: number,
  poValue: number,
  mismatch: boolean
): VerificationField[] {
  const priceMatch = !mismatch || rand() > 0.5;
  const qtyMatch = !mismatch || rand() > 0.4;
  const taxMatch = true;
  const payMatch = !mismatch || rand() > 0.6;
  const delMatch = !mismatch || rand() > 0.5;
  return [
    { label: 'Item / Description', quoteValue: 'As per accepted quotation', poValue: 'As per customer PO', match: true },
    { label: 'Quantity (total units)', quoteValue: '48 units', poValue: qtyMatch ? '48 units' : '54 units', match: qtyMatch },
    { label: 'Unit Price (weighted avg)', quoteValue: '₹12,450', poValue: priceMatch ? '₹12,450' : '₹12,100', match: priceMatch },
    { label: 'Taxes (GST)', quoteValue: '18% GST', poValue: '18% GST', match: taxMatch },
    { label: 'Payment Terms', quoteValue: '30% advance, 70% before dispatch', poValue: payMatch ? '30% advance, 70% before dispatch' : 'Net 60 days credit', match: payMatch },
    { label: 'Delivery Terms', quoteValue: '4-6 weeks Ex-Works', poValue: delMatch ? '4-6 weeks Ex-Works' : 'FOR site, 3 weeks', match: delMatch },
    { label: 'Total Order Value', quoteValue: formatINR(quoteValue), poValue: formatINR(poValue), match: Math.abs(quoteValue - poValue) < 1 },
  ];
}

function generate(): SalesOrder[] {
  const list: SalesOrder[] = [];
  // Base SOs on quotations that are received/closed/finalised
  const source = QUOTATIONS.filter(
    (q) => q.status === 'received' || q.stage === 'finalised' || q.status === 'closed'
  ).slice(0, 18);

  source.forEach((q, i) => {
    const rand = rng(5000 + i * 53);
    const items: LineItem[] = q.items.map((it) => ({ ...it, id: `so-${it.id}` }));
    const { grandTotal: quoteValue } = computeTotals(items, q.packingCharges);

    const verificationStatus = VERIF[i % VERIF.length];
    const mismatch = verificationStatus === 'mismatch' || verificationStatus === 'corrected_awaited';
    // PO value diverges when mismatch
    const poValue = mismatch ? Math.round(quoteValue * (0.94 + rand() * 0.04)) : quoteValue;

    let status: SOStatus = SO_STATUSES[i % SO_STATUSES.length];
    // only verified/matched can be sent or finalised
    if ((status === 'so_sent' || status === 'finalised') && !(verificationStatus === 'verified')) {
      // keep some as sent for demo, but bias drafts when not verified
      if (mismatch) status = 'revision_required';
    }

    const receivedDate = addDays('2026-08-13', -(3 + Math.floor(rand() * 30)));
    const poDate = addDays(receivedDate, -2);
    const createdDate = addDays(receivedDate, 1);
    const deliveryDate = addDays('2026-08-13', 15 + Math.floor(rand() * 40));

    const isRevision = status === 'revision_required';
    const value = poValue;

    list.push({
      id: `so-${pad(i + 1, 3)}`,
      number: `SO/2026/${pad(500 + i + 1, 4)}`,
      poNumber: `PO-${q.customerCode.replace('CUST-', '')}-${pad(700 + i, 4)}`,
      poDate,
      quotationId: q.id,
      quotationNumber: q.number,
      partyId: q.partyId,
      customerName: q.customerName,
      customerCode: q.customerCode,
      officeId: q.officeId,
      owner: q.owner,
      value,
      poValue,
      quoteValue,
      status,
      verificationStatus,
      receivedDate,
      createdDate,
      deliveryDate,
      revisionReason: isRevision ? REVISION_REASONS[i % REVISION_REASONS.length] : undefined,
      revisionRequestedDate: isRevision ? addDays('2026-08-13', -Math.floor(rand() * 5)) : undefined,
      items,
      paymentTerms: q.paymentTerms,
      deliveryTerms: q.deliveryTerms,
      warranty: q.warranty,
      packingCharges: q.packingCharges,
      internalNotes: mismatch
        ? [
            {
              id: `note-${i}-1`,
              date: `${receivedDate}T10:30:00`,
              author: q.owner,
              text: 'Customer PO value differs from accepted quotation. Flagged for correction — awaiting revised PO.',
            },
          ]
        : [],
      verificationFields: buildVerificationFields(rand, quoteValue, poValue, mismatch),
    });
  });
  return list;
}

export const SALES_ORDERS: SalesOrder[] = generate();
