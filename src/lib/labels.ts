import type {
  ActionKey,
  EmailClassification,
  InboxAction,
  ModuleKey,
  QuotationStage,
  QuotationStatus,
  Role,
  SOStatus,
  TCDocument,
  VerificationStatus,
} from '@/types';

export type BadgeTone =
  | 'gray'
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'violet'
  | 'teal'
  | 'slate';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  office_admin: 'Office Admin',
  sales_user: 'Sales User',
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Dashboard',
  item_master: 'Item Master',
  party_master: 'Party Master',
  office_master: 'Sales Office Master',
  hsn_master: 'HSN Master',
  tc_master: 'T&C Master',
  quotations: 'Sales Quotations',
  sales_orders: 'Sales Orders',
};

export const ACTION_LABELS: Record<ActionKey, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  download: 'Download',
};

export const MODULE_ORDER: ModuleKey[] = [
  'dashboard',
  'item_master',
  'party_master',
  'office_master',
  'hsn_master',
  'tc_master',
  'quotations',
  'sales_orders',
];

export const ACTION_ORDER: ActionKey[] = ['view', 'create', 'edit', 'delete', 'download'];

// PM terminology: quotation status values are Open / Close / Receive.
// ("Receive" is the quotation status; "PO Received" on the dashboard is a
// separate customer-PO workflow KPI.) Internal keys are left unchanged so
// deep-links (?status=…), mock data, and filtering logic stay stable.
export const QUOTATION_STATUS: Record<QuotationStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'blue' },
  closed: { label: 'Close', tone: 'slate' },
  received: { label: 'Receive', tone: 'green' },
};

// Excel terminology: stages are No Follow-up / Budgetary / Negotiations / Finalised.
export const QUOTATION_STAGE: Record<QuotationStage, { label: string; tone: BadgeTone }> = {
  no_followup: { label: 'No Follow-up', tone: 'gray' },
  budgetary: { label: 'Budgetary', tone: 'teal' },
  negotiation: { label: 'Negotiations', tone: 'amber' },
  finalised: { label: 'Finalised', tone: 'violet' },
};

export const SO_STATUS: Record<SOStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'gray' },
  so_sent: { label: 'SO Sent', tone: 'blue' },
  revision_required: { label: 'Revision Required', tone: 'amber' },
  finalised: { label: 'Finalised', tone: 'green' },
};

export const VERIFICATION_STATUS: Record<
  VerificationStatus,
  { label: string; tone: BadgeTone }
> = {
  pending: { label: 'Pending Verification', tone: 'slate' },
  matched: { label: 'Matched', tone: 'teal' },
  mismatch: { label: 'Mismatch Found', tone: 'red' },
  corrected_awaited: { label: 'Corrected PO Awaited', tone: 'amber' },
  verified: { label: 'Verified', tone: 'green' },
};

export const TC_DOCUMENT: Record<TCDocument, string> = {
  quotation: 'Quotation',
  sales_order: 'Sales Order',
  both: 'Both',
};

// ---------- Global Inbox ----------
export const INBOX_CLASSIFICATION: Record<EmailClassification, { label: string; tone: BadgeTone }> = {
  inquiry: { label: 'Inquiry', tone: 'blue' },
  quotation_revision: { label: 'Quotation Revision', tone: 'amber' },
  purchase_order: { label: 'Purchase Order', tone: 'violet' },
  so_query: { label: 'Sales Order Query', tone: 'teal' },
  finance_other: { label: 'Finance / Other', tone: 'slate' },
  unclassified: { label: 'Unclassified', tone: 'gray' },
};

export const INBOX_ACTION_LABELS: Record<InboxAction, string> = {
  view: 'View',
  classify: 'Classify',
  edit_extraction: 'Edit Extraction',
  draft_reply: 'Draft Reply',
  approve: 'Approve',
  send: 'Send',
  reassign: 'Reassign',
  download_attachment: 'Download Attachment',
};

export const INBOX_ACTION_ORDER: InboxAction[] = [
  'view',
  'classify',
  'edit_extraction',
  'draft_reply',
  'approve',
  'send',
  'reassign',
  'download_attachment',
];

export const CONFIDENCE_META: Record<
  'high' | 'medium' | 'low' | 'missing',
  { label: string; tone: BadgeTone }
> = {
  high: { label: 'High', tone: 'green' },
  medium: { label: 'Medium', tone: 'amber' },
  low: { label: 'Low', tone: 'red' },
  missing: { label: 'Missing', tone: 'red' },
};

export const ITEM_CATEGORIES = [
  'Electrical',
  'Mechanical',
  'Instrumentation',
  'Hardware',
  'Consumables',
  'Safety',
  'Automation',
];

export const SECTORS = [
  'Manufacturing',
  'Pharmaceuticals',
  'Automotive',
  'Infrastructure',
  'Energy & Power',
  'FMCG',
  'Textiles',
  'Chemicals',
];

export const UNITS = ['Nos', 'Set', 'Mtr', 'Kg', 'Ltr', 'Box', 'Roll', 'Pack'];

export const TC_CATEGORIES = [
  'Payment',
  'Delivery',
  'Warranty',
  'Taxes',
  'General',
  'Cancellation',
];
