import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { classNames } from '@/lib/format';

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

export function FilterBar({
  children,
  chips,
  onClearAll,
  right,
}: {
  children: ReactNode;
  chips?: FilterChip[];
  onClearAll?: () => void;
  right?: ReactNode;
}) {
  const hasChips = chips && chips.length > 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">{children}</div>
        {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
      </div>
      {hasChips && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-surface-400">Active filters:</span>
          {chips!.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-700"
            >
              {chip.label}
              <button
                onClick={chip.onRemove}
                className="rounded-full p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-700"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {onClearAll && (
            <button
              onClick={onClearAll}
              className={classNames(
                'text-xs font-semibold text-surface-500 underline-offset-2 hover:text-brand-600 hover:underline'
              )}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={classNames(
        'h-9 rounded-lg border bg-white px-3 pr-8 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 appearance-none bg-no-repeat',
        value ? 'border-brand-300 text-surface-800 font-medium' : 'border-surface-200 text-surface-500',
        className
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundPosition: 'right 0.55rem center',
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
