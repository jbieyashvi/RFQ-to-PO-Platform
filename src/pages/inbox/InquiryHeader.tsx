import { Layers } from 'lucide-react';
import { officeName } from '@/data/offices';
import type { Inquiry } from '@/lib/inquiry';

/**
 * The compact inquiry header above the conversation: which inquiry the open
 * email belongs to (inquiry no, quotation, customer, owner, office).
 *
 * Identity only — the inquiry's other emails are NOT listed here. They are
 * already in the left panel, which is scoped to this customer, so listing them
 * again in the centre would duplicate the same list twice on one screen and
 * push the conversation itself out of view.
 */
export function InquiryHeader({ inquiry }: { inquiry: Inquiry }) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-brand-100 bg-brand-50/50 px-3 py-2">
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
    </div>
  );
}
