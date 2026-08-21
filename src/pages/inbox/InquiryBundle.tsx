import { useState } from 'react';
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, ChevronDown, Layers } from 'lucide-react';
import { StatusBadge } from '@/components/ui';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import { officeName } from '@/data/offices';
import { classNames, formatDateTime } from '@/lib/format';
import { emailTimeOf, type Inquiry } from '@/lib/inquiry';
import type { InboxEmail } from '@/types';

/**
 * The inquiry bundle that sits above the conversation: a compact inquiry header
 * (inquiry id, customer, owner, office) and the SMALL list of only this
 * inquiry's emails — however many separate threads they arrived in.
 *
 * It never replaces the inbox. The full classified list stays exactly where it
 * is on the left; this is the grouped view of the selected inquiry beside it,
 * and "Back to All Emails" drops the grouping without changing the inbox.
 */
export function InquiryBundle({
  inquiry,
  emails,
  selectedId,
  onSelect,
  onExit,
}: {
  inquiry: Inquiry;
  emails: InboxEmail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onExit: () => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="flex-none border-b border-brand-100 bg-brand-50/50">
      {/* Compact inquiry header */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 py-2">
        <Layers className="h-4 w-4 flex-none text-brand-600" />
        <span className="text-[13px] font-semibold text-surface-900">{inquiry.number}</span>
        <span className="chip !border-brand-200 !bg-white !py-0 !text-[11px] !text-brand-700">
          {inquiry.quotationNumber}
        </span>
        <span className="max-w-[220px] truncate text-[12px] text-surface-700">{inquiry.customerName}</span>
        <span className="text-[12px] text-surface-500">
          Owner: <span className="font-medium text-surface-700">{inquiry.owner}</span>
        </span>
        <span className="text-[12px] text-surface-500">
          Office: <span className="font-medium text-surface-700">{officeName(inquiry.officeId)}</span>
        </span>
        <button
          onClick={onExit}
          className="ml-auto inline-flex h-7 flex-none items-center gap-1 rounded-lg border border-surface-200 bg-white px-2 text-[12px] font-medium text-surface-600 transition-colors hover:bg-surface-50 hover:text-surface-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to All Emails
        </button>
      </div>

      {/* The inquiry's own email list — every thread carrying this inquiry id */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 border-t border-brand-100/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 transition-colors hover:bg-brand-50"
      >
        <ChevronDown className={classNames('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} />
        {emails.length} email{emails.length === 1 ? '' : 's'} in this inquiry
      </button>
      {open && (
        <ul className="max-h-[164px] divide-y divide-surface-100 overflow-y-auto border-t border-brand-100/80 bg-white">
          {emails.map((e) => {
            const cls = INBOX_CLASSIFICATION[e.classification];
            const active = e.id === selectedId;
            return (
              <li key={e.id}>
                <button
                  onClick={() => onSelect(e.id)}
                  className={classNames(
                    'flex w-full items-center gap-2 border-l-[3px] px-3 py-1.5 text-left transition-colors',
                    active ? 'border-brand-600 bg-brand-50' : 'border-transparent hover:bg-surface-50'
                  )}
                >
                  {e.sent ? (
                    <ArrowUpRight className="h-3.5 w-3.5 flex-none text-emerald-600" aria-label="Sent" />
                  ) : (
                    <ArrowDownLeft className="h-3.5 w-3.5 flex-none text-surface-400" aria-label="Received" />
                  )}
                  <span
                    className={classNames(
                      'min-w-0 flex-1 truncate text-[12.5px]',
                      active ? 'font-semibold text-surface-900' : 'text-surface-700'
                    )}
                  >
                    {e.subject}
                  </span>
                  <StatusBadge tone={cls.tone} label={cls.label} dot={false} className="!px-1.5 !py-0 !text-[10.5px] flex-none" />
                  <span className="flex-none text-[11px] text-surface-400">
                    {formatDateTime(emailTimeOf(e)).replace(/,/, '')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
