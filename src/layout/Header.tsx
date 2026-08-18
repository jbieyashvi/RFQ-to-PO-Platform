import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Menu,
  PanelLeftClose,
  PanelLeft,
  ChevronDown,
  UserRound,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ConfirmDialog } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/labels';

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
  const navigate = useNavigate();

  const [userOpen, setUserOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const userRef = useClickOutside<HTMLDivElement>(() => setUserOpen(false));

  // Escape closes the user menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUserOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const initials = profile.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
  const go = (path: string) => {
    setUserOpen(false);
    navigate(path);
  };
  const confirmSignOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-surface-200 bg-white/90 px-3 backdrop-blur sm:px-5">
      {/* sidebar toggles */}
      <button
        onClick={onToggleMobile}
        className="rounded-lg p-2 text-surface-500 hover:bg-surface-100 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </button>
      <button
        onClick={onToggleSidebar}
        className="hidden rounded-lg p-2 text-surface-500 hover:bg-surface-100 lg:block"
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <PanelLeft className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
      </button>

      <div className="flex-1" />

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
          <span className="hidden text-left sm:block">
            <span className="block text-sm font-medium leading-tight text-surface-800">{profile.fullName}</span>
            <span className="block text-xs leading-tight text-surface-400">{ROLE_LABELS[profile.role]}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-surface-400 sm:block" />
        </button>
        {userOpen && (
          <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop animate-slide-up">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{initials}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-surface-800">{profile.fullName}</p>
                <p className="truncate text-xs text-surface-400">{profile.email}</p>
                {/* Current role — read-only text (no role switching in the header) */}
                <p className="mt-0.5 text-[11px] font-medium text-brand-600">{ROLE_LABELS[profile.role]}</p>
              </div>
            </div>
            <div className="my-1 border-t border-surface-100" />
            <button role="menuitem" onClick={() => go('/profile')} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50">
              <UserRound className="h-4 w-4 text-surface-400" /> My Profile
            </button>
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
        title="Sign out of Nexus RFQ?"
        message="You will need to sign in again to access the platform."
        confirmLabel="Sign Out"
        cancelLabel="Cancel"
        danger
      />
    </header>
  );
}
