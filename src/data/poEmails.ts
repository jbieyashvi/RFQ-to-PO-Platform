import type { InboxEmail } from '@/types';
import { unresolvedFields } from '@/lib/verification';
import { SALES_ORDERS } from './salesOrders';

// ---------------------------------------------------------------------------
// Every PO-verification record is linked to its originating Purchase Order email
// in the Global Inbox. The Verification list "Open" action deep-links to these
// emails (?email=<id>), and each one carries `poVerifyId` so the inbox right
// panel renders the two-step PO vs Quote workflow instead of the generic
// composer.
// ---------------------------------------------------------------------------

function domainOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|corp|company|and|&)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return `${slug || 'customer'}.com`;
}

export const PO_VERIFICATION_EMAILS: InboxEmail[] = SALES_ORDERS.map((so) => {
  const contact = so.customerName.split(' ')[0];
  const domain = domainOf(so.customerName);
  const unresolved = unresolvedFields(so.verificationFields).length;
  const verified = so.verificationStatus === 'verified';

  return {
    id: `em-po-${so.id}`,
    senderName: `${contact} Procurement`,
    senderEmail: `procurement@${domain}`,
    recipient: 'sales@flowtech-instruments.com',
    cc: [`accounts@${domain}`],
    subject: `Purchase Order ${so.poNumber} against ${so.quotationNumber ?? 'quotation'}`,
    receivedAt: `${so.receivedDate}T08:30:00`,
    body: `Dear ${so.owner.split(' ')[0]},\n\nThis is our Purchase Order ${so.poNumber}, issued against your quotation ${so.quotationNumber ?? ''}.\n\nKindly verify the order against the accepted quotation and confirm the delivery schedule.\n\nRegards,\n${contact} Procurement Team\n${so.customerName}`,
    thread: [],
    classification: 'purchase_order',
    aiConfidence: 90,
    read: true,
    needsReview: !verified,
    officeId: so.officeId,
    owner: so.owner,
    partyId: so.partyId,
    customerName: so.customerName,
    customerCode: so.customerCode,
    linkedPO: so.poNumber,
    linkedQuotation: so.quotationNumber,
    linkedSO: so.number,
    poVerifyId: so.id,
    validationFailed: unresolved > 0,
    reviewDate: so.reviewDate,
    extraction: [
      { key: 'customer', label: 'Customer', value: so.customerName, confidence: 'high', required: true },
      { key: 'poNumber', label: 'PO Number', value: so.poNumber, confidence: 'high', required: true },
      { key: 'quotation', label: 'Quotation Number', value: so.quotationNumber ?? '', confidence: 'high', required: true },
    ],
    extractionConfirmed: true,
    draftSaved: false,
    sent: false,
  };
});
