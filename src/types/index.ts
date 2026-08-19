// ---------- Roles & Permissions ----------
export type Role = 'super_admin' | 'office_admin' | 'sales_user';

export type ModuleKey =
  | 'dashboard'
  | 'item_master'
  | 'party_master'
  | 'office_master'
  | 'hsn_master'
  | 'tc_master'
  | 'quotations'
  | 'sales_orders'
  | 'erp_handoff';

export type ActionKey = 'view' | 'create' | 'edit' | 'delete' | 'download';

export type PermissionMatrix = Record<ModuleKey, Record<ActionKey, boolean>>;

// Granular, sub-section-level permissions edited in Sales Office Master.
// Keyed by section key -> action key -> enabled. The coarse PermissionMatrix
// and InboxPermissions above are DERIVED from this on save so existing
// sidebar / route / action gating keeps working unchanged.
export type FeaturePermissions = Record<string, Record<string, boolean>>;

// ---------- Sales Office ----------
export interface SalesOffice {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  active: boolean;
}

// ---------- Users ----------
export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  officeId: string;
  active: boolean;
  permissions: PermissionMatrix;
  inboxPermissions: InboxPermissions;
  featurePermissions: FeaturePermissions;
}

// ---------- Masters ----------
export interface Item {
  id: string;
  code: string;
  name: string;
  category: string;
  hsnCode: string;
  unit: string;
  unitPrice: number;
  active: boolean;
}

export interface Party {
  id: string;
  code: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  billingAddress: string;
  shippingAddress: string;
  gstin: string;
  sector: string;
  officeId: string;
  active: boolean;
}

export interface Hsn {
  id: string;
  code: string;
  description: string;
  gstRate: number;
  active: boolean;
}

export type TCDocument = 'quotation' | 'sales_order' | 'both';

export interface TermCondition {
  id: string;
  title: string;
  category: string;
  description: string;
  applicableTo: TCDocument;
  isDefault: boolean;
  active: boolean;
}

// ---------- Commercial Terms (T&C Master) ----------
// Structured commercial defaults edited in T&C Master and used as the single
// source of truth for the Create SO → Commercial Terms section.
export interface DeliveryOption {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
}

// Four percentage buckets — must total exactly 100%.
export interface PaymentTerms {
  advance: number;
  beforeDispatch: number;
  creditDays: number;
  afterInstall: number;
}

export interface CommercialTerms {
  packingPct: number; // % of order value, 0–100
  warrantyYears: number; // > 0
  deliveryOptions: DeliveryOption[];
  payment: PaymentTerms;
}

// ---------- Quotations ----------
// Business status — NOT a send state.
export type QuotationStatus = 'open' | 'closed' | 'received';
export type QuotationStage =
  | 'no_followup'
  | 'budgetary'
  | 'negotiation'
  | 'finalised';
export type QuotationWorkState = 'pending_send' | 'needs_revision' | 'sent';

// Delivery / send lifecycle — tracked independently of Status and Stage.
export type QuotationDeliveryState =
  | 'not_sent'
  | 'draft_ready'
  | 'awaiting_approval'
  | 'sent'
  | 'sent_externally'
  | 'send_failed';

export interface LineItem {
  id: string;
  itemId: string;
  itemCode: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discountPct: number;
  taxPct: number;
}

export interface RevisionRecord {
  id: string;
  version: number;
  date: string;
  reason: string;
  by: string;
}

// A customer-requested change captured from the revision email and surfaced as
// an old → new comparison in the Quote Generator. `field`/`itemProposed` let the
// generator apply the proposed value to the editable line when applicable.
export type RequestedChangeType =
  | 'unit_price'
  | 'quantity'
  | 'delivery'
  | 'payment'
  | 'warranty'
  | 'catalogue_item'
  | 'add_item'
  | 'remove_item';

export interface RequestedChange {
  id: string;
  type: RequestedChangeType;
  label: string; // e.g. "Unit price — EM Flowmeter DN50"
  oldValue: string; // display string, e.g. "₹95,000"
  newValue: string; // display string, e.g. "₹86,000"
  itemId?: string; // links to a line item when the change is line-level
  field?: 'unitPrice' | 'quantity'; // which line field the proposal edits
  itemProposed?: number; // proposed numeric value for `field`
}

// An immutable point-in-time version of a quotation. The previous version is
// never overwritten — a revised quote is saved as a NEW version on send.
export interface QuoteVersion {
  id: string;
  label: string; // 'V1', 'V2'…
  version: number;
  createdAt: string; // ISO datetime
  by: string;
  value: number;
  items: LineItem[];
  note?: string;
  sent?: boolean;
  sentAt?: string;
}

export interface ActivityEvent {
  id: string;
  date: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface Quotation {
  id: string;
  number: string;
  partyId: string;
  customerName: string;
  customerCode: string;
  officeId: string;
  owner: string;
  status: QuotationStatus;
  stage: QuotationStage;
  workState: QuotationWorkState;
  deliveryState: QuotationDeliveryState;
  sentAt?: string;
  sentBy?: string;
  sendChannel?: string; // for externally-sent quotations
  sendNote?: string;
  sendFailureReason?: string;
  value: number;
  quoteDate: string;
  reviewDate: string;
  createdDate: string;
  lastUpdated: string;
  revisionReason?: string;
  revisionRequestedDate?: string;
  items: LineItem[];
  paymentTerms: string;
  deliveryTerms: string;
  warranty: string;
  packingCharges: number;
  revisions: RevisionRecord[];
  // Immutable version history — populated when a revised quote is sent so the
  // previous version is preserved (List of Quotations shows the latest).
  quoteVersions?: QuoteVersion[];
  activity: ActivityEvent[];
}

// ---------- Sales Orders ----------
export type SOStatus = 'draft' | 'so_sent' | 'revision_required' | 'finalised';

// Sales Order revision lifecycle — sub-workflow while an SO is being corrected.
export type RevisionState =
  | 'revision_required'
  | 'draft_in_progress'
  | 'awaiting_approval'
  | 'revision_approved'
  | 'revised_sent';

// The editable Sales Order fields captured as a comparable version.
export interface SORevisionSnapshot {
  items: LineItem[];
  paymentTerms: string;
  deliveryTerms: string;
  deliveryDate: string;
  billingAddress: string;
  shippingAddress: string;
}

// An immutable point-in-time version in the revision history.
export interface SORevisionVersion {
  id: string;
  label: string; // 'Original', 'Rev 1', 'Rev 2'…
  version: number; // 0 = original
  createdAt: string; // ISO datetime
  by: string;
  reason: string;
  notes?: string;
  snapshot: SORevisionSnapshot;
}
// PM-confirmed prototype statuses (see lib/labels VERIFICATION_STATUS):
//   pending            → Pending Comparison
//   mismatch           → Mismatch Found
//   corrected_awaited  → Updated PO Awaited
//   updated_quote_sent → Updated Quote Sent
//   pending_review     → Pending Review
//   verified           → Verified
// "Matched" is deliberately NOT a final state — an SO is only ever Verified once
// every required field is resolved.
export type VerificationStatus =
  | 'pending'
  | 'mismatch'
  | 'corrected_awaited'
  | 'updated_quote_sent'
  | 'pending_review'
  | 'verified';

// Per-field resolution state in the PO vs Quote comparison. A field counts as
// resolved (and lets Sales Order generation proceed) only when it originally
// matched automatically, or corrected PO/quotation data was received & accepted.
export type FieldResolution =
  | 'pending' // comparison not yet generated
  | 'matched' // auto-matched → resolved
  | 'mismatch' // needs a resolution path chosen
  | 'pending_review' // flagged for manual review
  | 'awaiting_po' // Request Updated PO sent to customer
  | 'awaiting_quote' // Updated Quote sent to customer
  | 'resolved'; // updated data received & accepted

export interface VerificationField {
  key: string;
  label: string;
  quoteValue: string;
  poValue: string;
  match: boolean; // original automatic comparison result
  resolution?: FieldResolution; // working state (defaults derived from `match`)
}

// ---------- ERP Handoff ----------
// A Sales Order enters the ERP Handoff queue when created via the manual flow.
// It starts Pending and becomes Handed Over once someone confirms it is ready
// for manufacturing / ERP processing. No real ERP is called — this records the
// operational handoff step only.
export type ErpHandoffState = 'pending' | 'handed_over';

export interface ErpHandoff {
  state: ErpHandoffState;
  submittedAt: string; // ISO datetime the SO was submitted to the handoff queue
  submittedBy: string;
  reference?: string; // ERP reference / handoff note captured on handover
  handedOverBy?: string;
  handedOverAt?: string; // ISO datetime
}

// How the customer PO reached us — drives the required proof on Create SO.
export type PoProofType = 'uploaded' | 'phone_call' | 'message';

export interface SalesOrder {
  id: string;
  number: string;
  poNumber: string;
  poDate: string;
  quotationId?: string;
  quotationNumber?: string;
  partyId: string;
  customerName: string;
  customerCode: string;
  officeId: string;
  owner: string;
  value: number;
  poValue: number;
  quoteValue: number;
  status: SOStatus;
  verificationStatus: VerificationStatus;
  receivedDate: string;
  createdDate: string;
  deliveryDate: string;
  billingAddress: string;
  shippingAddress: string;
  revisionReason?: string;
  revisionRequestedDate?: string;
  revisionRequestedBy?: string;
  // Revision workflow
  revisionState?: RevisionState;
  revisionNumber: number; // latest applied revision number (0 = original)
  revisionOwner?: string;
  // PO vs Quote verification — the review date manually set when an updated PO
  // or updated quote email is sent, and who/when the SO was finally verified.
  reviewDate?: string;
  verifiedBy?: string;
  verifiedAt?: string;
  soGenerated?: boolean;
  // Timestamp the latest sent Sales Order version was successfully dispatched.
  // For revised SOs this is the sent time of the latest sent revision. Undefined
  // until the order has actually been sent (drafts / revision-required).
  sentAt?: string;
  revisionNotes?: string;
  // Manufacturing-contact resolution — the simplified revision outcome. Set once
  // the manufacturing team is confirmed informed of the SO changes. Deliberately
  // minimal so a future "Send Revised SO" action can extend it without rework.
  mfgContact?: {
    contactPerson: string;
    notes?: string;
    confirmedBy: string;
    confirmedAt: string; // ISO datetime
  };
  // ERP Handoff — set once the SO is created via the manual flow and pushed to
  // the ERP Handoff queue. Absent for legacy / non-handoff sales orders.
  erpHandoff?: ErpHandoff;
  // Extended client details captured on manual creation (optional; older seed
  // records omit these). Billing/shipping addresses live above.
  customerPhone?: string;
  customerEmail?: string;
  pincode?: string;
  kindAttentionName?: string;
  kindAttentionEmail?: string;
  officeAdmin?: string;
  // Customer-PO provenance captured on manual creation.
  poProofType?: PoProofType;
  poProofNotes?: string;
  revisionDraft?: SORevisionSnapshot; // working edits before approval/send
  revisionPreviewed?: boolean;
  versions: SORevisionVersion[]; // [Original, Rev 1, …] — original never overwritten
  items: LineItem[];
  paymentTerms: string;
  deliveryTerms: string;
  warranty: string;
  packingCharges: number;
  internalNotes: { id: string; date: string; author: string; text: string }[];
  activity: ActivityEvent[];
  verificationFields: VerificationField[];
}

// ---------- Global Inbox ----------
export type EmailClassification =
  | 'inquiry'
  | 'quotation_revision'
  | 'purchase_order'
  | 'so_query'
  | 'finance_other'
  | 'unclassified';

export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing';

export type InboxAction =
  | 'view'
  | 'classify'
  | 'edit_extraction'
  | 'draft_reply'
  | 'approve'
  | 'send'
  | 'reassign';

export type InboxPermissions = Record<InboxAction, boolean>;

export interface ThreadMessage {
  id: string;
  from: string;
  date: string; // ISO datetime
  snippet: string;
}

export interface ExtractionField {
  key: string;
  label: string;
  value: string;
  confidence: FieldConfidence;
  required?: boolean;
  edited?: boolean;
}

export interface OutgoingDraft {
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
  relatedDoc?: string;
  amount?: number;
  aiGenerated: boolean;
}

export interface InboxEmail {
  id: string;
  senderName: string;
  senderEmail: string;
  recipient: string;
  cc: string[];
  subject: string;
  receivedAt: string; // ISO datetime
  body: string;
  thread: ThreadMessage[];
  classification: EmailClassification;
  aiConfidence: number; // 0–100 overall
  read: boolean;
  needsReview: boolean;
  officeId: string;
  owner: string;
  partyId?: string;
  customerName?: string;
  customerCode?: string;
  linkedQuotation?: string;
  linkedPO?: string;
  linkedSO?: string;
  quotationSendId?: string; // set when this is an outbound "Review & Send" for a quotation
  // PO vs Quote Verification (Verification list → Open). When set, the inbox
  // right panel renders the two-step verification workflow instead of the
  // generic composer. Holds the linked SalesOrder id.
  poVerifyId?: string;
  // Revision workflow (Quotes Needing Revision → Open). When set, the inbox
  // right panel renders the Quote Generator instead of the generic composer.
  revisionSendId?: string; // quotation id this revision targets
  inquiryNo?: string; // linked inquiry identifier shown in the centre panel
  queueLabel?: string; // e.g. "Quote Needs Revision"
  requestedChanges?: RequestedChange[]; // customer-requested old → new changes
  reviewDate?: string; // manually-set next review date on the linked record
  extraction: ExtractionField[];
  extractionConfirmed: boolean;
  validationFailed?: boolean; // commercial validation failed (e.g. PO vs quote mismatch)
  draft?: OutgoingDraft;
  draftSaved: boolean;
  sent: boolean;
  sentAt?: string;
}
