import type { ModuleKey } from '@/types';
import {
  LayoutDashboard,
  Package,
  Building2,
  Landmark,
  FileText,
  ScrollText,
  FileSpreadsheet,
  ClipboardCheck,
  Inbox,
  ArrowLeftRight,
  type LucideIcon,
} from 'lucide-react';

export interface NavChild {
  label: string;
  to: string;
}

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  to?: string;
  module: ModuleKey | ModuleKey[]; // module(s) that gate visibility (view)
  children?: NavChild[];
  special?: 'inbox'; // gated on inbox permissions instead of the module matrix
}

export const NAV: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    to: '/dashboard',
    module: 'dashboard',
  },
  {
    key: 'global_inbox',
    label: 'Global Inbox',
    icon: Inbox,
    to: '/inbox',
    module: 'dashboard', // placeholder; visibility gated via inbox permissions
    special: 'inbox',
  },
  {
    key: 'master',
    label: 'Master',
    icon: Landmark,
    module: ['item_master', 'party_master', 'employee_master', 'office_master', 'hsn_master', 'tc_master'],
    children: [
      { label: 'Item Master', to: '/master/items' },
      { label: 'Party Master', to: '/master/parties' },
      { label: 'Employee Master', to: '/master/employees' },
      { label: 'Sales Office Master', to: '/master/offices' },
      { label: 'HSN Master', to: '/master/hsn' },
      { label: 'T&C Master', to: '/master/terms' },
    ],
  },
  {
    key: 'quotations',
    label: 'Sales Quotations',
    icon: FileText,
    module: 'quotations',
    children: [
      { label: 'Quotes Pending to be Sent', to: '/quotations/pending' },
      { label: 'Quotes Needing Revision', to: '/quotations/revisions' },
      { label: 'List of Quotations', to: '/quotations' },
    ],
  },
  {
    key: 'sales_orders',
    label: 'Sales Orders',
    icon: FileSpreadsheet,
    module: 'sales_orders',
    children: [
      { label: 'PO vs Quote Verification', to: '/sales-orders/verification' },
      { label: 'List of Sales Orders', to: '/sales-orders' },
      { label: 'Sales Order Revision', to: '/sales-orders/revisions' },
      { label: 'Create SO Manually', to: '/sales-orders/create' },
    ],
  },
  {
    key: 'erp_handoff',
    label: 'ERP Handoff',
    icon: ArrowLeftRight,
    to: '/erp-handoff',
    module: 'erp_handoff',
  },
];

// Map every nav child route -> the fine-grained featurePermissions SECTION that
// gates its visibility. Unlike the coarse module matrix (one key per group), this
// lets the sidebar hide individual sub-routes the acting user has no View on
// (e.g. a Management Viewer sees the Sales Orders group but not "Create SO
// Manually"). Sections are the keys from PERMISSION_GROUPS in featurePermissions.
export const CHILD_SECTION: Record<string, string> = {
  '/master/items': 'item_master',
  '/master/parties': 'party_master',
  '/master/employees': 'employee_master',
  '/master/offices': 'office_master',
  '/master/hsn': 'hsn_master',
  '/master/terms': 'tc_master',
  '/quotations/pending': 'quotes_pending',
  '/quotations/revisions': 'quotes_revision',
  '/quotations': 'quotes_list',
  '/sales-orders/verification': 'po_verification',
  '/sales-orders': 'so_list',
  '/sales-orders/revisions': 'so_revision',
  '/sales-orders/create': 'so_create',
};

export const ICONS = {
  Package,
  Building2,
  ScrollText,
  ClipboardCheck,
};
