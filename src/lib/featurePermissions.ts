import type { FeaturePermissions, InboxPermissions, PermissionMatrix, Role } from '@/types';
import { makeMatrix } from './permissions';

// ---------------------------------------------------------------------------
// Granular permission model for Sales Office Master.
//
// Groups → sub-sections → only the ACTIONS that are meaningful for each
// sub-section. This is the single source of truth edited in the user modal;
// the legacy coarse PermissionMatrix / InboxPermissions are derived from it
// (see deriveLegacyPermissions / deriveInbox) so existing sidebar, route and
// action-button gating continues to work without touching every page.
// ---------------------------------------------------------------------------

export interface SectionConfig {
  key: string;
  label: string;
  actions: string[];
}
export interface GroupConfig {
  key: string;
  label: string;
  sections: SectionConfig[];
}

export const FP_ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  download: 'Download',
  // Sales Office Master
  create_office: 'Create Office',
  edit_office: 'Edit Office',
  toggle_active: 'Activate/Deactivate Office',
  manage_users: 'Manage Users',
  manage_permissions: 'Manage Permissions',
  // Quotations
  review: 'Review',
  send: 'Send',
  upload_revision: 'Upload Revision',
  change_status: 'Change Status',
  change_review_date: 'Change Review Date',
  // PO vs Quote Verification
  compare: 'Compare',
  request_corrected_po: 'Request Corrected PO',
  open_latest_quote: 'Open Latest Quote',
  send_email: 'Send Email',
  continue_to_so: 'Continue to SO Generation',
  // Sales Order Revision
  approve_revision: 'Approve Revision',
  return_to_draft: 'Return to Draft',
  // Create SO Manually
  submit_erp: 'Submit to ERP Handoff',
  // Global Inbox
  classify: 'Classify',
  edit_extraction: 'Edit Extraction',
  draft_reply: 'Draft Reply',
  approve: 'Approve',
  reassign: 'Reassign',
  download_attachment: 'Download Attachment',
  // ERP Handoff
  handover: 'Handover to ERP',
};

export const PERMISSION_GROUPS: GroupConfig[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    sections: [
      { key: 'dash_pipeline', label: 'Pipeline Funnel', actions: ['view'] },
      { key: 'dash_conversion', label: 'Conversion Funnel', actions: ['view'] },
      { key: 'dash_action_required', label: 'Action Required', actions: ['view'] },
      { key: 'dash_overdue', label: 'Overdue Tasks', actions: ['view'] },
    ],
  },
  {
    key: 'masters',
    label: 'Masters',
    sections: [
      { key: 'item_master', label: 'Item Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
      { key: 'party_master', label: 'Party Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
      {
        key: 'office_master',
        label: 'Sales Office Master',
        actions: ['view', 'create_office', 'edit_office', 'toggle_active', 'manage_users', 'manage_permissions'],
      },
      { key: 'hsn_master', label: 'HSN Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
      { key: 'tc_master', label: 'T&C Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
    ],
  },
  {
    key: 'quotations',
    label: 'Sales Quotations',
    sections: [
      { key: 'quotes_pending', label: 'Quotes Pending to be Sent', actions: ['view', 'edit', 'review', 'send', 'download'] },
      {
        key: 'quotes_revision',
        label: 'Quotes Needing Revision',
        actions: ['view', 'edit', 'upload_revision', 'review', 'send', 'download'],
      },
      {
        key: 'quotes_list',
        label: 'List of Quotations',
        actions: ['view', 'edit', 'change_status', 'change_review_date', 'download'],
      },
    ],
  },
  {
    key: 'sales_orders',
    label: 'Sales Orders',
    sections: [
      {
        key: 'po_verification',
        label: 'PO vs Quote Verification',
        actions: ['view', 'compare', 'request_corrected_po', 'open_latest_quote', 'send_email', 'continue_to_so'],
      },
      { key: 'so_list', label: 'List of Sales Orders', actions: ['view', 'download'] },
      {
        key: 'so_revision',
        label: 'Sales Order Revision',
        actions: ['view', 'edit', 'approve_revision', 'return_to_draft', 'download'],
      },
      { key: 'so_create', label: 'Create SO Manually', actions: ['view', 'create', 'submit_erp', 'download'] },
    ],
  },
  {
    key: 'global_inbox',
    label: 'Global Inbox',
    sections: [
      {
        key: 'global_inbox',
        label: 'Global Inbox',
        actions: ['view', 'classify', 'edit_extraction', 'draft_reply', 'approve', 'send', 'reassign', 'download_attachment'],
      },
    ],
  },
  {
    key: 'erp_handoff',
    label: 'ERP Handoff',
    sections: [{ key: 'erp_handoff', label: 'ERP Handoff', actions: ['view', 'download', 'handover'] }],
  },
];

export const ALL_SECTIONS: SectionConfig[] = PERMISSION_GROUPS.flatMap((g) => g.sections);
const SECTION_BY_KEY: Record<string, SectionConfig> = Object.fromEntries(ALL_SECTIONS.map((s) => [s.key, s]));

// ---------- Dependency rules ----------
interface Dependency {
  section: string;
  action: string;
  requires: { section: string; action: string }[];
  reason: string;
}

const DEPENDENCIES: Dependency[] = [
  {
    section: 'po_verification',
    action: 'continue_to_so',
    requires: [
      { section: 'po_verification', action: 'view' },
      { section: 'po_verification', action: 'compare' },
    ],
    reason: 'Requires View and Compare',
  },
  {
    section: 'office_master',
    action: 'manage_permissions',
    requires: [
      { section: 'office_master', action: 'view' },
      { section: 'office_master', action: 'manage_users' },
    ],
    reason: 'Requires View and Manage Users',
  },
  {
    section: 'global_inbox',
    action: 'send',
    requires: [
      { section: 'global_inbox', action: 'view' },
      { section: 'global_inbox', action: 'approve' },
    ],
    reason: 'Requires Approve',
  },
];

// ---------- Construction helpers ----------
export function emptyFeaturePermissions(): FeaturePermissions {
  const fp: FeaturePermissions = {};
  for (const s of ALL_SECTIONS) {
    fp[s.key] = {};
    for (const a of s.actions) fp[s.key][a] = false;
  }
  return fp;
}

export function cloneFeature(src: FeaturePermissions): FeaturePermissions {
  const fp: FeaturePermissions = {};
  for (const s of ALL_SECTIONS) fp[s.key] = { ...(src[s.key] ?? {}) };
  return fp;
}

function fill(fp: FeaturePermissions, sectionKey: string, actions: string[] | 'all') {
  const sec = SECTION_BY_KEY[sectionKey];
  for (const a of sec.actions) fp[sectionKey][a] = actions === 'all' ? true : actions.includes(a);
}

// Enforce all dependency + view-gating rules. Idempotent — safe to run after
// every change.
export function applyDependencies(src: FeaturePermissions): FeaturePermissions {
  const fp = cloneFeature(src);
  // 1. If a sub-section's View is off, every other action in it is off.
  for (const s of ALL_SECTIONS) {
    if (!fp[s.key].view) {
      for (const a of s.actions) if (a !== 'view') fp[s.key][a] = false;
    }
  }
  // 2. Explicit cross-action dependencies.
  for (const d of DEPENDENCIES) {
    const ok = d.requires.every((r) => fp[r.section]?.[r.action]);
    if (!ok) fp[d.section][d.action] = false;
  }
  return fp;
}

// Is a control locked (and why)? Drives the disabled state + inline reason.
export function actionLock(
  fp: FeaturePermissions,
  sectionKey: string,
  action: string
): { disabled: boolean; reason?: string } {
  if (action !== 'view' && !fp[sectionKey].view) return { disabled: true, reason: 'Enable View first' };
  const dep = DEPENDENCIES.find((d) => d.section === sectionKey && d.action === action);
  if (dep) {
    const ok = dep.requires.every((r) => fp[r.section]?.[r.action]);
    if (!ok) return { disabled: true, reason: dep.reason };
  }
  return { disabled: false };
}

// ---------- Role default templates ----------
export function makeFeaturePermissions(role: Role): FeaturePermissions {
  const fp = emptyFeaturePermissions();

  if (role === 'super_admin') {
    for (const s of ALL_SECTIONS) fill(fp, s.key, 'all');
    return applyDependencies(fp);
  }

  // Both Office Admin and Sales User can view all four Dashboard sections.
  ['dash_pipeline', 'dash_conversion', 'dash_action_required', 'dash_overdue'].forEach((k) => fill(fp, k, ['view']));

  if (role === 'office_admin') {
    ['item_master', 'party_master', 'hsn_master', 'tc_master'].forEach((k) => fill(fp, k, ['view', 'create', 'edit']));
    fill(fp, 'office_master', ['view', 'edit_office', 'manage_users']);
    ['quotes_pending', 'quotes_revision', 'quotes_list'].forEach((k) => fill(fp, k, 'all'));
    ['po_verification', 'so_list', 'so_revision', 'so_create'].forEach((k) => fill(fp, k, 'all'));
    fill(fp, 'global_inbox', 'all');
    fill(fp, 'erp_handoff', 'all');
    return applyDependencies(fp);
  }

  // sales_user
  ['item_master', 'party_master', 'hsn_master', 'tc_master'].forEach((k) => fill(fp, k, ['view']));
  // Sales Office Master: no access (all false)
  fill(fp, 'quotes_pending', ['view', 'edit', 'review', 'download']);
  fill(fp, 'quotes_revision', ['view', 'edit', 'upload_revision', 'review', 'download']);
  fill(fp, 'quotes_list', ['view', 'edit', 'change_status', 'change_review_date', 'download']);
  fill(fp, 'po_verification', ['view', 'compare', 'request_corrected_po', 'open_latest_quote', 'send_email']);
  fill(fp, 'so_list', ['view', 'download']);
  fill(fp, 'so_revision', ['view', 'edit', 'download']);
  fill(fp, 'so_create', ['view', 'create']);
  fill(fp, 'global_inbox', ['view', 'classify', 'edit_extraction', 'draft_reply', 'download_attachment']);
  fill(fp, 'erp_handoff', ['view']);
  return applyDependencies(fp);
}

// Deep equality vs a role's defaults — used to warn before a role change
// discards custom overrides.
export function equalsFeature(a: FeaturePermissions, b: FeaturePermissions): boolean {
  for (const s of ALL_SECTIONS) {
    for (const act of s.actions) {
      if (!!a[s.key]?.[act] !== !!b[s.key]?.[act]) return false;
    }
  }
  return true;
}

export function hasCustomOverrides(fp: FeaturePermissions, role: Role): boolean {
  return !equalsFeature(fp, makeFeaturePermissions(role));
}

// ---------- Enabled-count helpers ----------
export function groupCounts(fp: FeaturePermissions, group: GroupConfig): { on: number; total: number } {
  let on = 0;
  let total = 0;
  for (const s of group.sections) {
    for (const a of s.actions) {
      total += 1;
      if (fp[s.key]?.[a]) on += 1;
    }
  }
  return { on, total };
}

// ---------- Derivation to the legacy coarse model ----------
export function deriveLegacyPermissions(fp: FeaturePermissions): PermissionMatrix {
  const m = makeMatrix(false);
  const anyView = (keys: string[]) => keys.some((k) => fp[k]?.view);
  const any = (keys: string[], action: string) => keys.some((k) => fp[k]?.[action]);

  m.dashboard.view = anyView(['dash_pipeline', 'dash_conversion', 'dash_action_required', 'dash_overdue']);

  for (const k of ['item_master', 'party_master', 'hsn_master', 'tc_master'] as const) {
    m[k].view = !!fp[k].view;
    m[k].create = !!fp[k].create;
    m[k].edit = !!fp[k].edit;
    m[k].delete = !!fp[k].delete;
    m[k].download = !!fp[k].download;
  }

  m.office_master.view = !!fp.office_master.view;
  m.office_master.create = !!fp.office_master.create_office;
  m.office_master.edit = !!(fp.office_master.edit_office || fp.office_master.manage_users);
  m.office_master.delete = false;
  m.office_master.download = false;

  const qsec = ['quotes_pending', 'quotes_revision', 'quotes_list'];
  m.quotations.view = anyView(qsec);
  m.quotations.edit = any(qsec, 'edit');
  m.quotations.download = any(qsec, 'download');
  m.quotations.create = false;
  m.quotations.delete = false;

  const ssec = ['po_verification', 'so_list', 'so_revision', 'so_create'];
  m.sales_orders.view = anyView(ssec);
  m.sales_orders.edit = !!(fp.so_revision.edit || fp.po_verification.continue_to_so || fp.so_create.submit_erp);
  m.sales_orders.create = !!fp.so_create.create;
  m.sales_orders.download = any(ssec, 'download');
  m.sales_orders.delete = false;

  // ERP Handoff — its own top-level module. "Handover to ERP" maps to the coarse
  // `edit` action so can('erp_handoff','edit') gates the handover control.
  m.erp_handoff.view = !!fp.erp_handoff?.view;
  m.erp_handoff.download = !!fp.erp_handoff?.download;
  m.erp_handoff.edit = !!fp.erp_handoff?.handover;
  m.erp_handoff.create = false;
  m.erp_handoff.delete = false;

  return m;
}

export function deriveInbox(fp: FeaturePermissions): InboxPermissions {
  const g = fp.global_inbox;
  return {
    view: !!g.view,
    classify: !!g.classify,
    edit_extraction: !!g.edit_extraction,
    draft_reply: !!g.draft_reply,
    approve: !!g.approve,
    send: !!g.send,
    reassign: !!g.reassign,
    download_attachment: !!g.download_attachment,
  };
}
