import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronRight, Boxes, X } from 'lucide-react';
import type { ModuleKey } from '@/types';
import { useApp } from '@/context/AppContext';
import { NAV, MASTER_CHILD_MODULE } from './nav';
import { classNames } from '@/lib/format';

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
  const { can } = useApp();
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    master: true,
    quotations: true,
    sales_orders: true,
  });

  const toggleGroup = (key: string) =>
    setOpenGroups((g) => ({ ...g, [key]: !g[key] }));

  const items = NAV.filter((item) => visibleModule(can as any, item.module));

  const content = (
    <div className="flex h-full flex-col border-r border-surface-200 bg-white text-surface-700">
      {/* brand */}
      <div className="flex h-16 flex-none items-center gap-2.5 border-b border-surface-100 px-4">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
          <Boxes className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-surface-800">Nexus RFQ</p>
            <p className="truncate text-[11px] text-surface-400">RFQ → PO Platform</p>
          </div>
        )}
        <button
          onClick={onCloseMobile}
          className="ml-auto rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4 no-scrollbar">
        {items.map((item) => {
          const Icon = item.icon;
          if (!item.children) {
            return (
              <NavLink
                key={item.key}
                to={item.to!}
                onClick={onCloseMobile}
                className={({ isActive }) =>
                  classNames(
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    isActive
                      ? 'relative bg-brand-50 text-brand-700 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-brand-600'
                      : 'text-surface-700 hover:bg-surface-100 hover:text-surface-900'
                  )
                }
              >
                <Icon className="h-[18px] w-[18px] flex-none" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          }

          // group with children — filter children by per-child module for masters
          const children = item.children.filter((c) => {
            const mod = MASTER_CHILD_MODULE[c.to];
            if (!mod) return true;
            return can(mod, 'view');
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
                  className={classNames(
                    'flex w-full items-center justify-center rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
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
                      end={c.to === '/quotations'}
                      onClick={onCloseMobile}
                      className={({ isActive }) =>
                        classNames(
                          'block rounded-lg px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
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
                onClick={() => toggleGroup(item.key)}
                className={classNames(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
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
                      end={c.to === '/quotations'}
                      onClick={onCloseMobile}
                      className={({ isActive }) =>
                        classNames(
                          'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                          isActive
                            ? 'relative bg-brand-50 font-medium text-brand-700 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-brand-600'
                            : 'text-surface-600 hover:bg-surface-100 hover:text-surface-900'
                        )
                      }
                    >
                      <span
                        className={classNames(
                          'h-1.5 w-1.5 flex-none rounded-full',
                          'bg-current opacity-40'
                        )}
                      />
                      <span className="truncate">{c.label}</span>
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
