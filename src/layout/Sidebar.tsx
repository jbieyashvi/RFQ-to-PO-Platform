import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import type { ModuleKey } from '@/types';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { NAV, CHILD_SECTION } from './nav';
import { classNames } from '@/lib/format';
import { FlowtechLogo, FlowtechMonogram } from '@/components/Brand';
import { APP_SUBTITLE } from '@/lib/brand';

function visibleModule(can: (m: ModuleKey, a: 'view') => boolean, module: ModuleKey | ModuleKey[]) {
  if (Array.isArray(module)) return module.some((m) => can(m, 'view'));
  return can(module, 'view');
}

export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
}: {
  collapsed: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { can, canInbox, emails, setSidebarCollapsed, currentUser } = useApp();
  const inScope = useOfficeScope();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    master: true,
    quotations: true,
    sales_orders: true,
  });

  // The nav group (if any) that owns the current route — used to highlight the
  // active section and to auto-open it when the sidebar is reopened.
  const activeGroupKey = useMemo(() => {
    for (const item of NAV) {
      if (!item.children) continue;
      const hit = item.children.some((c) =>
        c.to === '/quotations' ? location.pathname === '/quotations' : location.pathname.startsWith(c.to)
      );
      if (hit) return item.key;
    }
    return null;
  }, [location.pathname]);

  // When the sidebar is (re)expanded, make sure the group containing the current
  // route is open so the user lands on their section already unfolded.
  useEffect(() => {
    if (!collapsed && activeGroupKey) {
      setOpenGroups((g) => (g[activeGroupKey] ? g : { ...g, [activeGroupKey]: true }));
    }
  }, [collapsed, activeGroupKey]);

  // One shared handler for every expandable parent. Collapsed → expand the
  // sidebar and open the clicked group (route stays put). Expanded → just toggle
  // that section's submenu.
  const handleGroupClick = (key: string) => {
    if (collapsed) {
      setSidebarCollapsed(false);
      setOpenGroups((g) => ({ ...g, [key]: true }));
    } else {
      setOpenGroups((g) => ({ ...g, [key]: !g[key] }));
    }
  };

  const inboxCounts = useMemo(() => {
    const scoped = emails.filter((e) => inScope(e.officeId));
    return {
      unread: scoped.filter((e) => !e.read && !e.sent).length,
      review: scoped.filter((e) => e.needsReview && !e.sent).length,
    };
  }, [emails, inScope]);

  const items = NAV.filter((item) =>
    item.special === 'inbox' ? canInbox('view') : visibleModule(can as any, item.module)
  );

  const content = (
    <div className="flex h-full flex-col border-r border-surface-200 bg-white text-surface-700">
      {/* brand — official Flowtech wordmark when expanded, monogram when collapsed */}
      <div className="flex h-14 flex-none items-center gap-2.5 border-b border-surface-100 px-4">
        {collapsed ? (
          <FlowtechMonogram className="h-9 w-9" />
        ) : (
          <>
            <FlowtechLogo />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-surface-500">{APP_SUBTITLE}</p>
            </div>
          </>
        )}
        <button
          onClick={onCloseMobile}
          className="ml-auto rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3 no-scrollbar">
        {items.map((item) => {
          const Icon = item.icon;
          if (!item.children) {
            const isInbox = item.special === 'inbox';
            return (
              <NavLink
                key={item.key}
                to={item.to!}
                onClick={onCloseMobile}
                title={collapsed && isInbox && (inboxCounts.unread > 0 || inboxCounts.review > 0) ? `${inboxCounts.unread} unread emails · ${inboxCounts.review} emails need review` : undefined}
                className={({ isActive }) =>
                  classNames(
                    'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    isActive
                      ? 'bg-brand-50 text-brand-700 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-brand-600'
                      : 'text-surface-700 hover:bg-surface-100 hover:text-surface-900'
                  )
                }
              >
                <span className="relative flex-none">
                  <Icon className="h-[18px] w-[18px]" />
                  {collapsed && isInbox && inboxCounts.review > 0 && (
                    <span
                      role="status"
                      aria-label={`${inboxCounts.review} emails need review`}
                      className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white"
                    >
                      {inboxCounts.review > 9 ? '9+' : inboxCounts.review}
                    </span>
                  )}
                </span>
                {!collapsed && <span className="truncate">{item.label}</span>}
                {!collapsed && isInbox && (
                  <span className="ml-auto flex items-center gap-1">
                    {inboxCounts.unread > 0 && (
                      <span
                        role="status"
                        title={`${inboxCounts.unread} unread emails`}
                        aria-label={`${inboxCounts.unread} unread emails`}
                        className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white"
                      >
                        {inboxCounts.unread}
                      </span>
                    )}
                    {inboxCounts.review > 0 && (
                      <span
                        role="status"
                        title={`${inboxCounts.review} emails need review`}
                        aria-label={`${inboxCounts.review} emails need review`}
                        className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
                      >
                        {inboxCounts.review}
                      </span>
                    )}
                  </span>
                )}
              </NavLink>
            );
          }

          // group with children — hide any sub-route the acting user has no View
          // on. Uses the fine-grained featurePermissions section so sub-routes
          // sharing one coarse module (e.g. every Sales Orders screen) are still
          // gated individually — a Management Viewer sees the group but not
          // "Create SO Manually".
          const children = item.children.filter((c) => {
            const section = CHILD_SECTION[c.to];
            if (!section) return true;
            return !!currentUser.featurePermissions?.[section]?.view;
          });
          if (children.length === 0) return null;

          const groupActive = children.some((c) =>
            c.to === '/quotations'
              ? location.pathname === '/quotations'
              : location.pathname.startsWith(c.to)
          );
          const isOpen = collapsed ? true : openGroups[item.key] ?? true;

          if (collapsed) {
            return (
              <div key={item.key} className="group relative border-t border-surface-100 pt-1">
                <button
                  type="button"
                  onClick={() => handleGroupClick(item.key)}
                  aria-label={`Open ${item.label} menu`}
                  aria-expanded={false}
                  title={item.label}
                  className={classNames(
                    'flex min-h-[40px] w-full items-center justify-center rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    groupActive
                      ? 'relative bg-brand-50 text-brand-700 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-brand-600'
                      : 'text-surface-700 hover:bg-surface-100 hover:text-surface-900'
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </button>
                {/* flyout */}
                <div className="pointer-events-none absolute left-full top-0 z-30 ml-2 hidden w-56 rounded-xl border border-surface-200 bg-white p-2 shadow-pop group-hover:pointer-events-auto group-hover:block">
                  <p className="px-2 py-1 text-xs font-semibold text-surface-400">{item.label}</p>
                  {children.map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end={c.to === '/quotations' || c.to === '/sales-orders'}
                      onClick={onCloseMobile}
                      className={({ isActive }) =>
                        classNames(
                          'block rounded-lg px-3 py-1.5 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                          isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900'
                        )
                      }
                    >
                      {c.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          }

          return (
            <div key={item.key} className="border-t border-surface-100 pt-2">
              <button
                type="button"
                onClick={() => handleGroupClick(item.key)}
                aria-label={`Open ${item.label} menu`}
                aria-expanded={isOpen}
                className={classNames(
                  'flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                  groupActive
                    ? 'text-brand-700 hover:bg-brand-50/60'
                    : 'text-surface-700 hover:bg-surface-100 hover:text-surface-900'
                )}
              >
                <Icon className="h-[18px] w-[18px] flex-none" />
                <span className="flex-1 truncate text-left">{item.label}</span>
                <ChevronRight
                  className={classNames(
                    'h-4 w-4 flex-none text-surface-400 transition-transform',
                    groupActive && 'text-brand-500',
                    isOpen && 'rotate-90'
                  )}
                />
              </button>
              {isOpen && (
                <div className="mt-1 space-y-0.5 pl-4">
                  {children.map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end={c.to === '/quotations' || c.to === '/sales-orders'}
                      onClick={onCloseMobile}
                      title={c.label}
                      className={({ isActive }) =>
                        classNames(
                          'flex items-start gap-2.5 rounded-lg px-3 py-1.5 text-[12px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                          isActive
                            ? 'relative bg-brand-50 font-medium text-brand-700 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-brand-600'
                            : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900'
                        )
                      }
                    >
                      <span className="mt-[5px] h-1.5 w-1.5 flex-none rounded-full bg-current opacity-40" />
                      <span>{c.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="flex-none border-t border-surface-100 p-3">
          <div className="rounded-lg bg-brand-50/50 px-3 py-2.5">
            <p className="text-[11px] font-medium text-surface-500">Prototype build</p>
            <p className="text-[11px] text-surface-400">v1.0 • Frontend demo</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* desktop */}
      <aside
        className={classNames(
          'fixed inset-y-0 left-0 z-30 hidden flex-none transition-all duration-200 lg:block',
          collapsed ? 'w-[68px]' : 'w-60'
        )}
      >
        {content}
      </aside>

      {/* mobile drawer */}
      <div className={classNames('lg:hidden', mobileOpen ? '' : 'pointer-events-none')}>
        <div
          className={classNames(
            'fixed inset-0 z-40 bg-surface-900/50 transition-opacity',
            mobileOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={onCloseMobile}
        />
        <aside
          className={classNames(
            'fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {content}
        </aside>
      </div>
    </>
  );
}
