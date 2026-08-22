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
const FAIL_REASONS = [
  'SMTP relay rejected: recipient mailbox is full',
  'Delivery failed: customer mail server timed out',
  'Bounced: recipient address on file is invalid',
];

// pty-16 is a brand-new customer with deliberately NO quotation history (used to
// demo the "no valid quotation → Create SO Manually" path). Pinning the cycle to
// the original 15 parties also keeps the existing seed data stable.
const QUOTE_PARTIES = PARTIES.filter((p) => p.id !== 'pty-16');

function generate(): Quotation[] {
  const list: Quotation[] = [];
  const total = 34;
  let pendingSeen = 0;
  for (let i = 0; i < total; i++) {
    const rand = rng(1000 + i * 37);
    const party = QUOTE_PARTIES[i % QUOTE_PARTIES.length];
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

    // Delivery / send state — independent of Status & Stage.
    let deliveryState: Quotation['deliveryState'] = 'not_sent';
    let sentAt: string | undefined;
    let sentBy: string | undefined;
    let sendFailureReason: string | undefined;
    if (workState === 'sent') {
      deliveryState = 'sent';
      sentAt = `${quoteDate}T16:45:00`;
      sentBy = owner;
    } else if (workState === 'pending_send') {
      pendingSeen += 1;
      // Guarantee each pending delivery state is represented for the demo.
      if (pendingSeen === 1) {
        deliveryState = 'send_failed';
        sendFailureReason = FAIL_REASONS[i % FAIL_REASONS.length];
      } else if (pendingSeen === 2) {
        deliveryState = 'awaiting_approval';
      } else if (pendingSeen % 2 === 1) {
        deliveryState = 'draft_ready';
      } else {
        deliveryState = 'not_sent';
      }
    } else {
      // needs_revision
      deliveryState = rand() > 0.5 ? 'draft_ready' : 'not_sent';
    }

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
      deliveryState,
      sentAt,
      sentBy,
      sendFailureReason,
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

// ---------------------------------------------------------------------------
// One year of quotation history (60–364 days before 2026-08-13). These feed the
// "Associate Quotation" drawer in the inbox (customer's quotations from the
// last one year) and the historical sales-order seed. All were sent to the
// customer; ids are prefixed `qtn-h-` so the current-period sales-order
// generator can exclude them.
// ---------------------------------------------------------------------------
const HIST_STATUSES: QuotationStatus[] = ['closed', 'received', 'open', 'closed', 'received'];
const HIST_STAGES: QuotationStage[] = ['finalised', 'negotiation', 'budgetary', 'finalised', 'finalised'];

function generateHistorical(): Quotation[] {
  const list: Quotation[] = [];
  const total = 20;
  let seq2025 = 0;
  let seq2026 = 0;
  for (let i = 0; i < total; i++) {
    const rand = rng(9000 + i * 53);
    const party = QUOTE_PARTIES[(i * 3 + 1) % QUOTE_PARTIES.length];
    const officeUsers = USERS.filter((u) => u.officeId === party.officeId && u.active);
    const owner = (officeUsers[i % Math.max(1, officeUsers.length)] ?? USERS[0]).fullName;
    const items = buildLines(rand, 2 + Math.floor(rand() * 4));
    const { grandTotal } = computeTotals(items, 0);

    // created between 60 and 364 days before today (2026-08-13) — a full year
    // of cover so the ERP Handoff history spans the previous twelve months
    const createdOffset = 60 + i * 16;
    const createdDate = addDays('2026-08-13', -createdOffset);
    const quoteDate = addDays(createdDate, 1);
    const year = quoteDate.slice(0, 4);
    const seq = year === '2025' ? ++seq2025 : ++seq2026;
    const number = year === '2025' ? `QTN/2025/${pad(820 + seq, 4)}` : `QTN/2026/${pad(120 + seq, 4)}`;

    const status = HIST_STATUSES[i % HIST_STATUSES.length];
    const stage = HIST_STAGES[i % HIST_STAGES.length];
    // A few quotes were revised and re-sent later, so Latest Sent Date differs
    // from the quote date.
    const resendGap = i % 3 === 0 ? 9 + Math.floor(rand() * 10) : 0;
    const lastSentDate = addDays(quoteDate, resendGap);
    const sentAt = `${lastSentDate}T15:20:00`;
    const lastUpdated = lastSentDate;

    list.push({
      id: `qtn-h-${pad(i + 1, 3)}`,
      number,
      partyId: party.id,
      customerName: party.companyName,
      customerCode: party.code,
      officeId: party.officeId,
      owner,
      status,
      stage,
      workState: 'sent',
      deliveryState: 'sent',
      sentAt,
      sentBy: owner,
      value: grandTotal,
      quoteDate,
      reviewDate: addDays(quoteDate, 30),
      createdDate,
      lastUpdated,
      items,
      paymentTerms: PAYMENT_TERMS[i % PAYMENT_TERMS.length],
      deliveryTerms: DELIVERY_TERMS[i % DELIVERY_TERMS.length],
      warranty: '12 months against manufacturing defects',
      packingCharges: rand() > 0.5 ? Math.round(grandTotal * 0.02) : 0,
      revisions:
        resendGap > 0
          ? [
              { id: `rev-h-${i}-1`, version: 1, date: quoteDate, reason: 'Initial quotation issued', by: owner },
              { id: `rev-h-${i}-2`, version: 2, date: lastSentDate, reason: 'Price revision as per negotiation', by: owner },
            ]
          : [{ id: `rev-h-${i}-1`, version: 1, date: quoteDate, reason: 'Initial quotation issued', by: owner }],
      activity: [
        { id: `act-h-${i}-1`, date: `${createdDate}T09:15:00`, actor: owner, action: 'Quotation created', detail: `From RFQ enquiry — ${party.companyName}` },
        { id: `act-h-${i}-2`, date: `${quoteDate}T11:30:00`, actor: owner, action: 'Quote prepared', detail: `${items.length} line items added` },
        { id: `act-h-${i}-3`, date: sentAt, actor: owner, action: 'Quotation sent to customer' },
      ],
    });
  }
  return list;
}

export const QUOTATIONS: Quotation[] = [...generate(), ...generateHistorical()];
