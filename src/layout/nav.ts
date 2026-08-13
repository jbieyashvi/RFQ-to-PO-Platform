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
    key: 'master',
    label: 'Master',
    icon: Landmark,
    module: ['item_master', 'party_master', 'office_master', 'hsn_master', 'tc_master'],
    children: [
      { label: 'Item Master', to: '/master/items' },
      { label: 'Party Master', to: '/master/parties' },
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
];

// map child module -> which master module each master route requires (for per-child gating)
export const MASTER_CHILD_MODULE: Record<string, ModuleKey> = {
  '/master/items': 'item_master',
  '/master/parties': 'party_master',
  '/master/offices': 'office_master',
  '/master/hsn': 'hsn_master',
  '/master/terms': 'tc_master',
};

export const ICONS = {
  Package,
  Building2,
  ScrollText,
  ClipboardCheck,
};
