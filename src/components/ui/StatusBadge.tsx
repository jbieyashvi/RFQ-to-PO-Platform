import type { BadgeTone } from '@/lib/labels';
import { classNames } from '@/lib/format';

const toneClass: Record<BadgeTone, string> = {
  gray: 'bg-surface-100 text-surface-600 ring-surface-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
};

const dotClass: Record<BadgeTone, string> = {
  gray: 'bg-surface-400',
  slate: 'bg-slate-500',
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  violet: 'bg-violet-500',
  teal: 'bg-teal-500',
};

export function StatusBadge({
  tone,
  label,
  dot = true,
  className,
}: {
  tone: BadgeTone;
  label: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={classNames(
        'inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap align-middle',
        toneClass[tone],
        className
      )}
    >
      {dot && <span className={classNames('h-1.5 w-1.5 rounded-full', dotClass[tone])} />}
      {label}
    </span>
  );
}
