import type { User } from '@/types';
import { cloneFeature, deriveLegacyPermissions, deriveInbox } from '@/lib/featurePermissions';
import { ROLE_BY_ID } from './roles';

// Build a seed employee from an assigned role definition. The granular feature
// permissions start as the role's default template (the single source of truth
// edited in EMPLOYEE MASTER); the coarse permissions / inbox permissions are
// derived from it. Office assignment (officeId) is a separate data-scope
// concern managed in Sales Office Master and never changes these permissions.
//
// Login identity is the WORK EMAIL — there are no usernames or passwords.
function seed(
  base: Omit<User, 'permissions' | 'inboxPermissions' | 'featurePermissions' | 'role'> & {
    roleId: string;
  }
): User {
  const def = ROLE_BY_ID[base.roleId];
  const featurePermissions = cloneFeature(def.featurePermissions);
  return {
    ...base,
    role: def.baseRole,
    featurePermissions,
    permissions: deriveLegacyPermissions(featurePermissions),
    inboxPermissions: deriveInbox(featurePermissions),
  };
}

export const USERS: User[] = [
  seed({
    id: 'usr-001',
    employeeCode: 'EMP-0001',
    fullName: 'Aarav Mehta',
    email: 'aarav.mehta@flowtech-instruments.com',
    phone: '+91 98200 41122',
    department: 'Administration',
    designation: 'Platform Administrator',
    roleId: 'role-super-admin',
    officeId: 'off-mum',
    assignmentDate: '2023-04-01',
    active: true,
  }),
  seed({
    id: 'usr-002',
    employeeCode: 'EMP-0002',
    fullName: 'Priya Nair',
    email: 'priya.nair@flowtech-instruments.com',
    phone: '+91 98200 55234',
    department: 'Sales',
    designation: 'Office Manager',
    reportingManager: 'usr-001',
    roleId: 'role-office-head',
    officeId: 'off-mum',
    assignmentDate: '2023-05-15',
    active: true,
  }),
  seed({
    id: 'usr-003',
    employeeCode: 'EMP-0003',
    fullName: 'Rohan Deshpande',
    email: 'rohan.d@flowtech-instruments.com',
    phone: '+91 99300 22110',
    department: 'Sales',
    designation: 'Sales Executive',
    reportingManager: 'usr-002',
    roleId: 'role-sales-person',
    officeId: 'off-mum',
    assignmentDate: '2023-06-01',
    active: true,
  }),
  seed({
    id: 'usr-004',
    employeeCode: 'EMP-0004',
    fullName: 'Kavya Iyer',
    email: 'kavya.iyer@flowtech-instruments.com',
    phone: '+91 99300 78451',
    department: 'Sales',
    designation: 'Sales Executive',
    reportingManager: 'usr-002',
    roleId: 'role-sales-executive',
    officeId: 'off-mum',
    assignmentDate: '2023-07-20',
    active: false,
  }),
  seed({
    id: 'usr-005',
    employeeCode: 'EMP-0005',
    fullName: 'Vikram Singh',
    email: 'vikram.singh@flowtech-instruments.com',
    phone: '+91 98110 33445',
    department: 'Sales',
    designation: 'Office Manager',
    reportingManager: 'usr-001',
    roleId: 'role-office-head',
    officeId: 'off-del',
    assignmentDate: '2023-05-18',
    active: true,
  }),
  seed({
    id: 'usr-006',
    employeeCode: 'EMP-0006',
    fullName: 'Neha Gupta',
    email: 'neha.gupta@flowtech-instruments.com',
    phone: '+91 98110 90876',
    department: 'Sales',
    designation: 'Sales Coordinator',
    reportingManager: 'usr-005',
    roleId: 'role-office-staff',
    officeId: 'off-del',
    assignmentDate: '2023-08-05',
    active: true,
  }),
  seed({
    id: 'usr-007',
    employeeCode: 'EMP-0007',
    fullName: 'Arjun Reddy',
    email: 'arjun.reddy@flowtech-instruments.com',
    phone: '+91 96860 12321',
    department: 'Sales',
    designation: 'Office Manager',
    reportingManager: 'usr-001',
    roleId: 'role-office-head',
    officeId: 'off-blr',
    assignmentDate: '2023-06-10',
    active: true,
  }),
  seed({
    id: 'usr-008',
    employeeCode: 'EMP-0008',
    fullName: 'Sneha Rao',
    email: 'sneha.rao@flowtech-instruments.com',
    phone: '+91 96860 45654',
    department: 'Sales',
    designation: 'Sales Executive',
    reportingManager: 'usr-007',
    roleId: 'role-sales-person',
    officeId: 'off-blr',
    assignmentDate: '2023-09-12',
    active: true,
  }),
  seed({
    id: 'usr-009',
    employeeCode: 'EMP-0009',
    fullName: 'Manish Patel',
    email: 'manish.patel@flowtech-instruments.com',
    phone: '+91 97250 88990',
    department: 'Sales',
    designation: 'Office Manager',
    reportingManager: 'usr-001',
    roleId: 'role-office-head',
    officeId: 'off-ahm',
    assignmentDate: '2023-07-01',
    active: true,
  }),
  seed({
    id: 'usr-010',
    employeeCode: 'EMP-0010',
    fullName: 'Divya Shah',
    email: 'divya.shah@flowtech-instruments.com',
    phone: '+91 97250 11223',
    department: 'Sales',
    designation: 'Sales Executive',
    reportingManager: 'usr-009',
    roleId: 'role-sales-executive',
    officeId: 'off-ahm',
    assignmentDate: '2023-10-03',
    active: true,
  }),
  seed({
    id: 'usr-011',
    employeeCode: 'EMP-0011',
    fullName: 'Karthik Subramanian',
    email: 'karthik.s@flowtech-instruments.com',
    phone: '+91 94440 65432',
    department: 'Sales',
    designation: 'Sales Executive',
    roleId: 'role-sales-executive',
    officeId: 'off-che',
    assignmentDate: '2023-11-15',
    active: false,
  }),
  // Management Viewer — seeded CUSTOM role, read-only dashboards + MIS, HQ (Mumbai).
  seed({
    id: 'usr-012',
    employeeCode: 'EMP-0012',
    fullName: 'Ananya Krishnan',
    email: 'ananya.krishnan@flowtech-instruments.com',
    phone: '+91 98200 77654',
    department: 'Management',
    designation: 'Business Analyst',
    reportingManager: 'usr-001',
    roleId: 'role-management-viewer',
    officeId: 'off-mum',
    assignmentDate: '2024-01-08',
    active: true,
  }),
  // Newly onboarded Sales Executive with NO office assignment yet — demonstrates
  // the "no office assigned" empty-state across office-scoped screens.
  seed({
    id: 'usr-013',
    employeeCode: 'EMP-0013',
    fullName: 'Rahul Verma',
    email: 'rahul.verma@flowtech-instruments.com',
    phone: '+91 90040 33221',
    department: 'Sales',
    designation: 'Sales Executive',
    reportingManager: 'usr-001',
    roleId: 'role-sales-executive',
    officeId: '',
    active: true,
  }),
];

export const OWNERS = USERS.map((u) => u.fullName);
