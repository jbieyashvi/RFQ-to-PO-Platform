import { ChevronDown } from 'lucide-react';
import type { BadgeTone } from '@/lib/labels';
import { StatusBadge, badgeToneClass } from '@/components/ui';
import { classNames } from '@/lib/format';

/**
 * Compact, badge-styled dropdown used for the inline Status / Stage controls on
 * the quotations list. It is deliberately controlled by the row's live value:
 * picking a new option fires onSelect (which opens the review-date prompt) but
 * never mutates the value here, so cancelling naturally reverts the selection.
 */
export function WorkflowInlineSelect<T extends string>({
  value,
  tone,
  options,
  onSelect,
  disabled,
  ariaLabel,
}: {
  value: T;
  tone: BadgeTone;
  options: { value: T; label: string }[];
  onSelect: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  if (disabled) {
    const current = options.find((o) => o.value === value);
    return <StatusBadge tone={tone} label={current?.label ?? value} dot={false} />;
  }

  return (
    // Stop propagation so using the dropdown doesn't also open the row drawer.
    <div className="relative inline-flex max-w-full" onClick={(e) => e.stopPropagation()}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => {
          const next = e.target.value as T;
          if (next !== value) onSelect(next);
        }}
        className={classNames(
          'w-full cursor-pointer appearance-none truncate rounded-full py-0.5 pl-2 pr-6 text-[11px] font-medium ring-1 ring-inset transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
          badgeToneClass[tone]
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-white text-surface-700">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 opacity-60" />
    </div>
  );
}
