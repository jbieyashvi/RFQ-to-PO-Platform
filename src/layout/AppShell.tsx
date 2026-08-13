import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Toaster } from '@/components/ui/Toaster';
import { classNames } from '@/lib/format';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
        <main className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}
