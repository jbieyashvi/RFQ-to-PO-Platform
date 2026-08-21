import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Toaster } from '@/components/ui/Toaster';
import { classNames } from '@/lib/format';
import { useApp } from '@/context/AppContext';

export function AppShell() {
  // Sidebar collapse lives in AppContext so the Global Inbox can auto-collapse
  // it for more workspace width, then restore the user's previous state on exit.
  const { sidebarCollapsed: collapsed, setSidebarCollapsed: setCollapsed } = useApp();
  const [mobileOpen, setMobileOpen] = useState(false);
  // The Global Inbox is a full-bleed workspace: it owns its own gutters and
  // fills the height under the header, so the page container must not add a max
  // width, side padding or vertical rhythm of its own around it.
  const fullBleed = useLocation().pathname.startsWith('/inbox');

  return (
    <div className="min-h-screen overflow-x-clip bg-surface-50">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className={classNames('transition-all duration-200', collapsed ? 'lg:pl-[68px]' : 'lg:pl-60')}>
        <Header
          collapsed={collapsed}
          onToggleSidebar={() => setCollapsed((v) => !v)}
          onToggleMobile={() => setMobileOpen(true)}
        />
        <main className={classNames('w-full', !fullBleed && 'mx-auto max-w-[1440px] px-4 py-5 sm:px-6')}>
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
