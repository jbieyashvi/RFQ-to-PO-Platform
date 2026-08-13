import type { ReactNode } from 'react';
import { ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { classNames } from '@/lib/format';

type Accent = 'brand' | 'emerald' | 'amber' | 'rose' | 'blue' | 'violet' | 'slate';

const accentBg: Record<Accent, string> = {
  brand: 'bg-brand-50 text-brand-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  slate: 'bg-slate-100 text-slate-600',
};

export function KpiCard({
  label,
  value,
  icon,
  accent = 'brand',
  sub,
  trend,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  accent?: Accent;
  sub?: string;
  trend?: { dir: 'up' | 'down'; value: string };
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={classNames(
        'card group flex flex-col p-4 text-left transition',
        clickable && 'hover:shadow-card-hover hover:border-surface-300 cursor-pointer'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-surface-500">{label}</span>
        {icon && (
          <span className={classNames('flex h-8 w-8 items-center justify-center rounded-lg', accentBg[accent])}>
            {icon}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between">
        <span className="text-2xl font-bold tracking-tight text-surface-800">{value}</span>
        {clickable && (
          <ArrowUpRight className="h-4 w-4 text-surface-300 transition group-hover:text-brand-500" />
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        {sub && <span className="text-xs text-surface-400">{sub}</span>}
        {trend && (
          <span
            className={classNames(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              trend.dir === 'up' ? 'text-emerald-600' : 'text-rose-600'
            )}
          >
            {trend.dir === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend.value}
          </span>
        )}
      </div>
    </button>
  );
}
