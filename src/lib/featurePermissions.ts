import type { FeaturePermissions, InboxPermissions, PermissionMatrix, Role } from '@/types';
import { makeMatrix } from './permissions';

// ---------------------------------------------------------------------------
// Granular permission model — the single source of truth edited in the
// EMPLOYEE MASTER permission matrix.
//
// Groups → sections (rows) → only the ACTIONS (columns) that are meaningful for
// each section. The seven generic actions mirror the client's matrix spec:
//   View · Add/Create · Edit · Delete · Download · Approve · Send/Submit
//
// The legacy coarse PermissionMatrix / InboxPermissions the rest of the app
// gates on (sidebar, routes, action buttons) are DERIVED from this model (see
// deriveLegacyPermissions / deriveInbox) so no page has to change.
//
// Office assignment (Sales Office Master) is a SEPARATE data-scope concern and
// never touches these permissions.
// ---------------------------------------------------------------------------

export type FpAction = 'view' | 'create' | 'edit' | 'delete' | 'download' | 'approve' | 'send';

// Fixed column order for the matrix.
export const FP_ACTIONS: FpAction[] = ['view', 'create', 'edit', 'delete', 'download', 'approve', 'send'];

export const FP_ACTION_LABELS: Record<string, string> = {
  view: 'View',
  create: 'Add / Create',
  edit: 'Edit',
  delete: 'Delete',
  download: 'Download',
  approve: 'Approve',
  send: 'Send / Submit',
};

export interface SectionConfig {
  key: string;
  label: string;
  actions: FpAction[];
}
export interface GroupConfig {
  key: string;
  label: string;
  sections: SectionConfig[];
}

export const PERMISSION_GROUPS: GroupConfig[] = [
  {
    key: 'general',
    label: 'General',
    sections: [
      { key: 'dashboard', label: 'Dashboard', actions: ['view'] },
      { key: 'global_inbox', label: 'Global Inbox', actions: ['view', 'edit', 'approve', 'send'] },
    ],
  },
  {
    key: 'masters',
    label: 'Masters',
    sections: [
      { key: 'item_master', label: 'Item Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
      { key: 'party_master', label: 'Party Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
      { key: 'employee_master', label: 'Employee Master', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'office_master', label: 'Sales Office Master', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'hsn_master', label: 'HSN Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
      { key: 'tc_master', label: 'T&C Master', actions: ['view', 'create', 'edit', 'delete', 'download'] },
    ],
  },
  {
    key: 'quotations',
    label: 'Sales Quotations',
    sections: [
      { key: 'quotes_pending', label: 'Quotes Pending to be Sent', actions: ['view', 'edit', 'download', 'send'] },
      { key: 'quotes_revision', label: 'Quotes Needing Revision', actions: ['view', 'edit', 'download', 'send'] },
      { key: 'quotes_list', label: 'List of Quotations', actions: ['view', 'edit', 'download'] },
    ],
  },
  {
    key: 'sales_orders',
    label: 'Sales Orders',
    sections: [
      { key: 'po_verification', label: 'PO vs Quote Verification', actions: ['view', 'edit', 'send'] },
      { key: 'so_list', label: 'List of Sales Orders', actions: ['view', 'download'] },
      { key: 'so_revision', label: 'Sales Order Revision', actions: ['view', 'edit', 'approve', 'send'] },
      { key: 'so_create', label: 'Create SO Manually', actions: ['view', 'create', 'send'] },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    sections: [{ key: 'erp_handoff', label: 'ERP Handoff', actions: ['view', 'edit', 'download'] }],
  },
  {
    key: 'management',
    label: 'Management',
    sections: [{ key: 'mis_reports', label: 'MIS Reports', actions: ['view', 'download'] }],
  },
];

export const ALL_SECTIONS: SectionConfig[] = PERMISSION_GROUPS.flatMap((g) => g.sections);
const SECTION_BY_KEY: Record<string, SectionConfig> = Object.fromEntries(ALL_SECTIONS.map((s) => [s.key, s]));

// Whether a given action column applies to a section (renders a checkbox).
export function sectionHasAction(sectionKey: string, action: string): boolean {
  return !!SECTION_BY_KEY[sectionKey]?.actions.includes(action as FpAction);
}

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

function fill(fp: FeaturePermissions, sectionKey: string, actions: FpAction[] | 'all') {
  const sec = SECTION_BY_KEY[sectionKey];
  for (const a of sec.actions) fp[sectionKey][a] = actions === 'all' ? true : actions.includes(a);
}

// Enforce view-gating: a section with View off cannot hold any other action.
// Idempotent — safe to run after every change.
export function applyDependencies(src: FeaturePermissions): FeaturePermissions {
  const fp = cloneFeature(src);
  for (const s of ALL_SECTIONS) {
    if (!fp[s.key].view) {
      for (const a of s.actions) if (a !== 'view') fp[s.key][a] = false;
    }
  }
  return fp;
}

// Is a control locked (and why)? Non-view actions require View first.
export function actionLock(
  fp: FeaturePermissions,
  sectionKey: string,
  action: string
): { disabled: boolean; reason?: string } {
  if (action !== 'view' && !fp[sectionKey]?.view) return { disabled: true, reason: 'Enable View first' };
  return { disabled: false };
}

// ---------- Default-role permission templates ----------
// One builder per default role (see data/roles.ts). These are the FACTORY
// defaults — the live, editable copy of each template is held on the
// RoleDefinition in app state, so Super Admin edits never mutate these.

// Super Admin — full access: every section, every action (manage employees,
// roles and permissions included).
export function templateSuperAdmin(): FeaturePermissions {
  const fp = emptyFeaturePermissions();
  for (const s of ALL_SECTIONS) fill(fp, s.key, 'all');
  return applyDependencies(fp);
}

// Office Head — assigned-office view, edit, approve and send.
export function templateOfficeHead(): FeaturePermissions {
  const fp = emptyFeaturePermissions();
  fill(fp, 'dashboard', ['view']);
  fill(fp, 'global_inbox', ['view', 'edit', 'approve', 'send']);
  // Read-only on masters; can assign employees to their office (office edit).
  ['item_master', 'party_master', 'hsn_master', 'tc_master'].forEach((k) => fill(fp, k, ['view']));
  fill(fp, 'employee_master', ['view']); // cannot manage employee permissions
  fill(fp, 'office_master', ['view', 'edit']);
  // Transactions for the assigned office.
  fill(fp, 'quotes_pending', ['view', 'edit', 'download', 'send']);
  fill(fp, 'quotes_revision', ['view', 'edit', 'download', 'send']);
  fill(fp, 'quotes_list', ['view', 'edit', 'download']);
  fill(fp, 'po_verification', ['view', 'edit', 'send']);
  fill(fp, 'so_list', ['view', 'download']);
  fill(fp, 'so_revision', ['view', 'edit', 'approve', 'send']);
  fill(fp, 'so_create', ['view', 'create', 'send']);
  fill(fp, 'erp_handoff', ['view', 'edit', 'download']);
  fill(fp, 'mis_reports', ['view', 'download']);
  return applyDependencies(fp);
}

// Office Staff — assigned-office operational create/edit access (no approve,
// no send).
export function templateOfficeStaff(): FeaturePermissions {
  const fp = emptyFeaturePermissions();
  fill(fp, 'dashboard', ['view']);
  fill(fp, 'global_inbox', ['view', 'edit']);
  ['item_master', 'party_master', 'hsn_master', 'tc_master'].forEach((k) => fill(fp, k, ['view']));
  fill(fp, 'quotes_pending', ['view', 'edit', 'download']);
  fill(fp, 'quotes_revision', ['view', 'edit', 'download']);
  fill(fp, 'quotes_list', ['view', 'edit', 'download']);
  fill(fp, 'po_verification', ['view', 'edit']);
  fill(fp, 'so_list', ['view', 'download']);
  fill(fp, 'so_revision', ['view', 'edit']);
  fill(fp, 'so_create', ['view', 'create']);
  fill(fp, 'erp_handoff', ['view', 'edit']);
  return applyDependencies(fp);
}

// Sales Person — manage assigned inquiries and quotations.
export function templateSalesPerson(): FeaturePermissions {
  const fp = emptyFeaturePermissions();
  fill(fp, 'dashboard', ['view']);
  fill(fp, 'global_inbox', ['view', 'edit']); // triage/classify/extract/draft
  ['item_master', 'party_master', 'hsn_master', 'tc_master'].forEach((k) => fill(fp, k, ['view']));
  fill(fp, 'quotes_pending', ['view', 'edit', 'download', 'send']);
  fill(fp, 'quotes_revision', ['view', 'edit', 'download', 'send']);
  fill(fp, 'quotes_list', ['view', 'edit', 'download']);
  fill(fp, 'po_verification', ['view', 'edit']);
  fill(fp, 'so_list', ['view']);
  return applyDependencies(fp);
}

// Sales Executive — limited assigned sales-record create/edit access.
export function templateSalesExecutive(): FeaturePermissions {
  const fp = emptyFeaturePermissions();
  fill(fp, 'dashboard', ['view']);
  fill(fp, 'global_inbox', ['view', 'edit']);
  ['item_master', 'party_master', 'hsn_master', 'tc_master'].forEach((k) => fill(fp, k, ['view']));
  fill(fp, 'quotes_pending', ['view', 'edit']);
  fill(fp, 'quotes_list', ['view']);
  fill(fp, 'so_list', ['view']);
  fill(fp, 'so_create', ['view', 'create']);
  return applyDependencies(fp);
}

// Management Viewer — read-only dashboards + MIS (seeded CUSTOM role).
export function templateManagementViewer(): FeaturePermissions {
  const fp = emptyFeaturePermissions();
  fill(fp, 'dashboard', ['view']);
  ['item_master', 'party_master', 'employee_master', 'office_master', 'hsn_master', 'tc_master'].forEach((k) =>
    fill(fp, k, ['view'])
  );
  fill(fp, 'quotes_pending', ['view']);
  fill(fp, 'quotes_revision', ['view']);
  fill(fp, 'quotes_list', ['view', 'download']);
  fill(fp, 'po_verification', ['view']);
  fill(fp, 'so_list', ['view', 'download']);
  fill(fp, 'so_revision', ['view']);
  fill(fp, 'erp_handoff', ['view', 'download']);
  fill(fp, 'mis_reports', ['view', 'download']);
  return applyDependencies(fp);
}

// Legacy adapter — maps the coarse Role archetype to the closest default
// template. Only used as a fallback where no RoleDefinition is at hand.
export function makeFeaturePermissions(role: Role): FeaturePermissions {
  if (role === 'super_admin') return templateSuperAdmin();
  if (role === 'office_admin') return templateOfficeHead();
  if (role === 'management_viewer') return templateManagementViewer();
  return templateSalesPerson();
}

// Deep equality vs a role's defaults — used to warn before a role change or save
// discards / diverges from the preset.
export function equalsFeature(a: FeaturePermissions, b: FeaturePermissions): boolean {
  for (const s of ALL_SECTIONS) {
    for (const act of s.actions) {
      if (!!a[s.key]?.[act] !== !!b[s.key]?.[act]) return false;
    }
  }
  return true;
}

// Does an employee's working matrix differ from their role's default template?
export function hasCustomOverrides(fp: FeaturePermissions, template: FeaturePermissions): boolean {
  return !equalsFeature(fp, template);
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

  m.dashboard.view = !!fp.dashboard?.view;

  // Masters with full CRUD + download.
  for (const k of ['item_master', 'party_master', 'hsn_master', 'tc_master'] as const) {
    m[k].view = !!fp[k].view;
    m[k].create = !!fp[k].create;
    m[k].edit = !!fp[k].edit;
    m[k].delete = !!fp[k].delete;
    m[k].download = !!fp[k].download;
  }

  // Employee Master + Sales Office Master (no download action in the model).
  for (const k of ['employee_master', 'office_master'] as const) {
    m[k].view = !!fp[k].view;
    m[k].create = !!fp[k].create;
    m[k].edit = !!fp[k].edit;
    m[k].delete = !!fp[k].delete;
    m[k].download = false;
  }

  const qsec = ['quotes_pending', 'quotes_revision', 'quotes_list'];
  m.quotations.view = anyView(qsec);
  m.quotations.edit = any(qsec, 'edit');
  m.quotations.download = any(qsec, 'download');
  m.quotations.create = false;
  m.quotations.delete = false;

  const ssec = ['po_verification', 'so_list', 'so_revision', 'so_create'];
  m.sales_orders.view = anyView(ssec);
  m.sales_orders.edit = any(['po_verification', 'so_revision'], 'edit') || !!fp.so_create?.send;
  m.sales_orders.create = !!fp.so_create?.create;
  m.sales_orders.download = any(ssec, 'download');
  m.sales_orders.delete = false;

  // ERP Handoff — Edit maps to "Handover to ERP".
  m.erp_handoff.view = !!fp.erp_handoff?.view;
  m.erp_handoff.download = !!fp.erp_handoff?.download;
  m.erp_handoff.edit = !!fp.erp_handoff?.edit;
  m.erp_handoff.create = false;
  m.erp_handoff.delete = false;

  // MIS Reports — placeholder module (view + download only).
  m.mis_reports.view = !!fp.mis_reports?.view;
  m.mis_reports.download = !!fp.mis_reports?.download;
  m.mis_reports.create = false;
  m.mis_reports.edit = false;
  m.mis_reports.delete = false;

  return m;
}

export function deriveInbox(fp: FeaturePermissions): InboxPermissions {
  const g = fp.global_inbox ?? {};
  return {
    view: !!g.view,
    // "Edit" covers the working actions on an email.
    classify: !!g.edit,
    edit_extraction: !!g.edit,
    draft_reply: !!g.edit,
    approve: !!g.approve,
    send: !!g.send,
    reassign: !!g.approve,
  };
}
