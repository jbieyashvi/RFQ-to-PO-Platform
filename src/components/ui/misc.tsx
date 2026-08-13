import type { ReactNode } from 'react';
import { classNames } from '@/lib/format';

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={classNames('card overflow-hidden', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-surface-100 px-5 py-3.5">
          <div>
            {title && <h3 className="text-sm font-semibold text-surface-800">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-surface-400">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={classNames(bodyClassName ?? 'p-5')}>{children}</div>
    </section>
  );
}

export function DescList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((it, i) => (
        <div key={i}>
          <dt className="text-xs font-medium uppercase tracking-wide text-surface-400">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-surface-800">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-surface-200 no-scrollbar">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={classNames(
            '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            active === t.key
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-surface-500 hover:border-surface-300 hover:text-surface-700'
          )}
        >
          {t.label}
          {typeof t.count === 'number' && (
            <span
              className={classNames(
                'ml-2 rounded-full px-1.5 py-0.5 text-xs',
                active === t.key ? 'bg-brand-100 text-brand-700' : 'bg-surface-100 text-surface-500'
              )}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-surface-500">{label}</span>
      <span className="text-sm font-medium text-surface-800">{value}</span>
    </div>
  );
}
