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
    <div className="flex h-full flex-col bg-surface-900 text-surface-300">
      {/* brand */}
      <div className="flex h-16 flex-none items-center gap-2.5 border-b border-white/5 px-4">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-600 text-white shadow-lg shadow-brand-900/40">
          <Boxes className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">Nexus RFQ</p>
            <p className="truncate text-[11px] text-surface-400">RFQ → PO Platform</p>
          </div>
        )}
        <button
          onClick={onCloseMobile}
          className="ml-auto rounded-lg p-1.5 text-surface-400 hover:bg-white/10 lg:hidden"
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
                    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-surface-300 hover:bg-white/5 hover:text-white'
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
              <div key={item.key} className="group relative">
                <button
                  className={classNames(
                    'flex w-full items-center justify-center rounded-lg px-3 py-2 transition-colors',
                    groupActive ? 'bg-white/10 text-white' : 'text-surface-300 hover:bg-white/5 hover:text-white'
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </button>
                {/* flyout */}
                <div className="pointer-events-none absolute left-full top-0 z-30 ml-2 hidden w-56 rounded-xl border border-surface-700 bg-surface-800 p-2 shadow-pop group-hover:pointer-events-auto group-hover:block">
                  <p className="px-2 py-1 text-xs font-semibold text-surface-400">{item.label}</p>
                  {children.map((c) => (
                    <NavLink
                      key={c.to}
                      to={c.to}
                      end={c.to === '/quotations'}
                      onClick={onCloseMobile}
                      className={({ isActive }) =>
                        classNames(
                          'block rounded-lg px-3 py-1.5 text-sm',
                          isActive ? 'bg-brand-600 text-white' : 'text-surface-300 hover:bg-white/5 hover:text-white'
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
            <div key={item.key}>
              <button
                onClick={() => toggleGroup(item.key)}
                className={classNames(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  groupActive ? 'text-white' : 'text-surface-300 hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon className="h-[18px] w-[18px] flex-none" />
                <span className="flex-1 truncate text-left">{item.label}</span>
                <ChevronRight
                  className={classNames('h-4 w-4 transition-transform', isOpen && 'rotate-90')}
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
                          'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                          isActive
                            ? 'bg-brand-600/90 font-medium text-white'
                            : 'text-surface-400 hover:bg-white/5 hover:text-white'
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
        <div className="flex-none border-t border-white/5 p-3">
          <div className="rounded-lg bg-white/5 px-3 py-2.5">
            <p className="text-[11px] font-medium text-surface-400">Prototype build</p>
            <p className="text-[11px] text-surface-500">v1.0 • Frontend demo</p>
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
          collapsed ? 'w-[68px]' : 'w-64'
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
