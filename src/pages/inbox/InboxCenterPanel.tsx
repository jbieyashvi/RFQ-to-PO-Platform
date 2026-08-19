import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  ArrowLeft,
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
import { Button, TextField, TextAreaField, Modal, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import { officeName } from '@/data/offices';
import { classNames, formatINR } from '@/lib/format';
import { TODAY_ISO } from '@/lib/quotationWorkflow';
import { EmailCenter } from './EmailCenter';
import { sendBlockers, isValidEmail, quoteSignature, quoteSendBlockers } from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const TODAY_TS = '2026-08-13T12:30:00';
const SENT_TS = '2026-08-13T12:45:00';

function templateFor(email: InboxEmail): OutgoingDraft {
  const greeting = `Dear ${email.senderName.split(' ')[0] || 'Sir/Madam'},`;
  return {
    from: email.recipient,
    to: email.senderEmail,
    cc: email.cc.join(', '),
    subject: `RE: ${email.subject}`,
    body: `${greeting}\n\nThank you for your email. We acknowledge receipt and will revert shortly.\n\nWarm regards,\n${email.owner}\nNexus RFQ — ${officeName(email.officeId)}`,
    relatedDoc: email.linkedQuotation ?? email.linkedPO ?? email.linkedSO ?? '',
    aiGenerated: true,
  };
}

/**
 * The centre panel of the Global Inbox: the selected incoming email plus the
 * outgoing composer. The composer ALWAYS lives here (never in the right panel).
 * In `quoteSend` mode it swaps the generic Related-Document / Amount fields for
 * the required Review Date + the attached-quotation indicator, and gates sending
 * on the latest quotation being attached.
 */
export function InboxCenterPanel({
  email,
  quoteSend = false,
  quotation = null,
}: {
  email: InboxEmail;
  quoteSend?: boolean;
  quotation?: Quotation | null;
}) {
  const {
    updateEmail,
    canInbox,
    addToast,
    quotations,
    salesOrders,
    updateQuotation,
    updateSalesOrder,
    currentUser,
    role,
  } = useApp();

  const [draft, setDraft] = useState<OutgoingDraft>(email.draft ?? templateFor(email));
  const [reviewDate, setReviewDate] = useState<string>(email.reviewDate ?? quotation?.reviewDate ?? '');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    setDraft(email.draft ?? templateFor(email));
    setReviewDate(email.reviewDate ?? quotation?.reviewDate ?? '');
    setPreview(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email.id]);

  const canDraft = canInbox('draft_reply');
  const canSend = canInbox('send');
  const canApprove = canInbox('approve');

  // Sending a customer-facing email needs BOTH approve and send permission.
  const permissionOk = canSend && canApprove;
  const permissionMessage =
    role === 'sales_user'
      ? 'Approval required from Office Admin or Super Admin.'
      : 'You do not have permission to approve & send this email.';

  const readOnly = email.sent || !canDraft;
  const setD = <K extends keyof OutgoingDraft>(k: K, v: OutgoingDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // ---- Quote-send attachment / staleness ----
  const attachmentStale = !!(
    quoteSend &&
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

  const baseBlockers = quoteSend ? quoteBlockersBase : normalBlockers;
  const blockers = permissionOk ? baseBlockers : [...baseBlockers, permissionMessage];
  const canFinalSend = blockers.length === 0;

  const blockReason = !permissionOk
    ? permissionMessage
    : baseBlockers.length > 0
    ? quoteSend
      ? baseBlockers[0]
      : 'Complete classification and confirm the extracted details before sending.'
    : '';

  const saveDraft = () => {
    updateEmail(email.id, { draft, draftSaved: true, ...(quoteSend ? { reviewDate } : {}) });
    addToast({ type: 'success', title: 'Draft saved', message: `Reply to ${email.senderName} saved as draft.` });
  };

  const removeAttachment = () => {
    updateEmail(email.id, { attachedQuote: undefined });
    addToast({ type: 'info', title: 'Attachment removed', message: 'The quotation PDF was removed from the email.' });
  };

  // ---- Normal-mode send (Approve & Send) ----
  const approveAndSend = () => {
    if (!canFinalSend) return;
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: TODAY_TS, needsReview: false });

    const activity = {
      id: `act-${Date.now()}`,
      date: TODAY_TS,
      actor: currentUser.fullName,
      action: 'Email sent to customer',
      detail: `${draft.subject} → ${draft.to}`,
    };

    if (email.quotationSendId) {
      const q = quotations.find((x) => x.id === email.quotationSendId);
      if (q) {
        updateQuotation(q.id, {
          deliveryState: 'sent',
          workState: 'sent',
          sentAt: TODAY_TS,
          sentBy: currentUser.fullName,
          sendChannel: 'Email (via Global Inbox)',
          sendFailureReason: undefined,
          lastUpdated: '2026-08-13',
          activity: [
            ...q.activity,
            { ...activity, action: 'Quotation emailed to customer', detail: `${draft.subject} → ${draft.to} · approved by ${currentUser.fullName}` },
          ],
        });
      }
    } else if (email.linkedQuotation) {
      const q = quotations.find((x) => x.number === email.linkedQuotation);
      if (q) updateQuotation(q.id, { activity: [...q.activity, activity], lastUpdated: '2026-08-13' });
    }
    if (email.linkedSO) {
      const so = salesOrders.find((x) => x.number === email.linkedSO);
      if (so) updateSalesOrder(so.id, { internalNotes: [...so.internalNotes, { id: activity.id, date: TODAY_TS, author: currentUser.fullName, text: `Email sent: ${draft.subject}` }] });
    }
    setPreview(false);
    addToast({ type: 'success', title: 'Email sent & approved', message: `Sent to ${draft.to}. Added to Sent and the record timeline.` });
  };

  // ---- Quote-send mode send (Send Email) ----
  const sendQuote = () => {
    if (!canFinalSend || !quotation) return;
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: SENT_TS, needsReview: false, reviewDate });
    updateQuotation(quotation.id, {
      deliveryState: 'sent',
      workState: 'sent',
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
      ],
    });
    addToast({ type: 'success', title: 'Quotation sent successfully.', message: `${quotation.number} sent to ${draft.to} and removed from Quotes Pending.` });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Read + compose share one scroll area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmailCenter email={email} embedded />

        {/* Composer */}
        <div className="border-t border-surface-100 px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">
              {quoteSend ? 'Reply — Send Quotation' : 'Outgoing Email'}
            </p>
            {draft.aiGenerated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
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
            <TextField label="To" required value={draft.to} onChange={(e) => setD('to', e.target.value)} disabled={readOnly} error={!isValidEmail(draft.to) ? 'Valid recipient required' : undefined} className="py-1.5 text-[13px]" />
            <TextField label="Cc" value={draft.cc} onChange={(e) => setD('cc', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" />
            <TextField label="Subject" required value={draft.subject} onChange={(e) => setD('subject', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" />
            <TextAreaField label="Body" required rows={8} value={draft.body} onChange={(e) => setD('body', e.target.value)} disabled={readOnly} className="text-[13px]" />

            {quoteSend ? (
              <>
                {/* Required next review date */}
                <TextField
                  label="Review Date"
                  type="date"
                  required
                  min={TODAY_ISO}
                  value={reviewDate}
                  onChange={(e) => setReviewDate(e.target.value)}
                  disabled={readOnly}
                  error={!reviewDate ? 'Next review date is required' : undefined}
                  className="py-1.5 text-[13px]"
                />

                {/* Attached quotation indicator */}
                <div>
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-surface-500">
                    <Paperclip className="h-3.5 w-3.5" /> Attached Quotation
                  </p>
                  {email.attachedQuote ? (
                    <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                      <FileText className="h-4 w-4 flex-none text-brand-600" />
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-surface-800">{email.attachedQuote.fileName}</p>
                        <p className="truncate text-[11px] text-surface-500">
                          {email.attachedQuote.qtnNumber} · {email.attachedQuote.fileType}
                        </p>
                      </div>
                      {!email.sent && (
                        <button
                          onClick={removeAttachment}
                          className="ml-auto flex-none rounded p-1 text-surface-400 transition-colors hover:bg-white hover:text-rose-600"
                          title="Remove attachment"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-dashed border-surface-300 bg-surface-50 px-3 py-2 text-[12px] text-surface-500">
                      <Paperclip className="h-4 w-4 flex-none" />
                      No quotation attached — use “Add as Attachment in Email” in the Quote Tools panel.
                    </div>
                  )}
                  {attachmentStale && !email.sent && (
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
                      <AlertTriangle className="h-3.5 w-3.5 flex-none" /> The quotation has changed. Add the latest version before sending.
                    </p>
                  )}
                </div>
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

      {/* Footer actions */}
      {!email.sent && (
        <div className="flex-none border-t border-surface-100 bg-surface-50/60 px-4 py-3">
          {quoteSend ? (
            <>
              <Button variant="secondary" size="sm" className="w-full" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft} disabled={!canDraft}>Save Draft</Button>
              <Button
                variant="primary"
                size="sm"
                className="mt-2 w-full"
                leftIcon={canFinalSend ? <Send className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                onClick={sendQuote}
                disabled={!canFinalSend}
                title={blockReason || 'Send the quotation email'}
              >
                Send Email
              </Button>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft} disabled={!canDraft}>Save Draft</Button>
                <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)} disabled={!canDraft}>Preview</Button>
              </div>
              <Button
                variant="primary"
                size="sm"
                className="mt-2 w-full"
                leftIcon={canFinalSend ? <Send className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                onClick={() => setPreview(true)}
                disabled={!canFinalSend}
                title={blockReason || 'Open final review and send'}
              >
                Approve &amp; Send
              </Button>
            </>
          )}
          {!canFinalSend && blockReason && (
            <p className={classNames('mt-1.5 flex items-center justify-center gap-1 text-center text-[11px]', !permissionOk ? 'font-medium text-rose-600' : 'text-amber-600')}>
              {quoteSend && <CalendarClock className="h-3 w-3 flex-none" />}
              {blockReason}
            </p>
          )}
        </div>
      )}

      {/* Preview modal — final human review before send (normal mode only) */}
      {!quoteSend && (
        <Modal
          open={preview}
          onClose={() => setPreview(false)}
          size="xl"
          title="Final Review — Approve & Send"
          subtitle="AI drafted this email. Review everything before it leaves the platform."
          footer={
            <>
              <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => setPreview(false)}>Back to Edit</Button>
              <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={approveAndSend} disabled={!canFinalSend}>Approve &amp; Send</Button>
            </>
          }
        >
          <div className="space-y-4">
            {draft.aiGenerated && (
              <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
                <Sparkles className="h-4 w-4" /> This email contains AI-generated content. A human must approve before it is sent.
              </div>
            )}

            <div className="rounded-xl border border-surface-200">
              <div className="space-y-1 border-b border-surface-100 px-4 py-3 text-[13px]">
                <p><span className="text-surface-400">From:</span> <span className="text-surface-700">{draft.from}</span></p>
                <p><span className="text-surface-400">To:</span> <span className="font-medium text-surface-800">{draft.to || '—'}</span></p>
                {draft.cc && <p><span className="text-surface-400">Cc:</span> <span className="text-surface-700">{draft.cc}</span></p>}
                <p><span className="text-surface-400">Subject:</span> <span className="font-medium text-surface-800">{draft.subject || '—'}</span></p>
              </div>
              <div className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-surface-700">{draft.body || '—'}</div>
            </div>

            <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-xl border border-surface-200 px-4 py-3 text-[13px] sm:grid-cols-2">
              {email.customerName && <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{email.customerName}</span></p>}
              <p><span className="text-surface-400">Classification:</span> <StatusBadge tone={INBOX_CLASSIFICATION[email.classification].tone} label={INBOX_CLASSIFICATION[email.classification].label} dot={false} /></p>
              {draft.relatedDoc && <p><span className="text-surface-400">Related document:</span> <span className="font-medium text-surface-800">{draft.relatedDoc}</span></p>}
              {typeof draft.amount === 'number' && <p><span className="text-surface-400">Amount:</span> <span className="font-medium text-surface-800">{formatINR(draft.amount)}</span></p>}
            </div>

            {blockers.length > 0 ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold text-rose-700"><AlertTriangle className="h-4 w-4" /> Unresolved warnings — cannot send</p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12px] text-rose-600">
                  {blockers.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700">
                <ShieldCheck className="h-4 w-4" /> All checks passed. This email is ready for approval and sending.
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
