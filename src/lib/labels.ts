import type {
  ActionKey,
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

export const QUOTATION_STATUS: Record<QuotationStatus, { label: string; tone: BadgeTone }> = {
  open: { label: 'Open', tone: 'blue' },
  closed: { label: 'Closed', tone: 'slate' },
  received: { label: 'Received', tone: 'green' },
};

export const QUOTATION_STAGE: Record<QuotationStage, { label: string; tone: BadgeTone }> = {
  no_followup: { label: 'No Follow-up', tone: 'gray' },
  budgetary: { label: 'Budgetary', tone: 'teal' },
  negotiation: { label: 'Negotiation', tone: 'amber' },
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
