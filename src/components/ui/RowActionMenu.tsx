import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { classNames } from '@/lib/format';

export interface RowAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * Compact labelled three-dot menu for table rows where multiple actions
 * cannot fit inline. Renders the popup in a portal so the table's
 * horizontal-scroll container never clips it.
 */
export function RowActionMenu({ actions, label = 'Row actions' }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const menuW = 208;
    const left = Math.max(8, Math.min(b.right - menuW, window.innerWidth - menuW - 8));
    setPos({ top: b.bottom + 4, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', () => setOpen(false));
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-surface-500 hover:bg-surface-100 hover:text-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ top: pos.top, left: pos.left, width: 208 }}
            className="fixed z-50 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {actions.map((a, i) => (
              <button
                key={i}
                role="menuitem"
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
                className={classNames(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-40',
                  a.danger
                    ? 'text-rose-600 hover:bg-rose-50'
                    : 'text-surface-700 hover:bg-surface-100'
                )}
              >
                {a.icon && <span className="flex-none text-surface-400">{a.icon}</span>}
                <span className="truncate">{a.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
