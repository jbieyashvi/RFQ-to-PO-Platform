import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, FileText, Maximize2, Minimize2, Minus, Paperclip, Save, Send, X } from 'lucide-react';
import type { InboxEmail, OutgoingDraft, Quotation } from '@/types';
import { Button, Modal } from '@/components/ui';
import { DocumentLetterhead } from '@/components/DocumentLetterhead';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { classNames, formatINR, lineTotal } from '@/lib/format';
import { reviewDateError } from '@/lib/quotationWorkflow';
import { isValidEmail } from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const SENT_TS = '2026-08-13T12:45:00';
const TODAY = '2026-08-13';

type WindowState = 'normal' | 'minimized' | 'maximized';

const WIDTH = 520;

/**
 * The compose window — the ONE surface in the inbox that actually sends.
 *
 * The centre panel used to carry a permanently open "Outgoing Email" form, so
 * every email looked like it was mid-reply whether or not anybody intended to
 * write one, and half the panel was spent on a form nobody had asked for. This
 * replaces it: nothing is composed until the user asks for it — an
 * acknowledgement, a reply, or a generated quote handed over from the builder.
 *
 * It behaves like a mail client's compose window rather than a modal: docked
 * bottom-right, draggable by its header, minimise / maximise / close, and NO
 * overlay or scroll lock. The company list, the selected thread and the
 * quotation stay live behind it, which is the point — a reply is written while
 * reading the mail it answers, not instead of it.
 *
 * On send it does the whole handover in one step: the outgoing mail is added to
 * the inquiry conversation (same inquiryId, so it files under the thread it
 * belongs to), the quotation is marked Sent — which takes it out of Quotes
 * Pending to be Sent — and the chosen review date moves it on to Follow-up
 * Pending.
 */
export function ComposePopup({
  email,
  quotation,
  inquiryId,
  onClose,
}: {
  email: InboxEmail;
  /** The quotation attached to this mail, when the quote builder handed over. */
  quotation: Quotation | null;
  /** Conversation the sent mail is filed under. */
  inquiryId: string | null;
  onClose: () => void;
}) {
  const { updateEmail, updateQuotation, addEmail, addToast, canInbox, currentUser } = useApp();

  const canSend = canInbox('send');

  // Seeded once: the draft the email already carries (the quote builder writes
  // one when it attaches), otherwise a plain acknowledgement.
  const [draft, setDraft] = useState<OutgoingDraft>(() => email.draft ?? acknowledgement(email));
  const [reviewDate, setReviewDate] = useState(email.reviewDate ?? '');
  const [state, setState] = useState<WindowState>('normal');
  const [showPreview, setShowPreview] = useState(false);
  const [pos, setPos] = useState({ right: 20, bottom: 0 });

  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);

  const attachment = email.attachedQuote;
  const set = (patch: Partial<OutgoingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const dateError = reviewDateError(reviewDate);

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!isValidEmail(draft.to.trim())) out.push('a valid recipient address');
    if (!draft.subject.trim()) out.push('a subject');
    if (!draft.body.trim()) out.push('a message body');
    if (dateError) out.push('a next review date');
    return out;
  }, [draft, dateError]);

  const blocked = !canSend || blockers.length > 0;

  const saveDraft = () => {
    updateEmail(email.id, { draft, draftSaved: true, reviewDate: reviewDate || undefined });
    addToast({ type: 'success', title: 'Draft saved', message: 'This reply is kept with the email.' });
  };

  const removeAttachment = () => {
    updateEmail(email.id, { attachedQuote: undefined });
    addToast({
      type: 'info',
      title: 'Attachment removed',
      message: 'Re-open Generate Quote to attach the quotation again.',
    });
  };

  /**
   * Send. Everything the workflow needs to move happens here, in one place:
   * the conversation gains the outgoing mail, the enquiry stops asking for
   * review, and — when a quotation rode along — it leaves Quotes Pending for
   * Follow-up Pending on the date chosen above.
   */
  const send = () => {
    if (blocked) return;

    const cc = draft.cc
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // The sent mail is filed under the SAME inquiry as the email being
    // answered, so it appears inside the selected conversation rather than as a
    // loose message somewhere in the list.
    addEmail({
      id: `em-out-${email.id}-${Date.now()}`,
      senderName: currentUser.fullName,
      senderEmail: draft.from,
      recipient: draft.to,
      cc,
      subject: draft.subject,
      receivedAt: SENT_TS,
      body: draft.body,
      thread: [],
      classification: email.classification,
      aiConfidence: 100,
      read: true,
      needsReview: false,
      officeId: email.officeId,
      owner: email.owner,
      partyId: email.partyId,
      customerName: email.customerName,
      customerCode: email.customerCode,
      linkedQuotation: quotation?.number ?? email.linkedQuotation,
      linkedPO: email.linkedPO,
      linkedSO: email.linkedSO,
      inquiryId: inquiryId ?? email.inquiryId ?? quotation?.id,
      inquiryNo: email.inquiryNo,
      reviewDate,
      attachedQuote: attachment,
      extraction: [],
      extractionConfirmed: true,
      draftSaved: true,
      sent: true,
      sentAt: SENT_TS,
    });

    // The customer's own mail is NOT marked sent — it stays the incoming half
    // of the conversation. It only stops asking for a reply.
    updateEmail(email.id, {
      draft,
      draftSaved: true,
      read: true,
      needsReview: false,
      reviewDate,
    });

    if (quotation && attachment) {
      updateQuotation(quotation.id, {
        deliveryState: 'sent',
        workState: 'sent',
        stage: 'no_followup',
        sentAt: SENT_TS,
        sentBy: currentUser.fullName,
        sendChannel: 'Email (via Global Inbox)',
        sendFailureReason: undefined,
        reviewDate,
        lastUpdated: TODAY,
        activity: [
          ...quotation.activity,
          {
            id: `act-${quotation.id}-sent-${Date.now()}`,
            date: SENT_TS,
            actor: currentUser.fullName,
            action: 'Quotation emailed to customer',
            detail: `${attachment.fileName} → ${draft.to} · ${formatINR(attachment.quoteValue)}`,
          },
          {
            id: `act-${quotation.id}-fu-${Date.now()}`,
            date: SENT_TS,
            actor: currentUser.fullName,
            action: 'Moved to Follow-up Pending',
            detail: `Follow-up scheduled for ${reviewDate}`,
          },
        ],
      });
      addToast({
        type: 'success',
        title: 'Quotation sent successfully.',
        message: `${quotation.number} sent to ${draft.to} — moved from Quotes Pending to Follow-up Pending.`,
      });
    } else {
      addToast({
        type: 'success',
        title: 'Email sent',
        message: `Reply sent to ${draft.to} — added to this conversation. Next review ${reviewDate}.`,
      });
    }

    onClose();
  };

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (state !== 'normal') return;
    drag.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // Right/bottom anchored, so the window moves against the pointer delta.
    const right = clamp(d.right - (e.clientX - d.x), 0, Math.max(0, window.innerWidth - WIDTH));
    const bottom = clamp(d.bottom - (e.clientY - d.y), 0, Math.max(0, window.innerHeight - 120));
    setPos({ right, bottom });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const maximized = state === 'maximized';
  const minimized = state === 'minimized';

  const shellStyle = maximized
    ? undefined
    : { right: pos.right, bottom: pos.bottom, width: `min(${WIDTH}px, calc(100vw - 24px))` };

  return createPortal(
    <>
      <div
        role="dialog"
        aria-label="Compose email"
        style={shellStyle}
        className={classNames(
          'fixed z-50 flex flex-col overflow-hidden rounded-t-xl border border-surface-200 bg-white shadow-pop animate-slide-up',
          maximized && 'inset-x-4 bottom-4 top-6 mx-auto max-w-[1000px] rounded-xl'
        )}
      >
        {/* Header — the drag handle, and the only chrome left when minimised. */}
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onDoubleClick={() => setState(maximized ? 'normal' : 'maximized')}
          className={classNames(
            'flex flex-none items-center justify-between gap-2 bg-surface-800 px-3 py-2 text-white',
            state === 'normal' ? 'cursor-move touch-none' : 'cursor-default'
          )}
        >
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {quotation ? `Quotation ${quotation.number}` : draft.subject || 'New Message'}
          </p>
          <div className="flex flex-none items-center gap-0.5">
            <HeaderButton
              label={minimized ? 'Restore compose window' : 'Minimise compose window'}
              onClick={() => setState(minimized ? 'normal' : 'minimized')}
            >
              {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
            </HeaderButton>
            <HeaderButton
              label={maximized ? 'Restore down' : 'Maximise compose window'}
              onClick={() => setState(maximized ? 'normal' : 'maximized')}
            >
              {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </HeaderButton>
            <HeaderButton label="Close compose window" onClick={onClose}>
              <X className="h-4 w-4" />
            </HeaderButton>
          </div>
        </div>

        {!minimized && (
          <>
            <div
              className={classNames(
                'min-h-0 overflow-y-auto px-3 py-2.5',
                maximized ? 'flex-1' : 'max-h-[min(60vh,460px)] flex-1'
              )}
            >
              <Line label="From">
                <input
                  value={draft.from}
                  onChange={(e) => set({ from: e.target.value })}
                  className="w-full bg-transparent text-[12px] text-surface-700 outline-none"
                  aria-label="From"
                />
              </Line>
              <Line label="To">
                <input
                  value={draft.to}
                  onChange={(e) => set({ to: e.target.value })}
                  className="w-full bg-transparent text-[12px] text-surface-800 outline-none"
                  aria-label="To"
                  placeholder="recipient@example.com"
                />
              </Line>
              <Line label="Cc">
                <input
                  value={draft.cc}
                  onChange={(e) => set({ cc: e.target.value })}
                  className="w-full bg-transparent text-[12px] text-surface-700 outline-none"
                  aria-label="Cc"
                  placeholder="Comma separated"
                />
              </Line>
              <Line label="Subject">
                <input
                  value={draft.subject}
                  onChange={(e) => set({ subject: e.target.value })}
                  className="w-full bg-transparent text-[12px] font-medium text-surface-800 outline-none"
                  aria-label="Subject"
                />
              </Line>

              <textarea
                value={draft.body}
                onChange={(e) => set({ body: e.target.value })}
                rows={maximized ? 18 : 9}
                aria-label="Message body"
                className="mt-2 w-full resize-none bg-transparent text-[13px] leading-[19px] text-surface-800 outline-none"
              />

              {attachment && (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5">
                  <FileText className="h-4 w-4 flex-none text-brand-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-surface-800">{attachment.fileName}</p>
                    <p className="text-[11px] text-surface-500">
                      {attachment.fileType} · {attachment.sizeLabel ?? '—'} · {formatINR(attachment.quoteValue)}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowPreview(true)}
                    aria-label="Preview attachment"
                    title="Preview attachment"
                    className="rounded p-1 text-surface-400 hover:bg-white hover:text-brand-600"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={removeAttachment}
                    aria-label="Remove attachment"
                    title="Remove attachment"
                    className="rounded p-1 text-surface-400 hover:bg-white hover:text-rose-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-surface-100 pt-2">
                <label htmlFor="compose-review-date" className="text-[12px] font-medium text-surface-700">
                  Next Review Date <span className="text-rose-500">*</span>
                </label>
                <input
                  id="compose-review-date"
                  type="date"
                  value={reviewDate}
                  min={TODAY}
                  onChange={(e) => setReviewDate(e.target.value)}
                  className={classNames('input h-7 w-40 px-2 py-0 text-[12px]', dateError && 'input-error')}
                />
                {dateError && <p className="text-[11px] font-medium text-rose-600">{dateError}</p>}
              </div>
            </div>

            <div className="flex flex-none items-center justify-between gap-2 border-t border-surface-100 bg-surface-50/70 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Send className="h-3.5 w-3.5" />}
                  onClick={send}
                  disabled={blocked}
                  title={
                    !canSend
                      ? 'Your role cannot send from the inbox.'
                      : blockers.length
                        ? `Needs ${blockers.join(', ')}.`
                        : undefined
                  }
                >
                  Send
                </Button>
                <Button variant="ghost" size="sm" leftIcon={<Save className="h-3.5 w-3.5" />} onClick={saveDraft}>
                  Save Draft
                </Button>
              </div>
              {attachment ? (
                <p className="flex items-center gap-1 text-[11px] text-surface-500">
                  <Paperclip className="h-3 w-3" />1 attachment
                </p>
              ) : (
                blockers.length > 0 && <p className="text-[11px] text-surface-400">Needs {blockers.join(', ')}.</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Attachment preview — the quotation as the customer will receive it. */}
      {attachment && quotation && (
        <Modal
          open={showPreview}
          onClose={() => setShowPreview(false)}
          size="xl"
          title="Attachment Preview"
          subtitle={`${attachment.fileName} · ${formatINR(attachment.quoteValue)}`}
          footer={
            <Button variant="primary" onClick={() => setShowPreview(false)}>
              Close
            </Button>
          }
        >
          <DocumentLetterhead
            docTitle="Quotation"
            meta={<p className="font-semibold text-surface-800">{quotation.number}</p>}
          />
          <div className="mt-3 overflow-hidden rounded-xl border border-surface-200">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                  <th className="px-3 py-1.5 text-left">Item</th>
                  <th className="px-2 py-1.5 text-right">Qty</th>
                  <th className="px-2 py-1.5 text-right">Rate</th>
                  <th className="px-3 py-1.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {quotation.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-1.5">
                      <p className="font-medium text-surface-800">{it.description}</p>
                      <p className="text-[11px] text-surface-400">{it.itemCode}</p>
                    </td>
                    <td className="px-2 py-1.5 text-right text-surface-700">
                      {it.quantity} {it.unit}
                    </td>
                    <td className="px-2 py-1.5 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-surface-800">
                      {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
              <span className="text-[13px] font-semibold text-surface-700">Grand Total</span>
              <span className="text-[14px] font-bold text-surface-900">{formatINR(attachment.quoteValue)}</span>
            </div>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-surface-200 px-3 py-2.5 text-[12px] sm:grid-cols-3">
            <p><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-700">{quotation.paymentTerms}</span></p>
            <p><span className="text-surface-400">Delivery:</span> <span className="font-medium text-surface-700">{quotation.deliveryTerms}</span></p>
            <p><span className="text-surface-400">Warranty:</span> <span className="font-medium text-surface-700">{quotation.warranty}</span></p>
          </div>
        </Modal>
      )}
    </>,
    document.body
  );
}

function HeaderButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      // The header is a drag handle; stop the press from starting a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="rounded p-1 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
    >
      {children}
    </button>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-surface-100 py-1">
      <span className="w-12 flex-none text-[11px] font-medium text-surface-400">{label}</span>
      {children}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** A plain acknowledgement — what a reply starts as when no quote is attached. */
function acknowledgement(email: InboxEmail): OutgoingDraft {
  const contact = (email.senderName.split(' ')[0] || 'Sir/Madam').trim();
  return {
    from: email.recipient,
    to: email.senderEmail,
    cc: email.cc.join(', '),
    subject: `RE: ${email.subject}`,
    body:
      `Dear ${contact},\n\nThank you for your email. We acknowledge receipt and will revert shortly.\n\n` +
      emailSignature(email.owner, officeName(email.officeId)),
    aiGenerated: true,
  };
}
