import { useEffect, useRef } from 'react';
import { Layers } from 'lucide-react';
import type { InboxEmail } from '@/types';
import { StatusBadge, EmptyState } from '@/components/ui';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import { classNames, formatDateTime } from '@/lib/format';

export function EmailList({
  emails,
  selectedId,
  onSelect,
  inquiryIds,
}: {
  emails: InboxEmail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Ids of the emails belonging to the inquiry currently grouped, so the full
  // list shows which of its rows the bundle above is made of.
  inquiryIds?: Set<string>;
}) {
  // Scroll the selected email into view (e.g. when arriving via a deep link from
  // the SO Revisions list), so the highlighted row is always visible.
  const selectedRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (selectedId && selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedId]);

  if (emails.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="No emails" message="No emails match the current tab and filters." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-surface-100">
      {emails.map((e) => {
        const cls = INBOX_CLASSIFICATION[e.classification];
        const active = e.id === selectedId;
        // A single, non-duplicated lifecycle chip (Sent › Draft) — the AI score,
        // sparkle and the repeated "Review" chip were removed to keep each row
        // scannable. "Needs review" already has its own tab.
        const statusChip = e.sent
          ? { label: 'Sent', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }
          : e.draftSaved
          ? { label: 'Draft', cls: 'bg-blue-50 text-blue-700 ring-blue-200' }
          : null;
        return (
          <li key={e.id} ref={active ? selectedRef : undefined}>
            <button
              onClick={() => onSelect(e.id)}
              className={classNames(
                // 3px left indicator on every row keeps text alignment steady;
                // only the selected row lights up the brand colour + background.
                // A tight 3-line layout keeps rows in the 84–96px band so ~7–8
                // fit on screen at desktop widths.
                'flex min-h-[84px] w-full flex-col justify-center gap-1 border-l-[3px] px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50',
                active ? 'border-brand-600 bg-brand-50' : 'border-transparent hover:bg-surface-50',
                !active && !e.read && !e.sent && 'bg-brand-50/30'
              )}
            >
              <div className="flex items-center gap-2">
                {!e.read && !e.sent && <span className="h-2 w-2 flex-none rounded-full bg-brand-600" title="Unread" />}
                {inquiryIds?.has(e.id) && (
                  <span className="flex-none text-brand-500" title="Part of the grouped inquiry" aria-label="Part of the grouped inquiry">
                    <Layers className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className={classNames('min-w-0 flex-1 truncate text-[13px]', !e.read && !e.sent ? 'font-semibold text-surface-900' : 'font-medium text-surface-700')}>
                  {e.senderName}
                </span>
                <span className="flex-none text-[12px] text-surface-400">
                  {formatDateTime(e.sent && e.sentAt ? e.sentAt : e.receivedAt).replace(/,/, '')}
                </span>
              </div>
              <p className={classNames('truncate text-[13px]', !e.read && !e.sent ? 'font-medium text-surface-800' : 'text-surface-600')}>
                {e.subject}
              </p>
              {/* Customer/company and the single classification badge share one
                  line to keep the row compact (3 lines total). */}
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[12px] text-surface-400">{e.customerName ?? e.senderEmail}</p>
                <StatusBadge tone={cls.tone} label={cls.label} dot={false} className="!px-1.5 !py-0 !text-[11px] flex-none" />
                {statusChip && (
                  <span className={classNames('flex-none rounded-full px-1.5 py-0 text-[11px] font-medium ring-1 ring-inset', statusChip.cls)}>
                    {statusChip.label}
                  </span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Compact icon rail — the minimized form of the email list, shown while the SO
 * Generation drawer is open (or when the user collapses the list manually).
 * One initials circle per email; the selected one is filled with the brand
 * colour, unread ones carry a dot. Hover shows sender + subject.
 */
export function EmailIconRail({
  emails,
  selectedId,
  onSelect,
}: {
  emails: InboxEmail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const initialsOf = (e: InboxEmail) => {
    const name = (e.customerName ?? e.senderName).trim();
    const words = name.split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
  };

  return (
    <ul className="flex flex-col items-center gap-1.5 py-2">
      {emails.map((e) => {
        const active = e.id === selectedId;
        const unread = !e.read && !e.sent;
        return (
          <li key={e.id} className="relative">
            <button
              onClick={() => onSelect(e.id)}
              title={`${e.senderName} — ${e.subject}`}
              aria-label={`${e.senderName} — ${e.subject}`}
              className={classNames(
                'flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                active
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
              )}
            >
              {initialsOf(e)}
            </button>
            {unread && (
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand-600 ring-2 ring-white" title="Unread" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
