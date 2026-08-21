import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { classNames } from '@/lib/format';

type Variant = 'secondary' | 'ghost';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name — rendered as both the tooltip (title) and aria-label. */
  label: string;
  icon: ReactNode;
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
};
const sizeClass: Record<Size, string> = {
  sm: 'h-[30px] w-[30px]',
  md: 'h-8 w-8',
};

/**
 * Compact icon-only button for SECONDARY actions (Preview, Save Draft,
 * Download…). Always carries a tooltip + aria-label so the action stays
 * discoverable and accessible. Primary actions keep visible text Buttons.
 */
export function IconButton({ label, icon, variant = 'secondary', size = 'sm', className, ...rest }: Props) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={classNames('btn flex-none !px-0', variantClass[variant], sizeClass[size], className)}
      {...rest}
    >
      {icon}
    </button>
  );
}
