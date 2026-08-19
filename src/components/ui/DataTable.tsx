import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { classNames } from '@/lib/format';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
  align?: 'left' | 'right' | 'center';
  /** Fixed column width, e.g. '120px'. Omit for a flexible (grow) column that absorbs slack. */
  width?: string;
  /** Minimum px used to compute the table's scroll threshold. Defaults from width, else 96 (grow) / 80. */
  minPx?: number;
  /** Wrap the cell in a single-line ellipsis container. */
  truncate?: boolean;
  /** Tooltip text for a truncated cell (shows full value on hover/focus). */
  title?: (row: T) => string;
  /** Pin this column while scrolling horizontally. */
  sticky?: 'left' | 'right';
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Optional extra classes per row (e.g. to highlight a freshly-created record). */
  rowClassName?: (row: T) => string | undefined;
  loading?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  stickyHeader?: boolean;
}

function parsePx(w?: string): number | undefined {
  if (!w) return undefined;
  const m = /([\d.]+)px/.exec(w);
  return m ? Number(m[1]) : undefined;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClassName,
  loading,
  emptyTitle = 'No records found',
  emptyMessage = 'Try adjusting your filters or search terms.',
  emptyAction,
  stickyHeader = true,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFades = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useLayoutEffect(() => {
    updateFades();
  }, [updateFades, columns, rows]);

  useEffect(() => {
    const onResize = () => updateFades();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateFades]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  let sorted = rows;
  if (sortKey) {
    const col = columns.find((c) => c.key === sortKey);
    if (col?.sortValue) {
      sorted = [...rows].sort((a, b) => {
        const av = col.sortValue!(a);
        const bv = col.sortValue!(b);
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
  }

  const alignClass = (a?: string) =>
    a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left';

  const minWidth = columns.reduce((sum, c) => {
    const w = parsePx(c.width) ?? c.minPx ?? (c.width ? 80 : 84);
    return sum + w;
  }, 0);

  const stickyCell = (col: Column<T>, kind: 'head' | 'body') => {
    if (!col.sticky) return '';
    const base = col.sticky === 'left' ? 'sticky left-0' : 'sticky right-0';
    const z = kind === 'head' ? 'z-20' : 'z-10';
    const bg = kind === 'head' ? 'bg-surface-50' : 'bg-white group-hover:bg-brand-50/40';
    // separating shadow only when the table is actually scrolled in that direction
    const shadow =
      col.sticky === 'left'
        ? fade.left && 'shadow-[6px_0_8px_-6px_rgba(15,23,42,0.18)]'
        : fade.right && 'shadow-[-6px_0_8px_-6px_rgba(15,23,42,0.18)]';
    return classNames(base, z, bg, shadow);
  };

  return (
    <div className="relative">
      <div ref={scrollRef} onScroll={updateFades} className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse" style={{ minWidth: `${minWidth}px` }}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={col.width ? { width: col.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr className={classNames('border-b border-surface-200 bg-surface-50', stickyHeader && 'sticky top-0 z-10')}>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                const canSort = !!col.sortValue;
                return (
                  <th
                    key={col.key}
                    className={classNames(
                      'whitespace-nowrap px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500',
                      alignClass(col.align),
                      stickyCell(col, 'head'),
                      col.headerClassName
                    )}
                  >
                    {canSort ? (
                      <button
                        onClick={() => toggleSort(col.key)}
                        className={classNames(
                          'inline-flex max-w-full items-center gap-1 align-middle hover:text-surface-700',
                          col.align === 'right' && 'flex-row-reverse',
                          col.align === 'center' && 'justify-center'
                        )}
                      >
                        <span className="truncate">{col.header}</span>
                        {isSorted ? (
                          sortDir === 'asc' ? (
                            <ChevronUp className="h-3 w-3 flex-none" />
                          ) : (
                            <ChevronDown className="h-3 w-3 flex-none" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 flex-none text-surface-300" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key} className={classNames('px-2.5 py-3', stickyCell(col, 'body'))}>
                      <div className="skeleton h-4 w-full max-w-[110px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} />
                </td>
              </tr>
            ) : (
              sorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={classNames(
                    'group transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-brand-50/40',
                    rowClassName?.(row)
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      title={col.truncate ? col.title?.(row) : undefined}
                      className={classNames(
                        'px-2.5 py-2 align-middle text-[12px] text-surface-700',
                        col.truncate ? 'overflow-hidden' : 'whitespace-nowrap',
                        alignClass(col.align),
                        stickyCell(col, 'body'),
                        col.className
                      )}
                    >
                      {col.truncate ? <div className="truncate">{col.render(row)}</div> : col.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Horizontal-scroll affordance: fade hints that more columns are available */}
      <div
        className={classNames(
          'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent transition-opacity',
          fade.right ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div
        className={classNames(
          'pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-white to-transparent transition-opacity',
          fade.left ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  );
}
