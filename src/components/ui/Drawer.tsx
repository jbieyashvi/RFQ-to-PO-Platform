import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { classNames } from '@/lib/format';

type Width = 'md' | 'lg' | 'xl' | '2xl';
const widthClass: Record<Width, string> = {
  md: 'max-w-md',
  lg: 'max-w-xl',
  xl: 'max-w-3xl',
  '2xl': 'max-w-5xl',
};

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  width = 'lg',
  children,
  footer,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  width?: Width;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-surface-900/40 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={classNames(
          'absolute right-0 top-0 flex h-full w-full flex-col bg-white shadow-drawer animate-slide-in-right',
          widthClass[width]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-surface-100 px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-base font-semibold text-surface-800">{title}</h2>}
            {subtitle && <div className="mt-0.5 text-[12px] text-surface-500">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-surface-100 bg-surface-50/60 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
