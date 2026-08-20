import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  LogOut,
  Eye,
  Check,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { ConfirmDialog, StatusBadge } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';
import { ROLE_LABELS } from '@/lib/labels';
import { officeName } from '@/data/offices';

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
  // NOTE: the underlying role/permission system is unchanged — the demo
  // role-preview switcher and the global office selector were removed from the
  // header UI only. The signed-in user's role is shown here as read-only text.
  const { profile, logout } = useAuth();
  const { users, actingUserId, setActingUserId } = useApp();
  const navigate = useNavigate();

  const [userOpen, setUserOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const userRef = useClickOutside<HTMLDivElement>(() => setUserOpen(false));
  const previewRef = useClickOutside<HTMLDivElement>(() => setPreviewOpen(false));

  // Prototype-only "Preview as" control. Available when the signed-in profile is
  // a Super Admin so office-scoped visibility can be demonstrated without a
  // backend. It changes only the acting user used for data-scope + permission
  // checks — the signed-in identity is unchanged.
  const canPreview = profile.role === 'super_admin';
  const actingUser = users.find((u) => u.id === actingUserId);

  // Escape closes the user menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUserOpen(false);
        setPreviewOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const initials = profile.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const confirmSignOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-surface-200 bg-white/90 px-3 backdrop-blur sm:px-5">
      {/* sidebar toggles */}
      <button
        onClick={onToggleMobile}
        className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>
      <button
        onClick={onToggleSidebar}
        className="hidden rounded-lg p-2 text-surface-500 hover:bg-surface-100 lg:block"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeft className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
      </button>

      <div className="flex-1" />

      {/* Preview-as (prototype demo of office-scoped visibility) */}
      {canPreview && (
        <div className="relative" ref={previewRef}>
          <button
            onClick={() => setPreviewOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={previewOpen}
            title="Preview the app as another employee (prototype)"
            className="flex items-center gap-2 rounded-lg border border-surface-200 py-1 pl-2 pr-2 text-[13px] text-surface-600 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <Eye className="h-4 w-4 text-surface-400" />
            <span className="hidden max-w-[160px] truncate sm:block">
              Viewing as <span className="font-semibold text-surface-800">{actingUser?.fullName ?? '—'}</span>
            </span>
            <ChevronDown className="h-4 w-4 text-surface-400" />
          </button>
          {previewOpen && (
            <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop animate-slide-up">
              <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Preview as employee</p>
              {users.map((u) => {
                const selected = u.id === actingUserId;
                return (
                  <button
                    key={u.id}
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => { setActingUserId(u.id); setPreviewOpen(false); }}
                    className={
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50' +
                      (selected ? ' bg-brand-50/60' : '')
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-surface-800">{u.fullName}</span>
                        {selected && <Check className="h-3.5 w-3.5 flex-none text-brand-600" />}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-surface-400">
                        <span>{ROLE_LABELS[u.role]}</span>
                        <span>·</span>
                        <span className="truncate">{u.officeId ? officeName(u.officeId) : 'Unassigned'}</span>
                      </span>
                    </span>
                    <StatusBadge tone={u.role === 'super_admin' ? 'violet' : u.officeId ? 'blue' : 'amber'} dot={false} label={u.role === 'super_admin' ? 'All' : u.officeId ? officeName(u.officeId) : 'None'} />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* User */}
      <div className="relative" ref={userRef}>
        <button
          onClick={() => setUserOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={userOpen}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            {initials}
          </span>
          {/* Trigger shows only avatar + user name — no role, email or office. */}
          <span className="hidden text-left sm:block">
            <span className="block text-[13px] font-semibold leading-tight text-surface-800">{profile.fullName}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-surface-400 sm:block" />
        </button>
        {userOpen && (
          <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop animate-slide-up">
            {/* Menu shows user name, work email and Sign Out only. */}
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-surface-800">{profile.fullName}</p>
                <p className="truncate text-xs text-surface-400">{profile.email}</p>
              </div>
            </div>
            <div className="my-1 border-t border-surface-100" />
            <button role="menuitem" onClick={() => { setUserOpen(false); setSignOutOpen(true); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50">
              <LogOut className="h-4 w-4" /> Sign Out
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={signOutOpen}
        onClose={() => setSignOutOpen(false)}
        onConfirm={confirmSignOut}
        title={`Sign out of ${APP_NAME}?`}
        message="You will need to sign in again to access the platform."
        confirmLabel="Sign Out"
        cancelLabel="Cancel"
        danger
      />
    </header>
  );
}
