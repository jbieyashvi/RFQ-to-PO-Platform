// ---------- Roles & Permissions ----------
// Legacy scope archetype — drives office-visibility and approval gating across
// the app (super_admin sees all offices; office_admin can approve; the rest are
// office-scoped operators). Derived from the assigned RoleDefinition's baseRole,
// never edited directly.
export type Role = 'super_admin' | 'office_admin' | 'sales_user' | 'management_viewer';

// Role categories. 'Stakeholder' is a CATEGORY grouping the operational roles —
// it is never itself a selectable role.
export type RoleCategory = 'admin' | 'stakeholder';

// A managed role — the unit Super Admin creates, copies, renames and edits in
// Employee Master → Manage Roles. System roles are the seeded defaults; the
// system Super Admin role can never be deleted.
export interface RoleDefinition {
  id: string;
  name: string;
  category: RoleCategory;
  description: string;
  system: boolean; // seeded default role
  baseRole: Role; // legacy scope archetype (office visibility / approval gates)
  featurePermissions: FeaturePermissions; // the role's editable default template
  copiedFrom?: string; // role id this was copied from (custom roles)
}

export type ModuleKey =
  | 'dashboard'
  | 'item_master'
  | 'party_master'
  | 'employee_master'
  | 'office_master'
  | 'hsn_master'
  | 'tc_master'
  | 'quotations'
  | 'sales_orders'
  | 'erp_handoff'
  | 'mis_reports';

export type ActionKey = 'view' | 'create' | 'edit' | 'delete' | 'download';

export type PermissionMatrix = Record<ModuleKey, Record<ActionKey, boolean>>;

// Granular, section-level permissions edited in Employee Master (the single
// source of truth for what an employee can do). Keyed by section key -> action
// key -> enabled. The coarse PermissionMatrix and InboxPermissions are DERIVED
// from this on save so existing sidebar / route / action gating keeps working
// unchanged. Sales Office Master never edits these — it only assigns offices.
export type FeaturePermissions = Record<string, Record<string, boolean>>;

// ---------- Sales Office ----------
export interface SalesOffice {
  id: string;
  name: string;
  code: string;
  zone: string; // zone / region, e.g. "West Zone"
  address: string;
  city: string;
  state: string;
  phone: string; // office contact number
  email: string; // office contact email
  active: boolean;
}

// ---------- Users / Employees ----------
// A record of an office transfer, preserved so the employee's movement history
// is auditable in the prototype.
export interface TransferRecord {
  id: string;
  fromOfficeId: string;
  toOfficeId: string;
  date: string; // ISO date the transfer happened
  by: string; // who performed the transfer
}

export interface User {
  id: string;
  employeeCode: string; // unique Employee Code / User ID
  fullName: string;
  email: string; // WORK EMAIL — the unique login identity (no username/password)
  phone: string;
  department?: string;
  designation?: string;
  reportingManager?: string; // reporting manager's user id (optional)
  roleId: string; // assigned RoleDefinition id
  role: Role; // legacy scope archetype, derived from the role definition
  officeId: string; // '' when the employee has no office assigned
  assignmentDate?: string; // ISO date the current office was assigned
  transferHistory?: TransferRecord[];
  active: boolean;
  permissions: PermissionMatrix;
  inboxPermissions: InboxPermissions;
  featurePermissions: FeaturePermissions;
}

// ---------- Masters ----------
export interface TechnicalSpecs {
  make?: string;
  product?: string;
  model?: string;
  decodification?: string;
  operatingPressure?: string;
  operatingTemperature?: string;
  lineSize?: string;
  dimensions?: string;
  deliverySchedule?: string;
  expectedArrival?: string;
  documentsRequired?: string;
  mocConnection?: string;
  accessories?: string;
  otherDetails?: string;
}

export interface Item {
  id: string;
  code: string;
  name: string;
  category: string;
  hsnCode: string;
  unit: string;
  unitPrice: number;
  active: boolean;
  technicalSpecs?: TechnicalSpecs;
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
  // Optional Item Master name (distinct from the free-text description). Older
  // records omit it — the resolver falls back to the catalogue item / description.
  itemName?: string;
  // Per-item technical block and delivery schedule for the Sales Order
  // Acknowledgement. Both optional; the resolver synthesises/derives when absent
  // so every display surface has a complete block to show.
  technical?: ItemTechnical;
  schedule?: DeliveryScheduleRow[];
}

// A reusable label→value row (technical specs, documents required, accessories,
// other details). `id` is only needed while editing.
export interface SoKeyValue {
  id?: string;
  label: string;
  value: string;
}

// Per-item technical & specification block on the Sales Order Acknowledgement.
// Fixed optional attributes plus reusable key→value lists. Only non-empty
// fields are ever displayed. Defaults derive from the Item Master.
export interface ItemTechnical {
  make?: string;
  product?: string;
  service?: string; // service / application
  operatingPressure?: string;
  operatingTemperature?: string;
  density?: string;
  decodificationNo?: string;
  modelNo?: string;
  lineSize?: string;
  cToC?: string; // C-to-C height / dimensions
  wettedPartsMOC?: string;
  processConnectionType?: string;
  processConnectionMOC?: string;
  processConnectionStd?: string;
  cagingType?: string;
  cageMOC?: string;
  scaleMOC?: string;
  glandMOC?: string;
  floatType?: string; // float / flat type
  flangeType?: string;
  valveBodyMOC?: string;
  specs?: SoKeyValue[]; // reusable technical specification rows
  documents?: SoKeyValue[]; // documents required (drawing / datasheet / TPI …)
  accessories?: SoKeyValue[];
  otherDetails?: SoKeyValue[];
}

// One delivery-schedule row for an item. Pending = scheduled − already delivered
// (in the prototype we treat everything as pending).
export interface DeliveryScheduleRow {
  id: string;
  scheduleNo: number;
  deliveryDate?: string;
  expectedArrivalDate?: string;
  scheduledQty: number;
  pendingQty?: number;
}

// Structured buyer / consignee block. `name` is the M/S. display name. Older
// records only store the flat billing/shipping address strings — the resolver
// derives this block from the Party Master + those strings when absent.
export interface SoPartyDetails {
  name?: string;
  code?: string;
  address: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  phone?: string;
  email?: string;
  gstin?: string;
}

// Kind Attention contact captured on the Sales Order.
export interface SoContact {
  name?: string;
  phone?: string;
  email?: string;
}

// Salesperson block — derived from the Sales Office Master + owner when absent.
export interface SoSalesperson {
  name: string;
  phone?: string;
  email?: string;
  officeId: string;
  owner: string;
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
// A final, approved Sales Order enters the ERP Handoff queue when it is
// generated from Global Inbox or created via Create SO Manually. The single
// status is Submitted — every SO handed to the ERP stays permanently visible
// as Submitted. No real ERP is called — this records the operational handoff
// step only. A single record is kept per SO (approved revisions update it in
// place, never duplicate it).
export type ErpHandoffState = 'submitted';

// Which flow pushed the Sales Order into the ERP Handoff queue.
export type ErpHandoffSource = 'po_verification' | 'manual';

export interface ErpHandoff {
  state: ErpHandoffState;
  source: ErpHandoffSource; // Global Inbox generation vs Create SO Manually
  submittedAt: string; // ISO datetime the SO entered the ERP Handoff queue
  submittedBy: string;
  updatedAt: string; // ISO datetime of the latest change to this handoff record
  revisionNumber?: number; // SO revision reflected here (mirrors SalesOrder.revisionNumber)
  reference?: string; // ERP reference / handoff note
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
  // ISO datetime the customer PO email arrived — drives the system-generated
  // 24h PO vs Quote Verification SLA (due = poReceivedAt + 24h).
  poReceivedAt?: string;
  createdDate: string;
  deliveryDate: string;
  billingAddress: string;
  shippingAddress: string;
  revisionReason?: string;
  revisionRequestedDate?: string;
  // ISO datetime the revision request arrived — drives the system-generated
  // 24h Sales Order Revision SLA (due = revisionRequestedAt + 24h).
  revisionRequestedAt?: string;
  revisionRequestedBy?: string;
  // Revision workflow
  revisionState?: RevisionState;
  revisionNumber: number; // latest applied revision number (0 = original)
  revisionOwner?: string;
  // How a Sales Order revision REQUEST was dispositioned when the owner did not
  // issue a minor revised SO. 'no_revision' closes the request leaving the SO
  // unchanged; 'quote_revision' escalates to a quotation revision + updated-PO
  // cycle. Recorded for audit and to render a resolved state in the workspace.
  revisionResolution?: {
    kind: 'no_revision' | 'quote_revision';
    note?: string;
    by: string;
    at: string; // ISO datetime
  };
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
  // Structured commercial-terms snapshot captured at creation (optional; older
  // seed / PO-verified records store only the flattened `paymentTerms` string).
  // When present the View drawer renders exact per-bucket payment percentages.
  commercials?: {
    packingPct: number;
    payment: PaymentTerms;
    creditDays: number;
  };
  // ---- Shared Sales Order Acknowledgement structured sections (all optional
  // for backward compatibility; the resolver in lib/salesOrder derives these
  // from the flat fields + masters when absent, so every screen shows the same
  // complete document regardless of how the record was created). ----
  buyer?: SoPartyDetails;
  consignee?: SoPartyDetails;
  consigneeSameAsBuyer?: boolean;
  kindAttention?: SoContact;
  salesperson?: SoSalesperson;
  // Expanded commercial terms (beyond the flat paymentTerms/deliveryTerms).
  deliveryTimeline?: string;
  expectedDeliveryDate?: string;
  freight?: string;
  inspection?: string;
  additionalTerms?: string;
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

// The system-generated quotation PDF attached to an outgoing email in the
// focused quote-send workflow. Only the platform's own quotation PDF may be
// attached here — there is no generic file upload. `signature` captures the
// quote's sendable contents at attach time so a later edit is detectable as
// stale ("add the latest version before sending").
export interface QuoteAttachment {
  fileName: string; // e.g. "QTN-2026-1007.pdf"
  qtnNumber: string; // e.g. "QTN/2026/1007"
  fileType: string; // 'PDF'
  quoteValue: number;
  signature: string; // staleness signature of the quote at attach time
  addedBy: string;
  addedAt: string; // ISO datetime
  version?: string; // e.g. "V2 · Revised" / "Corrected" — shown on the chip
  sizeLabel?: string; // e.g. "146 KB" — friendly file size on the chip
  kind?: 'quotation' | 'revised' | 'corrected'; // which workflow generated it
}

// The system-generated Sales Order PDF attached to an outgoing email in the PO
// Verification → SO Generation workflow. Like QuoteAttachment, this is the
// platform's own generated document — there is no generic file upload. It is
// only ever created by "Add Sales Order to Email" once the SO has been
// generated, and carries the SO number/value shown on the composer chip.
export interface SalesOrderAttachment {
  fileName: string; // e.g. "SO-2026-0501.pdf"
  soNumber: string; // e.g. "SO/2026/0501"
  fileType: string; // 'PDF'
  value: number; // SO grand total at attach time
  addedBy: string;
  addedAt: string; // ISO datetime
  sizeLabel?: string; // e.g. "148 KB" — friendly file size on the chip
  // Set when this is a revised Sales Order Acknowledgement (SO Revision flow).
  // Drives the revision label shown on the composer chip.
  revisionNumber?: number; // e.g. 2 → "Revision 2"
  revisionLabel?: string; // e.g. "Rev 2 · Revised"
  kind?: 'sales_order' | 'revised'; // which workflow generated it
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
  // Sales Order Revision workflow (Sales Order Revisions → Open). When set, the
  // inbox right panel renders the Sales Order Revision workspace instead of the
  // generic composer. Holds the linked SalesOrder id being revised.
  soRevisionId?: string;
  // Inquiry bundling. `inquiryId` is the STABLE key of the inquiry this email
  // belongs to (the quotation behind the enquiry) — set explicitly on every
  // email that is part of an inquiry conversation, whatever thread it arrived
  // in. When absent it is derived from the workflow ids / document numbers (see
  // lib/inquiry.ts), so older records still group correctly.
  inquiryId?: string;
  inquiryNo?: string; // linked inquiry identifier shown in the centre panel
  queueLabel?: string; // e.g. "Quote Needs Revision"
  requestedChanges?: RequestedChange[]; // customer-requested old → new changes
  reviewDate?: string; // manually-set next review date on the linked record
  // Which right-panel workflow has PREPARED this email for the shared middle
  // composer. Set when a right-panel "Add … to Email" / "Request Updated PO"
  // action populates the composer; cleared once the email is sent / reset. For
  // PO verification it also distinguishes the two resolution paths.
  composeIntent?: 'revision' | 'po-request' | 'quote-correct' | 'so-send' | 'so-revise';
  // Focused quote-send workflow: the system-generated quotation PDF attached to
  // this outgoing email. Only ever set/cleared from the Quote Tools panel.
  attachedQuote?: QuoteAttachment;
  // PO Verification → SO Generation workflow: the system-generated Sales Order
  // PDF attached to this outgoing email. Only ever set/cleared from the SO
  // Generation panel's "Add Sales Order to Email" / "Remove" actions.
  attachedSalesOrder?: SalesOrderAttachment;
  extraction: ExtractionField[];
  extractionConfirmed: boolean;
  validationFailed?: boolean; // commercial validation failed (e.g. PO vs quote mismatch)
  draft?: OutgoingDraft;
  draftSaved: boolean;
  sent: boolean;
  sentAt?: string;
}
