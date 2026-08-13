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
  Hsn,
  InboxAction,
  InboxEmail,
  Item,
  ModuleKey,
  Party,
  Quotation,
  Role,
  SalesOffice,
  SalesOrder,
  TermCondition,
  User,
} from '@/types';
import { OFFICES } from '@/data/offices';
import { USERS } from '@/data/users';
import { HSN, ITEMS, PARTIES, TERMS } from '@/data/masters';
import { QUOTATIONS } from '@/data/quotations';
import { SALES_ORDERS } from '@/data/salesOrders';
import { EMAILS } from '@/data/emails';
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
  role: Role;
  setRole: (r: Role) => void;
  currentUser: User;
  selectedOfficeId: string; // 'all' or office id (super admin only for 'all')
  setSelectedOfficeId: (id: string) => void;
  can: (module: ModuleKey, action: ActionKey) => boolean;
  canInbox: (action: InboxAction) => boolean;
  visibleOffices: SalesOffice[];

  // data
  offices: SalesOffice[];
  users: User[];
  items: Item[];
  parties: Party[];
  hsn: Hsn[];
  terms: TermCondition[];
  quotations: Quotation[];
  salesOrders: SalesOrder[];
  emails: InboxEmail[];

  // mutations
  upsertOffice: (o: SalesOffice) => void;
  upsertUser: (u: User) => void;
  removeUser: (id: string) => void;
  upsertItem: (i: Item) => void;
  upsertParty: (p: Party) => void;
  upsertHsn: (h: Hsn) => void;
  upsertTerm: (t: TermCondition) => void;
  removeTerm: (id: string) => void;
  updateQuotation: (id: string, patch: Partial<Quotation>) => void;
  addQuotation: (q: Quotation) => void;
  updateSalesOrder: (id: string, patch: Partial<SalesOrder>) => void;
  addSalesOrder: (so: SalesOrder) => void;
  updateEmail: (id: string, patch: Partial<InboxEmail>) => void;

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
};

let toastSeq = 0;

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>('super_admin');
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('all');

  const [offices, setOffices] = useState<SalesOffice[]>(OFFICES);
  const [users, setUsers] = useState<User[]>(USERS);
  const [items, setItems] = useState<Item[]>(ITEMS);
  const [parties, setParties] = useState<Party[]>(PARTIES);
  const [hsn, setHsn] = useState<Hsn[]>(HSN);
  const [terms, setTerms] = useState<TermCondition[]>(TERMS);
  const [quotations, setQuotations] = useState<Quotation[]>(QUOTATIONS);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>(SALES_ORDERS);
  const [emails, setEmails] = useState<InboxEmail[]>(EMAILS);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const currentUser = useMemo(() => {
    const base = users.find((u) => u.id === ROLE_TO_USER[role]) ?? users[0];
    return base;
  }, [role, users]);

  const setRole = _useCallback(
    (r: Role) => {
      setRoleState(r);
      const u = USERS.find((x) => x.id === ROLE_TO_USER[r]);
      // office roles are pinned to their own office; super admin defaults to "all"
      if (r === 'super_admin') setSelectedOfficeId('all');
      else if (u) setSelectedOfficeId(u.officeId);
    },
    []
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

  const value: AppState = {
    role,
    setRole,
    currentUser,
    selectedOfficeId,
    setSelectedOfficeId,
    can,
    canInbox,
    visibleOffices,
    offices,
    users,
    items,
    parties,
    hsn,
    terms,
    quotations,
    salesOrders,
    emails,
    upsertOffice,
    upsertUser,
    removeUser,
    upsertItem,
    upsertParty,
    upsertHsn,
    upsertTerm,
    removeTerm,
    updateQuotation,
    addQuotation,
    updateSalesOrder,
    addSalesOrder,
    updateEmail,
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
      return officeId === currentUser.officeId;
    },
    [role, selectedOfficeId, currentUser]
  );
}
