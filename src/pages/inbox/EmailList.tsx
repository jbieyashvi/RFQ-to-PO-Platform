import { Paperclip, AlertTriangle, Sparkles } from 'lucide-react';
import type { InboxEmail } from '@/types';
import { StatusBadge, EmptyState } from '@/components/ui';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import { classNames, formatDateTime } from '@/lib/format';
import { confidenceBucket } from './helpers';

const confDot: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-500',
  low: 'bg-rose-500',
};

export function EmailList({
  emails,
  selectedId,
  onSelect,
}: {
  emails: InboxEmail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
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
        const bucket = confidenceBucket(e.aiConfidence);
        const active = e.id === selectedId;
        return (
          <li key={e.id}>
            <button
              onClick={() => onSelect(e.id)}
              className={classNames(
                'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50',
                active ? 'bg-brand-50' : 'hover:bg-surface-50',
                !e.read && !e.sent && 'bg-brand-50/30'
              )}
            >
              <div className="flex items-center gap-2">
                {!e.read && !e.sent && <span className="h-2 w-2 flex-none rounded-full bg-brand-600" title="Unread" />}
                <span className={classNames('truncate text-[13px]', !e.read && !e.sent ? 'font-semibold text-surface-900' : 'font-medium text-surface-700')}>
                  {e.senderName}
                </span>
                <span className="ml-auto flex-none text-[11px] text-surface-400">
                  {formatDateTime(e.sent && e.sentAt ? e.sentAt : e.receivedAt).replace(/,/, '')}
                </span>
              </div>
              <p className={classNames('truncate text-[13px]', !e.read && !e.sent ? 'font-medium text-surface-800' : 'text-surface-600')}>
                {e.subject}
              </p>
              <p className="truncate text-[11px] text-surface-400">{e.customerName ?? e.senderEmail}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge tone={cls.tone} label={cls.label} dot={false} className="!px-1.5 !py-0 !text-[10px]" />
                <span
                  title={`AI confidence ${e.aiConfidence}%`}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-1.5 py-0 text-[10px] font-medium text-surface-500"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  <span className={classNames('h-1.5 w-1.5 rounded-full', confDot[bucket])} />
                  {e.aiConfidence}%
                </span>
                {e.needsReview && !e.sent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                    <AlertTriangle className="h-2.5 w-2.5" /> Review
                  </span>
                )}
                {e.draftSaved && !e.sent && (
                  <span className="rounded-full bg-blue-50 px-1.5 py-0 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                    Draft
                  </span>
                )}
                {e.sent && (
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    Sent
                  </span>
                )}
                {e.attachments.length > 0 && (
                  <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] text-surface-400">
                    <Paperclip className="h-3 w-3" />
                    {e.attachments.length}
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
