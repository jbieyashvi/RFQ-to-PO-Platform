import type { ActionKey, InboxAction, InboxPermissions, ModuleKey, PermissionMatrix, Role } from '@/types';
import { MODULE_ORDER, ACTION_ORDER, INBOX_ACTION_ORDER } from './labels';

export function makeMatrix(fill: boolean): PermissionMatrix {
  const m = {} as PermissionMatrix;
  for (const mod of MODULE_ORDER) {
    m[mod] = {} as Record<ActionKey, boolean>;
    for (const act of ACTION_ORDER) {
      m[mod][act] = fill;
    }
  }
  return m;
}

export function cloneMatrix(src: PermissionMatrix): PermissionMatrix {
  const m = {} as PermissionMatrix;
  for (const mod of MODULE_ORDER) {
    m[mod] = { ...src[mod] };
  }
  return m;
}

// Default permission templates per role
export function defaultPermissionsFor(role: Role): PermissionMatrix {
  if (role === 'super_admin') return makeMatrix(true);

  if (role === 'office_admin') {
    const m = makeMatrix(true);
    // office admin cannot manage the offices master or delete masters wholesale
    m.office_master = { view: true, create: false, edit: true, delete: false, download: true };
    m.item_master.delete = false;
    m.party_master.delete = false;
    m.hsn_master.delete = false;
    return m;
  }

  // sales_user
  const m = makeMatrix(false);
  const viewOnly: ModuleKey[] = ['dashboard', 'item_master', 'party_master', 'hsn_master', 'tc_master'];
  for (const mod of viewOnly) m[mod].view = true;
  m.quotations = { view: true, create: true, edit: true, delete: false, download: true };
  m.sales_orders = { view: true, create: true, edit: true, delete: false, download: true };
  return m;
}

export function can(
  perms: PermissionMatrix | undefined,
  module: ModuleKey,
  action: ActionKey
): boolean {
  if (!perms) return false;
  return !!perms[module]?.[action];
}

// ---------- Global Inbox permissions ----------
export function makeInbox(fill: boolean): InboxPermissions {
  const p = {} as InboxPermissions;
  for (const a of INBOX_ACTION_ORDER) p[a] = fill;
  return p;
}

export function cloneInbox(src: InboxPermissions): InboxPermissions {
  return { ...src };
}

export function defaultInboxPermissionsFor(role: Role): InboxPermissions {
  if (role === 'super_admin') return makeInbox(true);
  // Office Admin: full inbox control for the assigned office (approve/send granted)
  if (role === 'office_admin') return makeInbox(true);
  // Sales User: can triage, classify, edit extraction and draft — but NOT approve/send/reassign
  return {
    view: true,
    classify: true,
    edit_extraction: true,
    draft_reply: true,
    approve: false,
    send: false,
    reassign: false,
    download_attachment: true,
  };
}

export function canInboxDo(
  perms: InboxPermissions | undefined,
  action: InboxAction
): boolean {
  if (!perms) return false;
  return !!perms[action];
}
