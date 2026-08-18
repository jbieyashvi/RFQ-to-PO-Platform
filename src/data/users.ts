import type { Role, User } from '@/types';
import { makeFeaturePermissions, deriveLegacyPermissions, deriveInbox } from '@/lib/featurePermissions';

// Build a seed user whose coarse permissions / inbox permissions are derived
// from the granular role template — the single source of truth edited in
// Sales Office Master.
function seed(
  base: Omit<User, 'permissions' | 'inboxPermissions' | 'featurePermissions'> & { role: Role }
): User {
  const featurePermissions = makeFeaturePermissions(base.role);
  return {
    ...base,
    featurePermissions,
    permissions: deriveLegacyPermissions(featurePermissions),
    inboxPermissions: deriveInbox(featurePermissions),
  };
}

export const USERS: User[] = [
  seed({ id: 'usr-001', fullName: 'Aarav Mehta', email: 'aarav.mehta@nexustrade.in', phone: '+91 98200 41122', role: 'super_admin', officeId: 'off-mum', active: true }),
  seed({ id: 'usr-002', fullName: 'Priya Nair', email: 'priya.nair@nexustrade.in', phone: '+91 98200 55234', role: 'office_admin', officeId: 'off-mum', active: true }),
  seed({ id: 'usr-003', fullName: 'Rohan Deshpande', email: 'rohan.d@nexustrade.in', phone: '+91 99300 22110', role: 'sales_user', officeId: 'off-mum', active: true }),
  seed({ id: 'usr-004', fullName: 'Kavya Iyer', email: 'kavya.iyer@nexustrade.in', phone: '+91 99300 78451', role: 'sales_user', officeId: 'off-mum', active: false }),
  seed({ id: 'usr-005', fullName: 'Vikram Singh', email: 'vikram.singh@nexustrade.in', phone: '+91 98110 33445', role: 'office_admin', officeId: 'off-del', active: true }),
  seed({ id: 'usr-006', fullName: 'Neha Gupta', email: 'neha.gupta@nexustrade.in', phone: '+91 98110 90876', role: 'sales_user', officeId: 'off-del', active: true }),
  seed({ id: 'usr-007', fullName: 'Arjun Reddy', email: 'arjun.reddy@nexustrade.in', phone: '+91 96860 12321', role: 'office_admin', officeId: 'off-blr', active: true }),
  seed({ id: 'usr-008', fullName: 'Sneha Rao', email: 'sneha.rao@nexustrade.in', phone: '+91 96860 45654', role: 'sales_user', officeId: 'off-blr', active: true }),
  seed({ id: 'usr-009', fullName: 'Manish Patel', email: 'manish.patel@nexustrade.in', phone: '+91 97250 88990', role: 'office_admin', officeId: 'off-ahm', active: true }),
  seed({ id: 'usr-010', fullName: 'Divya Shah', email: 'divya.shah@nexustrade.in', phone: '+91 97250 11223', role: 'sales_user', officeId: 'off-ahm', active: true }),
  seed({ id: 'usr-011', fullName: 'Karthik Subramanian', email: 'karthik.s@nexustrade.in', phone: '+91 94440 65432', role: 'sales_user', officeId: 'off-che', active: false }),
];

export const OWNERS = USERS.map((u) => u.fullName);
