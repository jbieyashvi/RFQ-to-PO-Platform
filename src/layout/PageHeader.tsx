import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

export interface Crumb {
  label: string;
  to?: string;
}

export function PageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: string;
  description?: string;
  crumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4">
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-1.5 flex items-center gap-1 text-[11px] leading-4 text-surface-400">
          <Link to="/dashboard" className="flex items-center hover:text-surface-600">
            <Home className="h-3 w-3" />
          </Link>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              {c.to && i < crumbs.length - 1 ? (
                <Link to={c.to} className="hover:text-surface-600">
                  {c.label}
                </Link>
              ) : (
                <span className={i === crumbs.length - 1 ? 'font-medium text-surface-600' : ''}>
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[20px] font-bold leading-7 tracking-tight text-surface-900">{title}</h1>
          {description && <p className="mt-0.5 text-[12px] leading-[18px] text-surface-500">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
