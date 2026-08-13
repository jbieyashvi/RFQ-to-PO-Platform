import type { ActionKey, ModuleKey, PermissionMatrix, Role } from '@/types';
import { MODULE_ORDER, ACTION_ORDER } from './labels';

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
