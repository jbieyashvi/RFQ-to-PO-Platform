import type { RoleDefinition } from '@/types';
import {
  templateSuperAdmin,
  templateOfficeHead,
  templateOfficeStaff,
  templateSalesPerson,
  templateSalesExecutive,
  templateManagementViewer,
} from '@/lib/featurePermissions';

// ---------------------------------------------------------------------------
// Role register — the seed for Employee Master → Manage Roles.
//
// Two CATEGORIES: Admin and Stakeholder. 'Stakeholder' groups the operational
// default roles and is never itself selectable as a role. The five system
// defaults below carry the client-specified permission templates; Super Admin
// can copy/rename them, create custom roles, and edit the templates in place.
// The system Super Admin role can never be deleted, and the last active Super
// Admin employee can never be deactivated.
// ---------------------------------------------------------------------------

export const SUPER_ADMIN_ROLE_ID = 'role-super-admin';

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: SUPER_ADMIN_ROLE_ID,
    name: 'Super Admin',
    category: 'admin',
    system: true,
    baseRole: 'super_admin',
    description: 'Full access across all offices — manage employees, roles and permissions.',
    featurePermissions: templateSuperAdmin(),
  },
  {
    id: 'role-office-head',
    name: 'Office Head',
    category: 'stakeholder',
    system: true,
    baseRole: 'office_admin',
    description: 'Assigned-office view, edit, approve and send.',
    featurePermissions: templateOfficeHead(),
  },
  {
    id: 'role-office-staff',
    name: 'Office Staff',
    category: 'stakeholder',
    system: true,
    baseRole: 'sales_user',
    description: 'Assigned-office operational create/edit access — no approve or send.',
    featurePermissions: templateOfficeStaff(),
  },
  {
    id: 'role-sales-person',
    name: 'Sales Person',
    category: 'stakeholder',
    system: true,
    baseRole: 'sales_user',
    description: 'Manage assigned inquiries and quotations.',
    featurePermissions: templateSalesPerson(),
  },
  {
    id: 'role-sales-executive',
    name: 'Sales Executive',
    category: 'stakeholder',
    system: true,
    baseRole: 'sales_user',
    description: 'Limited assigned sales-record create/edit access.',
    featurePermissions: templateSalesExecutive(),
  },
  // Seeded CUSTOM role — demonstrates a Super-Admin-created role living
  // alongside the system defaults.
  {
    id: 'role-management-viewer',
    name: 'Management Viewer',
    category: 'stakeholder',
    system: false,
    baseRole: 'management_viewer',
    description: 'Custom role — read-only dashboards, lists and MIS reports.',
    featurePermissions: templateManagementViewer(),
  },
];

export const ROLE_BY_ID: Record<string, RoleDefinition> = Object.fromEntries(
  ROLE_DEFINITIONS.map((r) => [r.id, r])
);
