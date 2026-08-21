import {
  createContext,
  useCallback as _useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type {
  ActionKey,
  CommercialTerms,
  Hsn,
  InboxAction,
  InboxEmail,
  Item,
  ModuleKey,
  Party,
  Quotation,
  Role,
  RoleDefinition,
  SalesOffice,
  SalesOrder,
  TermCondition,
  User,
} from '@/types';
import { OFFICES } from '@/data/offices';
import { USERS } from '@/data/users';
import { ROLE_DEFINITIONS } from '@/data/roles';
import { ROLE_LABELS } from '@/lib/labels';
import { HSN, ITEMS, PARTIES, TERMS } from '@/data/masters';
import { DEFAULT_COMMERCIAL_TERMS, cloneCommercialTerms } from '@/lib/commercialTerms';
import { QUOTATIONS } from '@/data/quotations';
import { SALES_ORDERS } from '@/data/salesOrders';
import { EMAILS } from '@/data/emails';
import { PO_VERIFICATION_EMAILS } from '@/data/poEmails';
import { INBOUND_PO_EMAILS } from '@/data/inboundPoEmails';
import { SO_REVISION_EMAILS } from '@/data/soRevisionEmails';
import { INQUIRY_THREAD_EMAILS } from '@/data/inquiryEmails';
import { can as canCheck, canInboxDo } from '@/lib/permissions';

export type ToastType = 'success' | 'error' | 'info' | 'warning';
export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface AppState {
  // identity / permissions
  role: Role; // derived from the acting user's role
  setRole: (r: Role) => void;
  // The employee whose identity the app is currently acting as. A Super Admin
  // can "Preview as" any employee to demonstrate office-scoped visibility; the
  // signed-in profile itself never changes.
  actingUserId: string;
  setActingUserId: (id: string) => void;
  currentUser: User;
  selectedOfficeId: string; // 'all' or office id (super admin only for 'all')
  setSelectedOfficeId: (id: string) => void;
  can: (module: ModuleKey, action: ActionKey) => boolean;
  canInbox: (action: InboxAction) => boolean;
  visibleOffices: SalesOffice[];

  // UI: application sidebar collapse (icon-only) state — lifted here so the
  // Global Inbox can auto-optimise horizontal space while it is open, then
  // restore the user's previous state on leaving.
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;

  // data
  offices: SalesOffice[];
  users: User[];
  roles: RoleDefinition[];
  roleNameOf: (u: User) => string;
  items: Item[];
  parties: Party[];
  hsn: Hsn[];
  terms: TermCondition[];
  commercialTerms: CommercialTerms;
  quotations: Quotation[];
  salesOrders: SalesOrder[];
  emails: InboxEmail[];

  // mutations
  upsertOffice: (o: SalesOffice) => void;
  upsertUser: (u: User) => void;
  removeUser: (id: string) => void;
  upsertRole: (r: RoleDefinition) => void;
  removeRole: (id: string) => void;
  upsertItem: (i: Item) => void;
  upsertParty: (p: Party) => void;
  upsertHsn: (h: Hsn) => void;
  upsertTerm: (t: TermCondition) => void;
  removeTerm: (id: string) => void;
  setCommercialTerms: (ct: CommercialTerms) => void;
  resetCommercialTerms: () => void;
  updateQuotation: (id: string, patch: Partial<Quotation>) => void;
  addQuotation: (q: Quotation) => void;
  updateSalesOrder: (id: string, patch: Partial<SalesOrder>) => void;
  addSalesOrder: (so: SalesOrder) => void;
  updateEmail: (id: string, patch: Partial<InboxEmail>) => void;
  addEmail: (e: InboxEmail) => void;

  // toasts
  toasts: Toast[];
  addToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

const ROLE_TO_USER: Record<Role, string> = {
  super_admin: 'usr-001',
  office_admin: 'usr-002',
  sales_user: 'usr-003',
  management_viewer: 'usr-012',
};

let toastSeq = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  // Identity is driven by which employee we are acting as (default: the Super
  // Admin). role is derived from that user — never stored independently.
  const [actingUserId, setActingUserIdState] = useState<string>('usr-001');
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('all');

  const [offices, setOffices] = useState<SalesOffice[]>(OFFICES);
  const [users, setUsers] = useState<User[]>(USERS);
  const [roles, setRoles] = useState<RoleDefinition[]>(ROLE_DEFINITIONS);
  const [items, setItems] = useState<Item[]>(ITEMS);
  const [parties, setParties] = useState<Party[]>(PARTIES);
  const [hsn, setHsn] = useState<Hsn[]>(HSN);
  const [terms, setTerms] = useState<TermCondition[]>(TERMS);
  const [commercialTerms, setCommercialTermsState] = useState<CommercialTerms>(() =>
    cloneCommercialTerms(DEFAULT_COMMERCIAL_TERMS)
  );
  const [quotations, setQuotations] = useState<Quotation[]>(QUOTATIONS);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>(SALES_ORDERS);
  const [emails, setEmails] = useState<InboxEmail[]>(() => [
    ...EMAILS,
    ...PO_VERIFICATION_EMAILS,
    ...INBOUND_PO_EMAILS,
    ...SO_REVISION_EMAILS,
    // The rest of each inquiry's conversation — RFQ, quotation sent, revision
    // ask and Sales Order acknowledgement — so an inquiry bundles several
    // genuinely separate threads, not one.
    ...INQUIRY_THREAD_EMAILS,
  ]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const currentUser = useMemo(() => {
    return users.find((u) => u.id === actingUserId) ?? users[0];
  }, [actingUserId, users]);

  const role = currentUser.role;

  // Switch the acting employee ("Preview as"). Office-scoped roles are pinned to
  // their own office; a Super Admin defaults back to viewing all offices.
  const setActingUserId = _useCallback(
    (id: string) => {
      setActingUserIdState(id);
      const u = USERS.find((x) => x.id === id) ?? users.find((x) => x.id === id);
      if (u && u.role === 'super_admin') setSelectedOfficeId('all');
      else if (u) setSelectedOfficeId(u.officeId || 'all');
    },
    [users]
  );

  // Backwards-compatible: pick a representative employee for the requested role.
  const setRole = _useCallback(
    (r: Role) => {
      setActingUserId(ROLE_TO_USER[r] ?? 'usr-001');
    },
    [setActingUserId]
  );

  const can = _useCallback(
    (module: ModuleKey, action: ActionKey) => canCheck(currentUser?.permissions, module, action),
    [currentUser]
  );

  const canInbox = _useCallback(
    (action: InboxAction) => canInboxDo(currentUser?.inboxPermissions, action),
    [currentUser]
  );

  const visibleOffices = useMemo(() => {
    if (role === 'super_admin') return offices;
    return offices.filter((o) => o.id === currentUser.officeId);
  }, [role, offices, currentUser]);

  const addToast = _useCallback((t: Omit<Toast, 'id'>) => {
    const id = `toast-${++toastSeq}`;
    setToasts((prev) => [...prev, { ...t, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 4200);
  }, []);

  const dismissToast = _useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const upsertOffice = _useCallback((o: SalesOffice) => {
    setOffices((prev) => {
      const exists = prev.some((x) => x.id === o.id);
      return exists ? prev.map((x) => (x.id === o.id ? o : x)) : [...prev, o];
    });
  }, []);

  const upsertUser = _useCallback((u: User) => {
    setUsers((prev) => {
      const exists = prev.some((x) => x.id === u.id);
      return exists ? prev.map((x) => (x.id === u.id ? u : x)) : [...prev, u];
    });
  }, []);

  const removeUser = _useCallback((id: string) => {
    setUsers((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const upsertRole = _useCallback((r: RoleDefinition) => {
    setRoles((prev) => {
      const exists = prev.some((x) => x.id === r.id);
      return exists ? prev.map((x) => (x.id === r.id ? r : x)) : [...prev, r];
    });
  }, []);

  // Deleting the system Super Admin role is refused unconditionally; callers
  // additionally block deleting any role still assigned to employees.
  const removeRole = _useCallback((id: string) => {
    setRoles((prev) => prev.filter((x) => !(x.id === id && !(x.system && x.baseRole === 'super_admin'))));
  }, []);

  const roleNameOf = _useCallback(
    (u: User) => roles.find((r) => r.id === u.roleId)?.name ?? ROLE_LABELS[u.role],
    [roles]
  );

  const upsertItem = _useCallback((i: Item) => {
    setItems((prev) => {
      const exists = prev.some((x) => x.id === i.id);
      return exists ? prev.map((x) => (x.id === i.id ? i : x)) : [i, ...prev];
    });
  }, []);

  const upsertParty = _useCallback((p: Party) => {
    setParties((prev) => {
      const exists = prev.some((x) => x.id === p.id);
      return exists ? prev.map((x) => (x.id === p.id ? p : x)) : [p, ...prev];
    });
  }, []);

  const upsertHsn = _useCallback((h: Hsn) => {
    setHsn((prev) => {
      const exists = prev.some((x) => x.id === h.id);
      return exists ? prev.map((x) => (x.id === h.id ? h : x)) : [h, ...prev];
    });
  }, []);

  const upsertTerm = _useCallback((t: TermCondition) => {
    setTerms((prev) => {
      const exists = prev.some((x) => x.id === t.id);
      return exists ? prev.map((x) => (x.id === t.id ? t : x)) : [t, ...prev];
    });
  }, []);

  const removeTerm = _useCallback((id: string) => {
    setTerms((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const setCommercialTerms = _useCallback((ct: CommercialTerms) => {
    setCommercialTermsState(cloneCommercialTerms(ct));
  }, []);

  const resetCommercialTerms = _useCallback(() => {
    setCommercialTermsState(cloneCommercialTerms(DEFAULT_COMMERCIAL_TERMS));
  }, []);

  const updateQuotation = _useCallback((id: string, patch: Partial<Quotation>) => {
    setQuotations((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }, []);

  const addQuotation = _useCallback((q: Quotation) => {
    setQuotations((prev) => [q, ...prev]);
  }, []);

  const updateSalesOrder = _useCallback((id: string, patch: Partial<SalesOrder>) => {
    setSalesOrders((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const addSalesOrder = _useCallback((so: SalesOrder) => {
    setSalesOrders((prev) => [so, ...prev]);
  }, []);

  const updateEmail = _useCallback((id: string, patch: Partial<InboxEmail>) => {
    setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const addEmail = _useCallback((e: InboxEmail) => {
    setEmails((prev) => [e, ...prev]);
  }, []);

  const value: AppState = {
    role,
    setRole,
    actingUserId,
    setActingUserId,
    currentUser,
    selectedOfficeId,
    setSelectedOfficeId,
    can,
    canInbox,
    visibleOffices,
    sidebarCollapsed,
    setSidebarCollapsed,
    offices,
    users,
    roles,
    roleNameOf,
    items,
    parties,
    hsn,
    terms,
    commercialTerms,
    quotations,
    salesOrders,
    emails,
    upsertOffice,
    upsertUser,
    removeUser,
    upsertRole,
    removeRole,
    upsertItem,
    upsertParty,
    upsertHsn,
    upsertTerm,
    removeTerm,
    setCommercialTerms,
    resetCommercialTerms,
    updateQuotation,
    addQuotation,
    updateSalesOrder,
    addSalesOrder,
    updateEmail,
    addEmail,
    toasts,
    addToast,
    dismissToast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// Helper: office scope filter for lists
export function useOfficeScope() {
  const { role, selectedOfficeId, currentUser } = useApp();
  return _useCallback(
    (officeId: string) => {
      if (role === 'super_admin') {
        return selectedOfficeId === 'all' || officeId === selectedOfficeId;
      }
      // An employee with no office assigned sees no office's business data.
      if (!currentUser.officeId) return false;
      return officeId === currentUser.officeId;
    },
    [role, selectedOfficeId, currentUser]
  );
}

// Whether the current (non–super-admin) user has no office assigned, so
// office-scoped screens should show the "no office assigned" empty state
// instead of silently showing nothing.
export function useNoOfficeAssigned() {
  const { role, currentUser } = useApp();
  return role !== 'super_admin' && !currentUser.officeId;
}
