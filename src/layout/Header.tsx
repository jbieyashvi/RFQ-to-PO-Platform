import { useEffect, useRef, useState } from 'react';
import {
  Menu,
  PanelLeftClose,
  PanelLeft,
  Bell,
  ChevronDown,
  Building2,
  Eye,
  Check,
  UserCircle2,
} from 'lucide-react';
import type { Role } from '@/types';
import { useApp } from '@/context/AppContext';
import { ROLE_LABELS } from '@/lib/labels';
import { classNames } from '@/lib/format';

function useClickOutside<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  return ref;
}

export function Header({
  onToggleSidebar,
  onToggleMobile,
  collapsed,
}: {
  onToggleSidebar: () => void;
  onToggleMobile: () => void;
  collapsed: boolean;
}) {
  const {
    role,
    setRole,
    currentUser,
    selectedOfficeId,
    setSelectedOfficeId,
    offices,
    visibleOffices,
  } = useApp();

  const [officeOpen, setOfficeOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const officeRef = useClickOutside<HTMLDivElement>(() => setOfficeOpen(false));
  const roleRef = useClickOutside<HTMLDivElement>(() => setRoleOpen(false));
  const notifRef = useClickOutside<HTMLDivElement>(() => setNotifOpen(false));
  const userRef = useClickOutside<HTMLDivElement>(() => setUserOpen(false));

  const isSuper = role === 'super_admin';
  const currentOfficeLabel =
    selectedOfficeId === 'all'
      ? 'All Sales Offices'
      : offices.find((o) => o.id === selectedOfficeId)?.name ?? 'Select Office';

  const notifications = [
    { id: 1, title: '3 quotes pending > 24 hrs', desc: 'Action required in Quotes Pending queue', tone: 'amber' },
    { id: 2, title: 'PO mismatch flagged', desc: 'SO/2026/0503 — value differs from quote', tone: 'rose' },
    { id: 3, title: '2 reviews overdue today', desc: 'Follow-up on Mumbai quotations', tone: 'blue' },
  ];

  const roles: Role[] = ['super_admin', 'office_admin', 'sales_user'];

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-surface-200 bg-white/90 px-3 backdrop-blur sm:px-5">
      {/* sidebar toggles */}
      <button
        onClick={onToggleMobile}
        className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        onClick={onToggleSidebar}
        className="hidden rounded-lg p-2 text-surface-500 hover:bg-surface-100 lg:block"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>

      {/* Office selector */}
      <div className="relative ml-1" ref={officeRef}>
        <button
          onClick={() => isSuper && setOfficeOpen((v) => !v)}
          className={classNames(
            'flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm shadow-sm',
            isSuper ? 'hover:border-surface-300 hover:bg-surface-50' : 'cursor-default'
          )}
        >
          <Building2 className="h-4 w-4 text-brand-500" />
          <span className="hidden max-w-[180px] truncate font-medium text-surface-700 sm:inline">
            {currentOfficeLabel}
          </span>
          {isSuper && <ChevronDown className="h-4 w-4 text-surface-400" />}
        </button>
        {officeOpen && isSuper && (
          <div className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop animate-slide-up">
            <button
              onClick={() => {
                setSelectedOfficeId('all');
                setOfficeOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-50"
            >
              <span className="font-medium text-surface-700">All Sales Offices</span>
              {selectedOfficeId === 'all' && <Check className="h-4 w-4 text-brand-600" />}
            </button>
            <div className="my-1 border-t border-surface-100" />
            {offices.map((o) => (
              <button
                key={o.id}
                onClick={() => {
                  setSelectedOfficeId(o.id);
                  setOfficeOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-50"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-surface-700">{o.name}</span>
                  <span className="block text-xs text-surface-400">{o.code}</span>
                </span>
                {selectedOfficeId === o.id && <Check className="h-4 w-4 flex-none text-brand-600" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1" />

      {/* Role preview */}
      <div className="relative" ref={roleRef}>
        <button
          onClick={() => setRoleOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100"
          title="Preview as role"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden sm:inline">Preview: {ROLE_LABELS[role]}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
        {roleOpen && (
          <div className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop animate-slide-up">
            <p className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-surface-400">
              Preview as role
            </p>
            {roles.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setRole(r);
                  setRoleOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-surface-50"
              >
                <span>
                  <span className="block font-medium text-surface-700">{ROLE_LABELS[r]}</span>
                  <span className="block text-xs text-surface-400">
                    {r === 'super_admin'
                      ? 'All offices & modules'
                      : r === 'office_admin'
                      ? 'Single office, most actions'
                      : 'Limited, view/edit only'}
                  </span>
                </span>
                {role === r && <Check className="h-4 w-4 flex-none text-brand-600" />}
              </button>
            ))}
            <p className="mt-1 border-t border-surface-100 px-3 pt-2 text-[11px] text-surface-400">
              Demo control — simulates permission-based UI without login.
            </p>
          </div>
        )}
      </div>

      {/* Notifications */}
      <div className="relative" ref={notifRef}>
        <button
          onClick={() => setNotifOpen((v) => !v)}
          className="relative rounded-lg p-2 text-surface-500 hover:bg-surface-100"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-1.5 top-1.5 flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
          </span>
        </button>
        {notifOpen && (
          <div className="absolute right-0 top-full z-30 mt-1.5 w-80 rounded-xl border border-surface-200 bg-white shadow-pop animate-slide-up">
            <div className="flex items-center justify-between border-b border-surface-100 px-4 py-3">
              <p className="text-sm font-semibold text-surface-800">Notifications</p>
              <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">
                3 new
              </span>
            </div>
            <ul className="max-h-80 divide-y divide-surface-100 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id} className="flex gap-3 px-4 py-3 hover:bg-surface-50">
                  <span
                    className={classNames(
                      'mt-1 h-2 w-2 flex-none rounded-full',
                      n.tone === 'amber' ? 'bg-amber-500' : n.tone === 'rose' ? 'bg-rose-500' : 'bg-blue-500'
                    )}
                  />
                  <div>
                    <p className="text-sm font-medium text-surface-800">{n.title}</p>
                    <p className="text-xs text-surface-500">{n.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-surface-100 px-4 py-2 text-center">
              <button className="text-xs font-semibold text-brand-600 hover:underline">
                View all notifications
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User */}
      <div className="relative" ref={userRef}>
        <button
          onClick={() => setUserOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-100"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {currentUser.fullName
              .split(' ')
              .map((n) => n[0])
              .slice(0, 2)
              .join('')}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight text-surface-800">
              {currentUser.fullName}
            </span>
            <span className="block text-xs leading-tight text-surface-400">{ROLE_LABELS[role]}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-surface-400 sm:block" />
        </button>
        {userOpen && (
          <div className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop animate-slide-up">
            <div className="flex items-center gap-3 px-3 py-2">
              <UserCircle2 className="h-9 w-9 text-surface-300" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-surface-800">{currentUser.fullName}</p>
                <p className="truncate text-xs text-surface-400">{currentUser.email}</p>
              </div>
            </div>
            <div className="my-1 border-t border-surface-100" />
            <div className="px-3 py-1.5 text-xs text-surface-500">
              Role: <span className="font-medium text-surface-700">{ROLE_LABELS[role]}</span>
            </div>
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-surface-600 hover:bg-surface-50">
              Profile settings
            </button>
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-surface-600 hover:bg-surface-50">
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
