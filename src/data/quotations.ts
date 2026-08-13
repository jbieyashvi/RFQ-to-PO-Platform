import type {
  LineItem,
  Quotation,
  QuotationStage,
  QuotationStatus,
  QuotationWorkState,
} from '@/types';
import { computeTotals } from '@/lib/format';
import { ITEMS, PARTIES } from './masters';
import { USERS } from './users';

// deterministic pseudo-random
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function pad(n: number, w: number) {
  return String(n).padStart(w, '0');
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildLines(rand: () => number, count: number): LineItem[] {
  const lines: LineItem[] = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let idx = Math.floor(rand() * ITEMS.length);
    let guard = 0;
    while (used.has(idx) && guard++ < 20) idx = Math.floor(rand() * ITEMS.length);
    used.add(idx);
    const item = ITEMS[idx];
    const qty = Math.max(1, Math.floor(rand() * 30) + 1);
    const discount = [0, 0, 2.5, 5, 7.5, 10][Math.floor(rand() * 6)];
    lines.push({
      id: `ln-${i}-${item.id}`,
      itemId: item.id,
      itemCode: item.code,
      description: item.name,
      hsnCode: item.hsnCode,
      quantity: qty,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountPct: discount,
      taxPct: 18,
    });
  }
  return lines;
}

const STATUSES: QuotationStatus[] = ['open', 'open', 'open', 'received', 'closed'];
const STAGES: QuotationStage[] = ['no_followup', 'budgetary', 'negotiation', 'finalised'];
const PAYMENT_TERMS = ['30% advance, 70% before dispatch', 'Net 45 days credit', '50% advance, 50% on delivery'];
const DELIVERY_TERMS = ['4-6 weeks Ex-Works', 'FOR destination', '2-3 weeks Ex-Works'];
const REVISION_REASONS = [
  'Customer requested revised pricing',
  'Quantity change for line items',
  'Updated delivery schedule required',
  'Discount approval revision',
  'Technical specification change',
];

function generate(): Quotation[] {
  const list: Quotation[] = [];
  const total = 34;
  for (let i = 0; i < total; i++) {
    const rand = rng(1000 + i * 37);
    const party = PARTIES[i % PARTIES.length];
    const officeUsers = USERS.filter((u) => u.officeId === party.officeId && u.active);
    const owner = (officeUsers[i % Math.max(1, officeUsers.length)] ?? USERS[0]).fullName;
    const lineCount = 2 + Math.floor(rand() * 4);
    const items = buildLines(rand, lineCount);
    const { grandTotal } = computeTotals(items, 0);

    // dates: created between 2 and 70 days before today (2026-08-13)
    const createdOffset = 2 + Math.floor(rand() * 68);
    const createdDate = addDays('2026-08-13', -createdOffset);
    const quoteDate = addDays(createdDate, 1);
    const reviewOffset = -createdOffset + 10 + Math.floor(rand() * 40);
    const reviewDate = addDays('2026-08-13', reviewOffset);
    const lastUpdated = addDays('2026-08-13', -Math.floor(rand() * createdOffset));

    let status: QuotationStatus = STATUSES[Math.floor(rand() * STATUSES.length)];
    let stage: QuotationStage = STAGES[Math.floor(rand() * STAGES.length)];

    // work state distribution
    let workState: QuotationWorkState = 'sent';
    const r = rand();
    if (r < 0.2) workState = 'pending_send';
    else if (r < 0.35) workState = 'needs_revision';

    if (workState === 'pending_send') {
      status = 'open';
      stage = i % 2 === 0 ? 'budgetary' : 'no_followup';
    }
    if (status === 'received') stage = 'finalised';

    const revisionReason =
      workState === 'needs_revision' ? REVISION_REASONS[i % REVISION_REASONS.length] : undefined;
    const revisionRequestedDate =
      workState === 'needs_revision' ? addDays('2026-08-13', -Math.floor(rand() * 6)) : undefined;

    const revisions =
      rand() > 0.5
        ? [
            { id: `rev-${i}-1`, version: 1, date: quoteDate, reason: 'Initial quotation issued', by: owner },
            {
              id: `rev-${i}-2`,
              version: 2,
              date: lastUpdated,
              reason: revisionReason ?? 'Price revision as per negotiation',
              by: owner,
            },
          ]
        : [{ id: `rev-${i}-1`, version: 1, date: quoteDate, reason: 'Initial quotation issued', by: owner }];

    list.push({
      id: `qtn-${pad(i + 1, 3)}`,
      number: `QTN/2026/${pad(1000 + i + 1, 4)}`,
      partyId: party.id,
      customerName: party.companyName,
      customerCode: party.code,
      officeId: party.officeId,
      owner,
      status,
      stage,
      workState,
      value: grandTotal,
      quoteDate,
      reviewDate,
      createdDate,
      lastUpdated,
      revisionReason,
      revisionRequestedDate,
      items,
      paymentTerms: PAYMENT_TERMS[i % PAYMENT_TERMS.length],
      deliveryTerms: DELIVERY_TERMS[i % DELIVERY_TERMS.length],
      warranty: '12 months against manufacturing defects',
      packingCharges: rand() > 0.5 ? Math.round(grandTotal * 0.02) : 0,
      attachments: [
        { id: `att-${i}-1`, name: `${`QTN-2026-${pad(1000 + i + 1, 4)}`}.pdf`, size: '182 KB', uploadedOn: quoteDate },
        ...(rand() > 0.6
          ? [{ id: `att-${i}-2`, name: 'Technical-Datasheet.pdf', size: '640 KB', uploadedOn: quoteDate }]
          : []),
      ],
      revisions,
      activity: [
        { id: `act-${i}-1`, date: `${createdDate}T09:15:00`, actor: owner, action: 'Quotation created', detail: `From RFQ enquiry — ${party.companyName}` },
        { id: `act-${i}-2`, date: `${quoteDate}T11:30:00`, actor: owner, action: 'Quote prepared', detail: `${items.length} line items added` },
        ...(workState === 'sent'
          ? [{ id: `act-${i}-3`, date: `${quoteDate}T16:45:00`, actor: owner, action: 'Quotation sent to customer' }]
          : []),
        ...(workState === 'needs_revision'
          ? [{ id: `act-${i}-3`, date: `${revisionRequestedDate}T10:00:00`, actor: party.contactPerson, action: 'Revision requested', detail: revisionReason }]
          : []),
        { id: `act-${i}-4`, date: `${lastUpdated}T14:20:00`, actor: owner, action: `Stage updated to ${stage}` },
      ],
    });
  }
  return list;
}

export const QUOTATIONS: Quotation[] = generate();
