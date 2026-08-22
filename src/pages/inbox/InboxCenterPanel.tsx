import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Ban,
  Send,
  Eye,
  Save,
  FileText,
  Paperclip,
  X,
  CalendarClock,
} from 'lucide-react';
import type { InboxEmail, OutgoingDraft, Quotation } from '@/types';
import { Button, IconButton, TextField, TextAreaField, Modal } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { classNames, formatINR, lineTotal } from '@/lib/format';
import { TODAY_ISO } from '@/lib/quotationWorkflow';
import { EmailCenter } from './EmailCenter';
import { sendBlockers, isValidEmail, quoteSignature, quoteSendBlockers } from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const SENT_TS = '2026-08-13T12:45:00';

export type ComposeMode = 'normal' | 'quote-send';

function templateFor(email: InboxEmail): OutgoingDraft {
  const greeting = `Dear ${email.senderName.split(' ')[0] || 'Sir/Madam'},`;
  return {
    from: email.recipient,
    to: email.senderEmail,
    cc: email.cc.join(', '),
    subject: `RE: ${email.subject}`,
    body: `${greeting}\n\nThank you for your email. We acknowledge receipt and will revert shortly.\n\n${emailSignature(email.owner, officeName(email.officeId))}`,
    relatedDoc: email.linkedQuotation ?? email.linkedPO ?? email.linkedSO ?? '',
    aiGenerated: true,
  };
}

// A blank reply scaffold for the quotation send — the right panel fills in the
// real To / Subject / Body when it prepares the composer.
function blankDraft(email: InboxEmail): OutgoingDraft {
  return {
    from: email.recipient,
    to: email.senderEmail,
    cc: email.cc.join(', '),
    subject: '',
    body: '',
    relatedDoc: email.linkedQuotation ?? email.linkedPO ?? '',
    aiGenerated: false,
  };
}

const COMPOSE_HEADING: Record<ComposeMode, string> = {
  'quote-send': 'Reply — Send Quotation',
  normal: 'Outgoing Email',
};

/**
 * The centre panel of the Global Inbox: the selected conversation, and — for
 * the first send of a quotation only — the composer that finalises it.
 *
 * Every other workflow (a quote revision, PO vs Quote verification, a Sales
 * Order revision) is worked in the right-hand panel and answered from the
 * Gmail-style compose window, so the centre column stays the thread and
 * nothing else.
 */
export function InboxCenterPanel({
  email,
  mode = 'normal',
  quotation = null,
  focusTick = 0,
}: {
  email: InboxEmail;
  mode?: ComposeMode;
  quotation?: Quotation | null;
  focusTick?: number;
}) {
  const { updateEmail, canInbox, addToast, quotations, updateQuotation, currentUser, role } = useApp();

  const isWorkflow = mode !== 'normal';

  const [draft, setDraft] = useState<OutgoingDraft>(
    email.draft ?? (isWorkflow ? blankDraft(email) : templateFor(email))
  );
  const [reviewDate, setReviewDate] = useState<string>(email.reviewDate ?? quotation?.reviewDate ?? '');
  const [attachPreview, setAttachPreview] = useState(false);

  const composerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(email.draft ?? (isWorkflow ? blankDraft(email) : templateFor(email)));
    setReviewDate(email.reviewDate ?? quotation?.reviewDate ?? '');
    setAttachPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id]);

  // A right-panel action just PREPARED this composer — pull in the freshly
  // written draft / review date and bring the composer into view + focus.
  useEffect(() => {
    if (focusTick <= 0) return;
    if (email.draft) setDraft(email.draft);
    setReviewDate(email.reviewDate ?? quotation?.reviewDate ?? '');
    const t = setTimeout(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Focus the first editable field (To) — skip the disabled From input.
      composerRef.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  const canDraft = canInbox('draft_reply');
  const canSend = canInbox('send');
  const canApprove = canInbox('approve');

  // Both remaining modes send a document out for the first time, so both need
  // approve + send.
  const permissionOk = canSend && canApprove;
  const permissionMessage =
    role === 'sales_user'
      ? 'Approval required from Office Admin or Super Admin.'
      : 'You do not have permission to approve & send this email.';

  const readOnly = email.sent || !canDraft;
  const setD = <K extends keyof OutgoingDraft>(k: K, v: OutgoingDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // Only the quotation send carries a system-generated attachment.
  const requireAttachment = mode === 'quote-send';

  const attachmentStale = !!(
    requireAttachment &&
    quotation &&
    email.attachedQuote &&
    email.attachedQuote.signature !== quoteSignature(quotation)
  );

  // ---- Blockers (differ by mode) ----
  const workingEmail: InboxEmail = { ...email, draft };
  const normalBlockers = useMemo(() => sendBlockers(workingEmail), [workingEmail]);
  const quoteBlockersBase = useMemo(
    () =>
      quoteSendBlockers({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        reviewDate,
        hasAttachment: !!email.attachedQuote,
        attachmentStale,
      }),
    [draft.to, draft.subject, draft.body, reviewDate, email.attachedQuote, attachmentStale]
  );
  const baseBlockers = mode === 'quote-send' ? quoteBlockersBase : normalBlockers;
  const blockers = permissionOk ? baseBlockers : [...baseBlockers, permissionMessage];
  const canFinalSend = blockers.length === 0;

  const blockReason = !permissionOk
    ? permissionMessage
    : baseBlockers.length > 0
    ? mode === 'normal'
      ? 'Complete classification and confirm the extracted details before sending.'
      : baseBlockers[0]
    : '';

  const saveDraft = () => {
    updateEmail(email.id, { draft, draftSaved: true, ...(isWorkflow ? { reviewDate } : {}) });
    addToast({ type: 'success', title: 'Draft saved', message: `Reply to ${email.senderName} saved as draft.` });
  };

  const removeAttachment = () => {
    updateEmail(email.id, { attachedQuote: undefined });
    addToast({ type: 'info', title: 'Attachment removed', message: 'The quotation PDF was removed from the email.' });
  };

  // ---- Quote-send mode send (Send Email) ----
  const sendQuote = () => {
    if (!canFinalSend || !quotation) return;
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: SENT_TS, needsReview: false, reviewDate });
    updateQuotation(quotation.id, {
      deliveryState: 'sent',
      workState: 'sent',
      // Sent quotes enter the follow-up pipeline: stage "No Follow-up" with the
      // mandatory next review date = Follow-up Pending.
      stage: 'no_followup',
      sentAt: SENT_TS,
      sentBy: currentUser.fullName,
      sendChannel: 'Email (via Global Inbox)',
      sendFailureReason: undefined,
      reviewDate,
      lastUpdated: '2026-08-13',
      activity: [
        ...quotation.activity,
        {
          id: `act-${Date.now()}`,
          date: SENT_TS,
          actor: currentUser.fullName,
          action: 'Quotation emailed to customer',
          detail: `${email.attachedQuote?.fileName ?? quotation.number} → ${draft.to} · next review ${reviewDate}`,
        },
        {
          id: `act-${Date.now()}-fu`,
          date: SENT_TS,
          actor: currentUser.fullName,
          action: 'Moved to Follow-up Pending',
          detail: `Follow-up scheduled for ${reviewDate}`,
        },
      ],
    });
    addToast({ type: 'success', title: 'Quotation sent successfully.', message: `${quotation.number} sent to ${draft.to} — moved from Quotes Pending to Follow-up Pending.` });
  };

  const heading = COMPOSE_HEADING[mode];

  return (
    <div className="flex h-full flex-col">
      {/* Thread — independently scrollable above the pinned composer */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The centre panel is the conversation, nothing else: confirming what
            the AI read happens on the right — line by line for an enquiry, in
            its own workspace for every other workflow. */}
        <EmailCenter email={email} embedded />
      </div>

      {/* Composer — the quotation send only.
          Normal mail used to carry this form open at all times, so every email
          looked half-answered and the thread was squeezed into the space left
          over. Every other reply is now written in the compose window, opened
          on purpose from the workspace on the right — which leaves the whole
          centre panel to the conversation being read. */}
      {isWorkflow && (
      <div className="max-h-[40%] flex-none overflow-y-auto border-t border-surface-100">
        <div ref={composerRef} className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{heading}</p>
            {draft.aiGenerated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                <Sparkles className="h-2.5 w-2.5" /> AI-drafted
              </span>
            )}
          </div>

          {email.sent && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Sent on {email.sentAt?.slice(0, 10)} — read-only.
            </div>
          )}

          <div className="space-y-2.5">
            <TextField label="From" value={draft.from} disabled onChange={() => {}} className="py-1.5 text-[13px]" />
            <TextField
              label="To"
              required
              value={draft.to}
              onChange={(e) => setD('to', e.target.value)}
              disabled={readOnly}
              error={!isValidEmail(draft.to) ? 'Valid recipient required' : undefined}
              className="py-1.5 text-[13px]"
            />
            <TextField label="Cc" value={draft.cc} onChange={(e) => setD('cc', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" />
            <TextField label="Subject" required value={draft.subject} onChange={(e) => setD('subject', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" />
            <TextAreaField label="Body" required rows={8} value={draft.body} onChange={(e) => setD('body', e.target.value)} disabled={readOnly} className="text-[13px]" />

            {isWorkflow ? (
              <>
                {/* Required next review date */}
                <TextField
                  label="Next Review Date"
                  type="date"
                  required
                  min={TODAY_ISO}
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                  disabled={readOnly}
                  error={!reviewDate ? 'Next review date is required' : undefined}
                  className="py-1.5 text-[13px]"
                />

                {/* Attachment chip — only for sends that carry a quotation PDF */}
                {requireAttachment && (
                  <div>
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-surface-500">
                      <Paperclip className="h-3.5 w-3.5" /> Attached Quotation
                    </p>
                    {email.attachedQuote ? (
                      <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                        <FileText className="h-4 w-4 flex-none text-brand-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium text-surface-800">{email.attachedQuote.qtnNumber}</p>
                          <p className="truncate text-[11px] text-surface-500">
                            {email.attachedQuote.version ? `${email.attachedQuote.version} · ` : ''}
                            {email.attachedQuote.fileType}
                            {email.attachedQuote.sizeLabel ? ` · ${email.attachedQuote.sizeLabel}` : ''}
                          </p>
                        </div>
                        {quotation && (
                          <button onClick={() => setAttachPreview(true)} className="flex-none rounded p-1 text-surface-400 transition-colors hover:bg-white hover:text-brand-600" title="Preview attachment">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {!email.sent && (
                          <button onClick={removeAttachment} className="flex-none rounded p-1 text-surface-400 transition-colors hover:bg-white hover:text-rose-600" title="Remove attachment">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-lg border border-dashed border-surface-300 bg-surface-50 px-3 py-2 text-[12px] text-surface-500">
                        <Paperclip className="h-4 w-4 flex-none" />
                        No quotation attached — use “Add Corrected Quote to Email” in the workspace.
                      </div>
                    )}
                    {attachmentStale && !email.sent && (
                      <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5 flex-none" /> The quotation has changed. Add the latest version before sending.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Related Document" value={draft.relatedDoc ?? ''} onChange={(e) => setD('relatedDoc', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" placeholder="QTN / PO / SO no." />
                <TextField label="Amount (₹)" type="number" value={draft.amount ?? ''} onChange={(e) => setD('amount', e.target.value ? Number(e.target.value) : undefined)} disabled={readOnly} className="py-1.5 text-[13px]" />
              </div>
            )}

            {/* Blockers */}
            {!email.sent && blockers.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800"><ShieldCheck className="h-3.5 w-3.5" /> Send is blocked:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-amber-700">
                  {blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Normal mail keeps a one-line status strip where the form used to be,
          so "already replied" is still readable at a glance. */}
      {!isWorkflow && (email.sent || email.draftSaved) && (
        <div className="flex-none border-t border-surface-100 bg-surface-50/60 px-4 py-2">
          {email.sent ? (
            <p className="flex items-center gap-1.5 text-[12px] text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 flex-none" /> Replied on {email.sentAt?.slice(0, 10)}.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-[12px] text-surface-500">
              <Save className="h-3.5 w-3.5 flex-none" /> Draft saved — reopen the reply from the Business Action panel.
            </p>
          )}
        </div>
      )}

      {/* Footer actions */}
      {!email.sent && isWorkflow && (
        <div className="flex-none border-t border-surface-100 bg-surface-50/60 px-4 py-3">
          {/* Secondary Save Draft is a compact icon button; the primary Send
              Email keeps its visible text label. */}
          <div className="flex items-center gap-2">
            <IconButton label="Save Draft" icon={<Save className="h-4 w-4" />} onClick={saveDraft} disabled={!canDraft} />
            <Button
              variant="primary"
              size="sm"
              className="min-w-0 flex-1"
              leftIcon={canFinalSend ? <Send className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              onClick={sendQuote}
              disabled={!canFinalSend}
              title={blockReason || 'Send this email'}
            >
              Send Email
            </Button>
          </div>
          {!canFinalSend && blockReason && (
            <p className={classNames('mt-1.5 flex items-center justify-center gap-1 text-center text-[11px]', !permissionOk ? 'font-medium text-rose-600' : 'text-amber-600')}>
              {isWorkflow && <CalendarClock className="h-3 w-3 flex-none" />}
              {blockReason}
            </p>
          )}
        </div>
      )}

      {/* Attachment preview — read-only quotation exactly as attached */}
      {quotation && (
        <Modal
          open={attachPreview}
          onClose={() => setAttachPreview(false)}
          size="lg"
          title="Quotation Preview"
          subtitle={`${quotation.number} · ${quotation.customerName}`}
          footer={<Button variant="secondary" onClick={() => setAttachPreview(false)}>Close Preview</Button>}
        >
          <div className="overflow-hidden rounded-xl border border-surface-200">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit Price</th>
                  <th className="px-3 py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {quotation.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description}</p><p className="text-[11px] text-surface-400">{it.itemCode}</p></td>
                    <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                    <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
              <span className="text-[12px] font-medium text-surface-600">Grand Total</span>
              <span className="text-[14px] font-bold text-surface-900">{formatINR(quotation.value)}</span>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
