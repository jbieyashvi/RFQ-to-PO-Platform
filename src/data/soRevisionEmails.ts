import type { InboxEmail, Quotation } from '@/types';
import { buildRequestedChanges } from '@/lib/revisionQueue';
import { officeName } from '@/data/offices';
import { PARTIES } from '@/data/masters';
import { SALES_ORDERS } from './salesOrders';

// ---------------------------------------------------------------------------
// Sales Order Revision workflow.
//
// Every Sales Order that is in a revision sub-state maps to the actual client
// email/conversation that requested the change. The "Sales Order Revisions →
// Open" action deep-links to these seeded emails (?email=<id>), and each one
// carries `soRevisionId` so the Global Inbox renders the Sales Order Revision
// workspace in the right panel instead of the generic composer. Seeding (rather
// than lazily adding on Open) is what lets the selected email, SO number and
// revision context survive a full page reload of the deep link.
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
  return `sales.${city}@nexustrade.in`;
}

// Only Sales Orders in a revision sub-state appear in the revisions queue.
const REVISION_ORDERS = SALES_ORDERS.filter((so) => so.revisionState);

export const SO_REVISION_EMAILS: InboxEmail[] = REVISION_ORDERS.map((so, idx) => {
  const party = PARTIES.find((p) => p.id === so.partyId);
  const contact = party?.contactPerson ?? so.customerName.split(' ')[0];
  const contactFirst = contact.split(' ')[0];
  const domain = domainOf(so.customerName);
  const senderEmail = party?.email ?? `projects@${domain}`;
  // Deterministic requested changes derived from the SO's real line items.
  const requestedChanges = buildRequestedChanges(so as unknown as Quotation, idx);
  const changeLines = requestedChanges
    .map((c) => `  • ${c.label}: ${c.oldValue} → ${c.newValue}`)
    .join('\n');
  const reason = so.revisionReason ?? 'Change request against the confirmed Sales Order';

  return {
    id: `em-so-rev-${so.id}`,
    senderName: `${contact} — ${so.customerName}`,
    senderEmail,
    recipient: officeEmail(so.officeId),
    cc: [`purchase@${domain}`],
    subject: `Revision request — Sales Order ${so.number} (${so.poNumber})`,
    receivedAt: `${so.revisionRequestedDate ?? so.receivedDate}T10:15:00`,
    body: `Dear ${so.owner.split(' ')[0]},\n\nWe would like to request a revision to Sales Order ${so.number}, raised against our PO ${so.poNumber}${so.quotationNumber ? ` / quotation ${so.quotationNumber}` : ''}.\n\nReason: ${reason}\n\nRequested changes:\n${changeLines}\n\nKindly issue a revised Sales Order acknowledgement reflecting the above and confirm the updated schedule.\n\nRegards,\n${contactFirst}\n${so.customerName}`,
    thread: [
      {
        id: `th-so-rev-${so.id}-1`,
        from: senderEmail,
        date: `${so.revisionRequestedDate ?? so.receivedDate}T10:15:00`,
        snippet: `Revision request against Sales Order ${so.number}.`,
      },
    ],
    classification: 'so_query',
    aiConfidence: 88,
    read: false,
    needsReview: true,
    officeId: so.officeId,
    owner: so.revisionOwner ?? so.owner,
    partyId: so.partyId,
    customerName: so.customerName,
    customerCode: so.customerCode,
    linkedPO: so.poNumber,
    linkedQuotation: so.quotationNumber,
    linkedSO: so.number,
    soRevisionId: so.id,
    queueLabel: 'Sales Order Needs Revision',
    requestedChanges,
    reviewDate: so.reviewDate,
    extraction: [
      { key: 'customer', label: 'Customer', value: so.customerName, confidence: 'high', required: true },
      { key: 'soNumber', label: 'Sales Order Number', value: so.number, confidence: 'high', required: true },
      { key: 'poNumber', label: 'PO Number', value: so.poNumber, confidence: 'high', required: true },
      { key: 'reason', label: 'Revision Reason', value: reason, confidence: 'medium', required: false },
    ],
    extractionConfirmed: true,
    draftSaved: false,
    sent: false,
  };
});
