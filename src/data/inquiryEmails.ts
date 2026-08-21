import type { InboxEmail, Quotation, SalesOrder } from '@/types';
import { inquiryNumberFor } from '@/lib/inquiry';
import { officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { compactINR } from '@/lib/format';
import { PARTIES } from './masters';
import { QUOTATIONS } from './quotations';
import { SALES_ORDERS } from './salesOrders';

// ---------------------------------------------------------------------------
// Inquiry conversations — the SEPARATE email threads that make up one inquiry.
//
// A real inquiry never arrives as a single conversation: the RFQ comes in on
// one thread, the quotation goes out on another, the customer's revision ask
// lands as a fresh mail, the Purchase Order arrives from the procurement desk
// and the Sales Order acknowledgement goes back out. Every one of these carries
// the SAME `inquiryId` (the quotation behind the enquiry), which is what lets
// the Global Inbox bundle them under one inquiry header even though they share
// no email thread.
//
// Together with the PO-verification and SO-revision seeds, each inquiry that
// reached a Purchase Order shows 4–6 messages spanning Inquiry, Quotation
// Revision, Purchase Order and Sales Order Query.
// ---------------------------------------------------------------------------

function domainOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|corp|company|and|&)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return `${slug || 'customer'}.com`;
}

function officeEmail(officeId: string): string {
  const city = officeName(officeId).split(' ')[0].toLowerCase();
  return `sales.${city}@flowtech-instruments.com`;
}

function partyOf(q: Quotation) {
  return PARTIES.find((p) => p.id === q.partyId);
}

function itemsSummary(q: Quotation): string {
  return q.items.map((it) => `  • ${it.description} — ${it.quantity} ${it.unit}`).join('\n');
}

// Shared skeleton: everything these seeded conversations have in common. They
// are historical context for the workflow queues, so they never add noise to
// "Needs Review" or "Drafts".
function base(q: Quotation, id: string): Pick<
  InboxEmail,
  'id' | 'cc' | 'thread' | 'read' | 'needsReview' | 'officeId' | 'owner' | 'partyId' |
  'customerName' | 'customerCode' | 'inquiryId' | 'inquiryNo' | 'extractionConfirmed' | 'draftSaved'
> {
  return {
    id,
    cc: [],
    thread: [],
    read: true,
    needsReview: false,
    officeId: q.officeId,
    owner: q.owner,
    partyId: q.partyId,
    customerName: q.customerName,
    customerCode: q.customerCode,
    // The explicit inquiry link — no number-matching needed to bundle these.
    inquiryId: q.id,
    inquiryNo: inquiryNumberFor(q),
    extractionConfirmed: true,
    draftSaved: false,
  };
}

// 1) The customer's original RFQ — where the inquiry starts.
function rfqEmail(q: Quotation, withQuotationLink: boolean): InboxEmail {
  const party = partyOf(q);
  const contact = party?.contactPerson ?? q.customerName.split(' ')[0];
  const inquiryNo = inquiryNumberFor(q);
  return {
    ...base(q, `em-inq-rfq-${q.id}`),
    senderName: contact,
    senderEmail: party?.email ?? `procurement@${domainOf(q.customerName)}`,
    recipient: officeEmail(q.officeId),
    subject: `Enquiry ${inquiryNo} — request for quotation`,
    receivedAt: `${q.createdDate}T09:10:00`,
    body: `Dear ${q.owner.split(' ')[0]},\n\nPlease share your best quotation against our enquiry ${inquiryNo} for the following requirement:\n\n${itemsSummary(q)}\n\nKindly include GST, delivery schedule and payment terms in your offer.\n\nRegards,\n${contact}\n${q.customerName}`,
    classification: 'inquiry',
    aiConfidence: 93,
    // Kept off pending-send inquiries: an unsent email carrying the quotation
    // number is what "Review & Send Email" picks up, and this is context — not
    // the quote-send draft.
    ...(withQuotationLink ? { linkedQuotation: q.number } : {}),
    extraction: [
      { key: 'customer', label: 'Customer / Party', value: q.customerName, confidence: 'high', required: true },
      { key: 'inquiryNo', label: 'Inquiry Number', value: inquiryNo, confidence: 'high', required: true },
      { key: 'product', label: 'Products / Items', value: q.items.map((it) => it.description).join('; '), confidence: 'high', required: true },
      { key: 'quantity', label: 'Quantity', value: q.items.map((it) => `${it.quantity} ${it.unit}`).join('; '), confidence: 'high', required: true },
      { key: 'requestedDate', label: 'Requested Date', value: q.deliveryTerms, confidence: 'medium' },
    ],
    sent: false,
  };
}

// 2) The quotation going back out — a separate outgoing thread.
function quoteSentEmail(q: Quotation): InboxEmail {
  const party = partyOf(q);
  const contact = party?.contactPerson ?? 'Sir/Madam';
  const from = officeEmail(q.officeId);
  const to = party?.email ?? `procurement@${domainOf(q.customerName)}`;
  const sentAt = q.sentAt ?? `${q.quoteDate}T16:45:00`;
  const subject = `Quotation ${q.number} — ${inquiryNumberFor(q)}`;
  const body = `Dear ${contact},\n\nThank you for your enquiry ${inquiryNumberFor(q)}. Our quotation ${q.number} is attached for your kind review.\n\nGrand total: ${compactINR(q.value)} (inclusive of applicable GST).\nPayment terms: ${q.paymentTerms}.\nDelivery: ${q.deliveryTerms}.\n\nThis quotation is valid for 30 days. We look forward to your confirmation.\n\n${emailSignature(q.owner, officeName(q.officeId))}`;
  return {
    ...base(q, `em-inq-quote-${q.id}`),
    senderName: q.owner,
    senderEmail: from,
    recipient: to,
    subject,
    receivedAt: sentAt,
    body,
    classification: 'inquiry',
    aiConfidence: 96,
    linkedQuotation: q.number,
    extraction: [
      { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
      { key: 'quotation', label: 'Quotation', value: q.number, confidence: 'high', required: true },
      { key: 'value', label: 'Quoted Value', value: compactINR(q.value), confidence: 'high' },
    ],
    draft: {
      from,
      to,
      cc: '',
      subject,
      body,
      relatedDoc: q.number,
      amount: q.value,
      aiGenerated: true,
    },
    sent: true,
    sentAt,
  };
}

// 3) The customer's revision ask — arrives as its own mail, days later.
function revisionAskEmail(q: Quotation): InboxEmail {
  const party = partyOf(q);
  const contact = party?.contactPerson ?? q.customerName.split(' ')[0];
  const reason = q.revisionReason ?? 'Commercial negotiation on the quoted value';
  return {
    ...base(q, `em-inq-rev-${q.id}`),
    senderName: contact,
    senderEmail: party?.email ?? `procurement@${domainOf(q.customerName)}`,
    recipient: officeEmail(q.officeId),
    subject: `RE: Quotation ${q.number} — revised offer requested`,
    receivedAt: `${q.lastUpdated}T11:05:00`,
    body: `Hi ${q.owner.split(' ')[0]},\n\nThe technical scope in ${q.number} is acceptable. Before we raise the order, we need the commercials revised.\n\nReason: ${reason}\n\nKindly share a revised offer at the earliest so we can proceed to PO.\n\nBest,\n${contact}\n${q.customerName}`,
    classification: 'quotation_revision',
    aiConfidence: 89,
    linkedQuotation: q.number,
    extraction: [
      { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
      { key: 'quotation', label: 'Quotation', value: q.number, confidence: 'high', required: true },
      { key: 'reason', label: 'Revision Reason', value: reason, confidence: 'medium', required: true },
    ],
    sent: false,
  };
}

// 4) The Sales Order acknowledgement going out — closes the loop on the inquiry.
function soAckEmail(q: Quotation, so: SalesOrder): InboxEmail {
  const party = partyOf(q);
  const contact = party?.contactPerson ?? 'Sir/Madam';
  const from = officeEmail(so.officeId);
  const to = party?.email ?? `procurement@${domainOf(so.customerName)}`;
  const sentAt = so.sentAt ?? `${so.createdDate}T17:10:00`;
  const subject = `Sales Order ${so.number} — order acknowledgement (${so.poNumber})`;
  const body = `Dear ${contact},\n\nThank you for Purchase Order ${so.poNumber}. We confirm acceptance and attach our Sales Order ${so.number} raised against quotation ${so.quotationNumber ?? q.number}.\n\nOrder value: ${compactINR(so.value)}.\nPayment terms: ${so.paymentTerms}.\nDelivery: ${so.deliveryTerms} — scheduled ${so.deliveryDate}.\n\n${emailSignature(so.owner, officeName(so.officeId))}`;
  return {
    ...base(q, `em-inq-soack-${so.id}`),
    owner: so.owner,
    senderName: so.owner,
    senderEmail: from,
    recipient: to,
    subject,
    receivedAt: sentAt,
    body,
    classification: 'so_query',
    aiConfidence: 95,
    linkedSO: so.number,
    linkedPO: so.poNumber,
    linkedQuotation: so.quotationNumber,
    extraction: [
      { key: 'customer', label: 'Customer', value: so.customerName, confidence: 'high', required: true },
      { key: 'soNumber', label: 'SO Number', value: so.number, confidence: 'high', required: true },
      { key: 'poNumber', label: 'PO Number', value: so.poNumber, confidence: 'high' },
      { key: 'value', label: 'Order Value', value: compactINR(so.value), confidence: 'high' },
    ],
    draft: {
      from,
      to,
      cc: '',
      subject,
      body,
      relatedDoc: so.number,
      amount: so.value,
      aiGenerated: true,
    },
    sent: true,
    sentAt,
  };
}

// 5) Pre-quotation clarifications — the extra threads a pending inquiry
//    collects while the quote is still being prepared.
function clarificationEmails(q: Quotation): InboxEmail[] {
  const party = partyOf(q);
  const contact = party?.contactPerson ?? q.customerName.split(' ')[0];
  const sender = party?.email ?? `procurement@${domainOf(q.customerName)}`;
  const first = q.items[0];
  return [
    {
      ...base(q, `em-inq-spec-${q.id}`),
      senderName: contact,
      senderEmail: sender,
      recipient: officeEmail(q.officeId),
      subject: `Specification clarification — ${inquiryNumberFor(q)}`,
      receivedAt: `${q.createdDate}T15:40:00`,
      body: `Dear ${q.owner.split(' ')[0]},\n\nAdditional detail against our enquiry ${inquiryNumberFor(q)}:\n\n${first ? `  • ${first.description} — please confirm make, model and datasheet.\n` : ''}  • Confirm compliance with our standard inspection and test plan.\n\nPlease factor this into the quotation you are preparing.\n\nRegards,\n${contact}\n${q.customerName}`,
      classification: 'inquiry',
      aiConfidence: 88,
      extraction: [
        { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
        { key: 'inquiryNo', label: 'Inquiry Number', value: inquiryNumberFor(q), confidence: 'high', required: true },
        { key: 'specification', label: 'Required Specifications', value: 'Make / model confirmation; inspection & test plan compliance', confidence: 'medium' },
      ],
      sent: false,
    },
    {
      ...base(q, `em-inq-terms-${q.id}`),
      senderName: `${contact} — Purchase`,
      senderEmail: sender,
      recipient: officeEmail(q.officeId),
      subject: `Budget & delivery timeline — ${inquiryNumberFor(q)}`,
      receivedAt: `${q.lastUpdated}T10:25:00`,
      body: `Hi ${q.owner.split(' ')[0]},\n\nOur management would like an indicative delivery commitment along with the quotation against ${inquiryNumberFor(q)}.\n\nPreferred payment terms at our end: ${q.paymentTerms}.\n\nCould you confirm whether ${q.deliveryTerms} is achievable?\n\nThanks,\n${contact}\n${q.customerName}`,
      classification: 'inquiry',
      aiConfidence: 85,
      extraction: [
        { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
        { key: 'inquiryNo', label: 'Inquiry Number', value: inquiryNumberFor(q), confidence: 'high', required: true },
        { key: 'requestedDate', label: 'Requested Date', value: q.deliveryTerms, confidence: 'medium' },
      ],
      sent: false,
    },
  ];
}

function build(): InboxEmail[] {
  const list: InboxEmail[] = [];
  // Current-period Sales Orders only — the historical ones (so-h-*) already have
  // their own PO trail and do not need a full conversation.
  const currentSos = SALES_ORDERS.filter((so) => !so.id.startsWith('so-h-'));
  const soByQuotation = new Map<string, SalesOrder>();
  for (const so of currentSos) {
    // A PO that was never associated to a quotation has no inquiry to join.
    if (!so.quotationId) continue;
    if (!soByQuotation.has(so.quotationId)) soByQuotation.set(so.quotationId, so);
  }

  for (const q of QUOTATIONS) {
    if (q.id.startsWith('qtn-h-')) continue;
    const so = soByQuotation.get(q.id);

    if (so) {
      // Reached a Purchase Order: RFQ → quotation → (revision ask) → PO email
      // (seeded separately) → Sales Order acknowledgement.
      list.push(rfqEmail(q, true), quoteSentEmail(q));
      if (q.revisions.length > 1) list.push(revisionAskEmail(q));
      list.push(soAckEmail(q, so));
      continue;
    }

    if (q.workState === 'pending_send') {
      // Quote not out yet — the enquiry thread plus the clarifications that came
      // in behind it. The RFQ itself is raised by "Review & Send Email".
      list.push(...clarificationEmails(q));
      continue;
    }

    // Quoted, no order yet (including the revision queue): RFQ + quotation sent.
    list.push(rfqEmail(q, true), quoteSentEmail(q));
  }

  return list;
}

export const INQUIRY_THREAD_EMAILS: InboxEmail[] = build();
