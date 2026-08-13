import type {
  ActivityEvent,
  Attachment,
  LineItem,
  RevisionState,
  SalesOrder,
  SORevisionSnapshot,
  SORevisionVersion,
  SOStatus,
  VerificationField,
  VerificationStatus,
} from '@/types';
import { computeTotals, formatINR } from '@/lib/format';
import { QUOTATIONS } from './quotations';
import { PARTIES } from './masters';

const PARTY_MAP = new Map(PARTIES.map((p) => [p.id, p]));

const REQUESTERS = [
  'Rahul Chauhan (Customer)',
  'Meera Joshi (Customer)',
  'Priya Nair (Office Admin)',
  'Sanjay Kulkarni (Customer)',
];

function snap(o: {
  items: LineItem[];
  paymentTerms: string;
  deliveryTerms: string;
  deliveryDate: string;
  billingAddress: string;
  shippingAddress: string;
}): SORevisionSnapshot {
  return {
    items: o.items.map((it) => ({ ...it })),
    paymentTerms: o.paymentTerms,
    deliveryTerms: o.deliveryTerms,
    deliveryDate: o.deliveryDate,
    billingAddress: o.billingAddress,
    shippingAddress: o.shippingAddress,
  };
}

/** Apply the correction implied by a revision reason to a snapshot. */
function applyReason(base: SORevisionSnapshot, reason: string): SORevisionSnapshot {
  const next = snap(base);
  if (/quantity/i.test(reason)) {
    if (next.items[0]) next.items[0] = { ...next.items[0], quantity: next.items[0].quantity + 6 };
  } else if (/address/i.test(reason)) {
    next.shippingAddress = next.shippingAddress.replace(/\d{6}$/, '560105') + ' — Gate 3 (revised)';
  } else if (/payment/i.test(reason)) {
    next.paymentTerms = '50% advance, 50% on delivery (corrected per PO)';
  } else if (/price/i.test(reason)) {
    if (next.items[0]) next.items[0] = { ...next.items[0], unitPrice: Math.round(next.items[0].unitPrice * 0.96) };
  }
  return next;
}

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

    const party = PARTY_MAP.get(q.partyId);
    const billingAddress = party?.billingAddress ?? 'Corporate Office, India';
    const shippingAddress = party?.shippingAddress ?? 'Central Warehouse, India';
    const revisionReason = isRevision ? REVISION_REASONS[i % REVISION_REASONS.length] : undefined;
    const revisionRequestedDate = isRevision ? addDays('2026-08-13', -Math.floor(rand() * 5)) : undefined;
    const revisionRequestedBy = isRevision ? REQUESTERS[i % REQUESTERS.length] : undefined;

    // Base (pre-revision) snapshot — becomes the immutable "Original" version.
    const baseSnapshot: SORevisionSnapshot = snap({
      items,
      paymentTerms: q.paymentTerms,
      deliveryTerms: q.deliveryTerms,
      deliveryDate,
      billingAddress,
      shippingAddress,
    });

    const activity: ActivityEvent[] = [
      { id: `act-${i}-created`, date: `${createdDate}T09:15:00`, actor: q.owner, action: 'Sales Order created', detail: `From accepted quotation ${q.number}` },
    ];
    if (isRevision) {
      activity.push({
        id: `act-${i}-revreq`,
        date: `${revisionRequestedDate}T11:00:00`,
        actor: revisionRequestedBy ?? q.owner,
        action: 'Revision requested',
        detail: revisionReason,
      });
    }

    const versions: SORevisionVersion[] = [
      {
        id: `ver-${i}-0`,
        label: 'Original',
        version: 0,
        createdAt: `${createdDate}T09:15:00`,
        by: q.owner,
        reason: 'Initial sales order',
        snapshot: baseSnapshot,
        attachments: [],
      },
    ];

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
      billingAddress,
      shippingAddress,
      revisionReason,
      revisionRequestedDate,
      revisionRequestedBy,
      revisionState: isRevision ? 'revision_required' : undefined,
      revisionNumber: 0,
      revisionOwner: isRevision ? q.owner : undefined,
      revisionAttachments: [],
      versions,
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
      activity,
      verificationFields: buildVerificationFields(rand, quoteValue, poValue, mismatch),
    });
  });

  seedRevisionSubStates(list);
  return list;
}

/**
 * Distribute the revision-required SOs across the workflow sub-states so every
 * state → action mapping is demoable, and promote one sent SO to a completed
 * "Rev 1" so the Revised-SO-Sent state and the SO-list revision number show up.
 */
function seedRevisionSubStates(list: SalesOrder[]) {
  const rotation: RevisionState[] = ['revision_required', 'draft_in_progress', 'awaiting_approval', 'revision_approved'];
  let r = 0;
  for (const so of list) {
    if (so.status !== 'revision_required' || !so.revisionReason) continue;
    const state = rotation[r % rotation.length];
    r += 1;
    so.revisionState = state;
    if (state === 'revision_required') continue;

    const original = so.versions[0].snapshot;
    const draft = applyReason(original, so.revisionReason);
    const notes = `Correction applied: ${so.revisionReason}.`;
    so.revisionDraft = draft;
    so.revisionNotes = notes;
    so.revisionPreviewed = true;
    const stamp = so.revisionRequestedDate ?? so.createdDate;

    if (state === 'draft_in_progress') {
      so.activity.push({ id: `act-${so.id}-draft`, date: `${stamp}T14:20:00`, actor: so.owner, action: 'Revision draft saved', detail: notes });
    } else if (state === 'awaiting_approval') {
      so.activity.push({ id: `act-${so.id}-draft`, date: `${stamp}T14:20:00`, actor: so.owner, action: 'Revision draft saved', detail: notes });
      so.activity.push({ id: `act-${so.id}-submit`, date: `${stamp}T15:05:00`, actor: so.owner, action: 'Submitted for approval', detail: 'Revised Sales Order sent for approval.' });
    } else if (state === 'revision_approved') {
      so.activity.push({ id: `act-${so.id}-draft`, date: `${stamp}T14:20:00`, actor: so.owner, action: 'Revision draft saved', detail: notes });
      so.activity.push({ id: `act-${so.id}-submit`, date: `${stamp}T15:05:00`, actor: so.owner, action: 'Submitted for approval', detail: 'Revised Sales Order sent for approval.' });
      so.activity.push({ id: `act-${so.id}-approve`, date: `${stamp}T16:30:00`, actor: 'Priya Nair', action: 'Revision approved', detail: 'Approved and ready to send.' });
    }
  }

  // Promote one already-sent SO to a completed Rev 1 for the "Revised SO Sent" demo.
  const sent = list.find((s) => s.status === 'so_sent' && s.revisionReason === undefined);
  if (sent) {
    const original = sent.versions[0].snapshot;
    const reason = 'Line item price corrected per customer PO';
    const revised = applyReason(original, 'price');
    const stamp = sent.createdDate;
    const attachments: Attachment[] = [
      { id: `att-${sent.id}-po`, name: 'Revised-PO-signed.pdf', size: '218 KB', uploadedOn: stamp },
    ];
    sent.revisionReason = reason;
    sent.revisionRequestedBy = 'Meera Joshi (Customer)';
    sent.revisionRequestedDate = addDays(stamp, 2);
    sent.revisionOwner = sent.owner;
    sent.revisionState = 'revised_sent';
    sent.revisionNumber = 1;
    sent.revisionNotes = 'Unit price corrected to match the customer PO.';
    sent.revisionPreviewed = true;
    sent.revisionDraft = revised;
    sent.revisionAttachments = attachments;
    // Apply the revised snapshot to the live SO (original preserved in versions[0]).
    sent.items = revised.items.map((it) => ({ ...it }));
    sent.paymentTerms = revised.paymentTerms;
    sent.deliveryTerms = revised.deliveryTerms;
    sent.deliveryDate = revised.deliveryDate;
    sent.billingAddress = revised.billingAddress;
    sent.shippingAddress = revised.shippingAddress;
    sent.value = computeTotals(revised.items, sent.packingCharges).grandTotal;
    sent.versions.push({
      id: `ver-${sent.id}-1`,
      label: 'Rev 1',
      version: 1,
      createdAt: `${addDays(stamp, 3)}T12:00:00`,
      by: sent.owner,
      reason,
      notes: sent.revisionNotes,
      snapshot: revised,
      attachments,
    });
    sent.activity.push(
      { id: `act-${sent.id}-revreq`, date: `${addDays(stamp, 2)}T11:00:00`, actor: 'Meera Joshi (Customer)', action: 'Revision requested', detail: reason },
      { id: `act-${sent.id}-approve`, date: `${addDays(stamp, 3)}T10:00:00`, actor: 'Priya Nair', action: 'Revision approved', detail: 'Approved.' },
      { id: `act-${sent.id}-sent`, date: `${addDays(stamp, 3)}T12:00:00`, actor: sent.owner, action: 'Revised SO sent', detail: 'Rev 1 dispatched to customer.' },
    );
  }
}

export const SALES_ORDERS: SalesOrder[] = generate();
