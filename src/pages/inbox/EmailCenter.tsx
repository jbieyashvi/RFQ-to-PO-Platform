import { useEffect, useState } from 'react';
import {
  Building2,
  UserRound,
  CheckCircle2,
  Tags,
  ChevronDown,
  MessageSquare,
  History,
  ArrowDownLeft,
  ArrowUpRight,
  Paperclip,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';
import type { EmailClassification, InboxEmail } from '@/types';
import { StatusBadge, Button } from '@/components/ui';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import { COMPANY_DOMAIN } from '@/lib/brand';
import { officeName } from '@/data/offices';
import { classNames, formatDateTime } from '@/lib/format';
import { useApp } from '@/context/AppContext';

export function EmailCenter({
  email,
  embedded,
}: {
  email: InboxEmail;
  embedded?: boolean;
}) {
  const { updateEmail, canInbox, addToast } = useApp();
  const cls = INBOX_CLASSIFICATION[email.classification];
  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  // Older thread messages live in a collapsed "Previous Conversation"
  // accordion — only the latest email (and our sent reply) stay visible.
  const [prevOpen, setPrevOpen] = useState(false);

  // Reset the disclosure whenever the selected email changes.
  useEffect(() => {
    setPrevOpen(false);
  }, [email.id]);

  const canClassify = canInbox('classify');

  const reclassify = (c: EmailClassification) => {
    updateEmail(email.id, { classification: c });
    setReclassifyOpen(false);
    addToast({ type: 'success', title: 'Email reclassified', message: `Classification set to ${INBOX_CLASSIFICATION[c].label}.` });
  };

  // ---- Conversation direction (presentation only — email data is untouched).
  // A message is "ours" when its sender is the email owner or a company
  // address; thread `from` values can be either a person name or an address.
  const fromCompany = (from: string) => from === email.owner || from.includes(COMPANY_DOMAIN);
  const msgName = (from: string) => (from.includes('@') ? (fromCompany(from) ? email.owner : email.senderName) : from);
  const msgAddress = (from: string) => (from.includes('@') ? from : fromCompany(from) ? email.recipient : email.senderEmail);
  // Older messages first so the thread reads top-to-bottom like a conversation.
  const priorMessages = [...email.thread].sort((a, b) => a.date.localeCompare(b.date));
  // Outgoing records (sent-item history) carry a company sender — render them
  // as "Sent by You" even though they are the selected email.
  const mainSent = fromCompany(email.senderName) || email.senderEmail.includes(COMPANY_DOMAIN);
  // Once the reply has been sent, show it as the latest bubble of the thread.
  const sentReply = !mainSent && email.sent && email.draft ? email.draft : null;

  return (
    // `embedded` renders the reader as flowing content (no own height / scroll)
    // so the centre panel can stack the email above the reply composer inside a
    // single shared scroll area. Standalone (dedicated workflows) keeps h-full.
    <div className={embedded ? '' : 'flex h-full flex-col'}>
      {/* Header — sticky so the subject + meta stay visible while the thread
          scrolls (embedded = inside the centre panel's shared scroll area). */}
      <div className={classNames('border-b border-surface-100 bg-white px-3.5 py-2.5', embedded ? 'sticky top-0 z-10' : 'flex-none')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-[15px] font-semibold leading-snug text-surface-900">{email.subject}</h2>
          <div className="flex items-center gap-2">
            <StatusBadge tone={cls.tone} label={cls.label} />
            {canClassify && (
              <div className="relative">
                <Button variant="secondary" size="sm" leftIcon={<Tags className="h-3.5 w-3.5" />} rightIcon={<ChevronDown className="h-3.5 w-3.5" />} onClick={() => setReclassifyOpen((v) => !v)}>
                  Reclassify
                </Button>
                {reclassifyOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop">
                    {(Object.keys(INBOX_CLASSIFICATION) as EmailClassification[]).map((c) => (
                      <button
                        key={c}
                        onClick={() => reclassify(c)}
                        className={classNames(
                          'flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[13px] hover:bg-surface-50',
                          c === email.classification ? 'font-medium text-brand-700' : 'text-surface-700'
                        )}
                      >
                        {INBOX_CLASSIFICATION[c].label}
                        {c === email.classification && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Two columns only while the panel itself is wide enough for them —
            the centre column is narrower than the viewport, so the split is
            driven by the container, never by a viewport breakpoint. */}
        <div className="mt-2 grid gap-x-5 gap-y-0.5 text-[11px] [grid-template-columns:repeat(auto-fit,minmax(210px,1fr))] [&>p]:min-w-0 [&>p]:break-words">
          <p><span className="text-surface-400">From:</span> <span className="font-medium text-surface-700">{email.senderName}</span> &lt;{email.senderEmail}&gt;</p>
          <p><span className="text-surface-400">To:</span> <span className="text-surface-700">{email.recipient}</span></p>
          {email.cc.length > 0 && <p><span className="text-surface-400">Cc:</span> <span className="text-surface-700">{email.cc.join(', ')}</span></p>}
          <p><span className="text-surface-400">Received:</span> <span className="text-surface-700">{formatDateTime(email.receivedAt)}</span></p>
        </div>
      </div>

      {/* Conversation — chat-style bubbles, presentation only (data untouched).
          Older thread messages first, then the selected email, then (once sent)
          our reply. Direction: the email owner / a company address = sent by us,
          everything else = from the client. */}
      <div className={classNames('px-3.5 py-2.5', !embedded && 'flex-1 overflow-y-auto')}>
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
            <MessageSquare className="h-3.5 w-3.5" /> Conversation ({priorMessages.length + 1 + (sentReply ? 1 : 0)})
          </p>

          {/* Previous Conversation — collapsed by default; only the count shows.
              The latest email (below) always stays visible outside it. */}
          {priorMessages.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-surface-200">
              <button
                type="button"
                onClick={() => setPrevOpen((v) => !v)}
                aria-expanded={prevOpen}
                className="flex w-full items-center justify-between gap-2 bg-surface-50/70 px-3.5 py-2 text-left transition-colors hover:bg-surface-100/70"
              >
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-600">
                  <History className="h-3.5 w-3.5 text-surface-400" />
                  Previous Conversation
                  <span className="rounded-full bg-surface-200/80 px-1.5 py-0.5 text-[11px] font-semibold text-surface-600">
                    {priorMessages.length} message{priorMessages.length === 1 ? '' : 's'}
                  </span>
                </span>
                <ChevronDown className={classNames('h-4 w-4 flex-none text-surface-400 transition-transform', prevOpen && 'rotate-180')} />
              </button>
              {prevOpen && (
                <div className="space-y-3 border-t border-surface-100 bg-surface-50/40 px-3 py-2.5">
                  {priorMessages.map((m) => {
                    const sent = fromCompany(m.from);
                    return (
                      <MessageBubble
                        key={m.id}
                        direction={sent ? 'sent' : 'received'}
                        name={msgName(m.from)}
                        address={msgAddress(m.from)}
                        timestamp={m.date}
                      >
                        <p className="text-[12px] leading-[1.5] text-surface-600">{m.snippet}</p>
                      </MessageBubble>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* The selected email — highlighted while it is the latest message. */}
          <MessageBubble
            direction={mainSent ? 'sent' : 'received'}
            name={email.senderName}
            address={email.senderEmail}
            timestamp={email.receivedAt}
            highlight={!sentReply}
          >
            <div className="whitespace-pre-wrap text-[13px] leading-[1.5] text-surface-700">{email.body}</div>

            {/* Related details stay inside this message's bubble. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-surface-200 bg-surface-50/60 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">Related</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-surface-600">
                <Building2 className="h-3 w-3 text-surface-400" /> {officeName(email.officeId)}
              </span>
              <span className="text-surface-300">·</span>
              <span className="inline-flex items-center gap-1 text-[12px] text-surface-600">
                <UserRound className="h-3 w-3 text-surface-400" /> {email.owner}
              </span>
              {email.customerName && (
                <>
                  <span className="text-surface-300">·</span>
                  <span className="text-[12px] font-medium text-surface-700">{email.customerName}{email.customerCode ? ` · ${email.customerCode}` : ''}</span>
                </>
              )}
              {email.inquiryNo && <span className="chip !py-0 !text-[11px] !text-amber-700 !bg-amber-50 !border-amber-200">Inquiry: {email.inquiryNo}</span>}
              {email.linkedQuotation && <span className="chip !py-0 !text-[11px] !text-brand-700 !bg-brand-50 !border-brand-200">Quote: {email.linkedQuotation}</span>}
              {email.linkedPO && <span className="chip !py-0 !text-[11px] !text-violet-700 !bg-violet-50 !border-violet-200">PO: {email.linkedPO}</span>}
              {email.linkedSO && <span className="chip !py-0 !text-[11px] !text-teal-700 !bg-teal-50 !border-teal-200">SO: {email.linkedSO}</span>}
            </div>
          </MessageBubble>

          {/* Our sent reply — attachments stay inside its bubble. */}
          {sentReply && (
            <MessageBubble
              direction="sent"
              name={email.owner}
              address={sentReply.from}
              timestamp={email.sentAt ?? email.receivedAt}
              highlight
            >
              {sentReply.subject && <p className="text-[12px] font-semibold text-surface-800">{sentReply.subject}</p>}
              <div className="mt-1 whitespace-pre-wrap text-[13px] leading-[1.5] text-surface-700">{sentReply.body}</div>
              {(email.attachedQuote || email.attachedSalesOrder) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-surface-500">
                    <Paperclip className="h-3 w-3" /> Attachments
                  </span>
                  {email.attachedQuote && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2 py-1 text-[11px] font-medium text-surface-700">
                      <FileText className="h-3.5 w-3.5 text-brand-600" />
                      {email.attachedQuote.qtnNumber}
                      {email.attachedQuote.version ? ` · ${email.attachedQuote.version}` : ''} · {email.attachedQuote.fileType}
                    </span>
                  )}
                  {email.attachedSalesOrder && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2 py-1 text-[11px] font-medium text-surface-700">
                      <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" />
                      {email.attachedSalesOrder.soNumber}
                      {email.attachedSalesOrder.revisionLabel ? ` · ${email.attachedSalesOrder.revisionLabel}` : ''} · {email.attachedSalesOrder.fileType}
                    </span>
                  )}
                </div>
              )}
            </MessageBubble>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One conversation bubble. Received (client) messages sit left on a neutral
 * white card; sent (company) messages sit right on a light brand-red card.
 * `highlight` rings the currently selected / latest message.
 */
function MessageBubble({
  direction,
  name,
  address,
  timestamp,
  highlight,
  children,
}: {
  direction: 'received' | 'sent';
  name: string;
  address: string;
  timestamp: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const received = direction === 'received';
  return (
    <div className={classNames('flex', received ? 'justify-start pr-6 sm:pr-12' : 'justify-end pl-6 sm:pl-12')}>
      <div
        className={classNames(
          'w-full rounded-xl border px-3.5 py-2.5 shadow-sm',
          received ? 'border-surface-200 bg-white' : 'border-brand-200 bg-brand-50/80',
          highlight && 'border-brand-300 ring-2 ring-brand-400/40'
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span
            className={classNames(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              received ? 'bg-surface-100 text-surface-600' : 'bg-brand-100 text-brand-700'
            )}
          >
            {received ? <ArrowDownLeft className="h-3 w-3" /> : <ArrowUpRight className="h-3 w-3" />}
            {received ? 'From Client' : 'Sent by You'}
          </span>
          <span className="text-[11px] text-surface-400">{formatDateTime(timestamp)}</span>
        </div>
        <p className="mt-1 text-[12px]">
          <span className="font-medium text-surface-800">{name}</span>{' '}
          <span className="text-surface-400">&lt;{address}&gt;</span>
        </p>
        <div className="mt-1.5">{children}</div>
      </div>
    </div>
  );
}
