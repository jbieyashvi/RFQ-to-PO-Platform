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
  | 'sales_orders';

export type ActionKey = 'view' | 'create' | 'edit' | 'delete' | 'download';

export type PermissionMatrix = Record<ModuleKey, Record<ActionKey, boolean>>;

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

// ---------- Quotations ----------
export type QuotationStatus = 'open' | 'closed' | 'received';
export type QuotationStage =
  | 'no_followup'
  | 'budgetary'
  | 'negotiation'
  | 'finalised';
export type QuotationWorkState = 'pending_send' | 'needs_revision' | 'sent';

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

export interface ActivityEvent {
  id: string;
  date: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface Attachment {
  id: string;
  name: string;
  size: string;
  uploadedOn: string;
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
  attachments: Attachment[];
  revisions: RevisionRecord[];
  activity: ActivityEvent[];
}

// ---------- Sales Orders ----------
export type SOStatus = 'draft' | 'so_sent' | 'revision_required' | 'finalised';
export type VerificationStatus =
  | 'pending'
  | 'matched'
  | 'mismatch'
  | 'corrected_awaited'
  | 'verified';

export interface VerificationField {
  label: string;
  quoteValue: string;
  poValue: string;
  match: boolean;
}

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
  revisionReason?: string;
  revisionRequestedDate?: string;
  items: LineItem[];
  paymentTerms: string;
  deliveryTerms: string;
  warranty: string;
  packingCharges: number;
  internalNotes: { id: string; date: string; author: string; text: string }[];
  verificationFields: VerificationField[];
}
