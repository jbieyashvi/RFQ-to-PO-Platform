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
  FileSpreadsheet,
  Paperclip,
  X,
  CalendarClock,
  Wand2,
} from 'lucide-react';
import type {
  ErpHandoff,
  InboxEmail,
  OutgoingDraft,
  Quotation,
  SalesOrder,
  SORevisionSnapshot,
  SORevisionVersion,
  VerificationField,
} from '@/types';
import { Button, IconButton, TextField, TextAreaField, Modal } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { ITEMS } from '@/data/masters';
import { emailSignature } from '@/lib/brand';
import { classNames, computeTotals, formatINR, lineTotal } from '@/lib/format';
import { resolveSalesOrder } from '@/lib/salesOrder';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
import { TODAY_ISO } from '@/lib/quotationWorkflow';
import { actionableFields, deriveVerificationStatus } from '@/lib/verification';
import { EmailCenter } from './EmailCenter';
import {
  sendBlockers,
  isValidEmail,
  quoteSignature,
  quoteSendBlockers,
  composerBlockers,
} from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const TODAY_TS = '2026-08-13T12:30:00';
const SENT_TS = '2026-08-13T12:45:00';

export type ComposeMode = 'normal' | 'quote-send' | 'po-verify' | 'so-revision';

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

// A blank reply scaffold for workflow modes — the right panel fills in the real
// To / Subject / Body when it prepares the composer.
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

const COMPOSE_HEADING: Record<string, string> = {
  'quote-send': 'Reply — Send Quotation',
  'po-request': 'Reply — Request Updated PO',
  'quote-correct': 'Reply — Send Corrected Quotation',
  'so-send': 'Reply — Send Sales Order',
  'so-revise': 'Reply — Send Revised Sales Order',
  normal: 'Outgoing Email',
};

/**
 * The centre panel of the Global Inbox and the ONE place any email is finally
 * sent. It always shows the selected incoming email plus the outgoing composer;
 * the right-hand business panels only PREPARE content (edit a quote, request a
 * corrected PO) and hand it to this composer via the email record. Depending on
 * `mode` the composer finalises the matching workflow:
 *   • quote-send    → send the attached quotation
 *   • po-verify     → request an updated PO, or send a corrected quotation
 * `normal` keeps the generic Approve & Send reply.
 */
export function InboxCenterPanel({
  email,
  mode = 'normal',
  quotation = null,
  salesOrder = null,
  focusTick = 0,
}: {
  email: InboxEmail;
  mode?: ComposeMode;
  quotation?: Quotation | null;
  salesOrder?: SalesOrder | null;
  focusTick?: number;
}) {
  const {
    updateEmail,
    addEmail,
    canInbox,
    addToast,
    quotations,
    updateQuotation,
    updateSalesOrder,
    currentUser,
    role,
    parties,
  } = useApp();

  const isWorkflow = mode !== 'normal';
  const intent = email.composeIntent; // 'revision' | 'po-request' | 'quote-correct' | 'so-send' | 'so-revise'
  // so-send carries the generated Sales Order PDF (not a quotation) and skips
  // the next-review-date gate — it is the terminal step of the SO workflow.
  const isSoSend = mode === 'po-verify' && intent === 'so-send';
  // so-revision carries the revised Sales Order Acknowledgement PDF and, unlike
  // so-send, KEEPS the next-review-date gate — the client conversation continues.
  const isSoRevise = mode === 'so-revision';

  const [draft, setDraft] = useState<OutgoingDraft>(
    email.draft ?? (isWorkflow ? blankDraft(email) : templateFor(email))
  );
  const [reviewDate, setReviewDate] = useState<string>(email.reviewDate ?? quotation?.reviewDate ?? '');
  const [attachPreview, setAttachPreview] = useState(false);
  const [soPreview, setSoPreview] = useState(false);

  const composerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(email.draft ?? (isWorkflow ? blankDraft(email) : templateFor(email)));
    setReviewDate(email.reviewDate ?? quotation?.reviewDate ?? '');
    setAttachPreview(false);
    setSoPreview(false);
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

  // quote-send and the generic reply both need approve + send; the PO / SO
  // follow-ups only need send (they were already approved as documents).
  const permissionOk =
    mode === 'quote-send' || mode === 'normal' ? canSend && canApprove : canSend;
  const permissionMessage =
    role === 'sales_user'
      ? 'Approval required from Office Admin or Super Admin.'
      : 'You do not have permission to approve & send this email.';

  const readOnly = email.sent || !canDraft;
  const setD = <K extends keyof OutgoingDraft>(k: K, v: OutgoingDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // Which modes carry a system-generated quotation attachment.
  const requireAttachment =
    mode === 'quote-send' || (mode === 'po-verify' && intent === 'quote-correct');

  // The composer FORM is shown once there is something to send. For quote-send
  // and normal replies that is always; for PO / SO it is only after the right
  // panel prepares the email (sets composeIntent).
  const composePrepared = mode === 'quote-send' || mode === 'normal' ? true : !!intent;

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
  const workflowBlockersBase = useMemo(
    () =>
      composerBlockers({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        reviewDate,
        hasAttachment: !!email.attachedQuote,
        attachmentStale,
        requireAttachment,
      }),
    [draft.to, draft.subject, draft.body, reviewDate, email.attachedQuote, attachmentStale, requireAttachment]
  );
  // so-send has its own gate: valid recipient + subject + body + the generated
  // SO attached. No next-review-date, no quotation attachment.
  const soSendBlockers = useMemo(() => {
    const b: string[] = [];
    if (!isValidEmail(draft.to)) b.push('A valid recipient email is required.');
    if (!draft.subject.trim()) b.push('Subject is required.');
    if (!draft.body.trim()) b.push('Email body is required.');
    if (!email.attachedSalesOrder) b.push('Add the Sales Order to the email before sending.');
    return b;
  }, [draft.to, draft.subject, draft.body, email.attachedSalesOrder]);

  // so-revision gate: valid recipient + subject + body + the revised SO attached
  // + a next review date. The revised SO must have been saved & attached first.
  const soReviseBlockers = useMemo(() => {
    const b: string[] = [];
    if (!isValidEmail(draft.to)) b.push('A valid recipient email is required.');
    if (!draft.subject.trim()) b.push('Subject is required.');
    if (!draft.body.trim()) b.push('Email body is required.');
    if (!email.attachedSalesOrder) b.push('Add the revised Sales Order to the email before sending.');
    if (!reviewDate) b.push('Next review date is required.');
    return b;
  }, [draft.to, draft.subject, draft.body, email.attachedSalesOrder, reviewDate]);

  const baseBlockers =
    mode === 'quote-send'
      ? quoteBlockersBase
      : mode === 'normal'
      ? normalBlockers
      : isSoRevise
      ? soReviseBlockers
      : isSoSend
      ? soSendBlockers
      : workflowBlockersBase;
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

  // Removing the SO detaches it and collapses the composer back to the "prepare
  // from the workspace" state — re-add it from the SO Generation panel.
  const removeSoAttachment = () => {
    updateEmail(email.id, { attachedSalesOrder: undefined, composeIntent: undefined, draft: undefined, draftSaved: false });
    addToast({ type: 'info', title: 'Attachment removed', message: 'The Sales Order PDF was removed from the email.' });
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

  // Record the outgoing customer email as a sent item in the inbox history.
  const recordOutgoing = (so: SalesOrder, withAttachment: boolean) => {
    addEmail({
      id: `em-out-${so.id}-${intent}-${Date.now()}`,
      senderName: so.owner,
      senderEmail: email.recipient,
      recipient: draft.to,
      cc: draft.cc ? draft.cc.split(',').map((s) => s.trim()).filter(Boolean) : [],
      subject: draft.subject,
      receivedAt: TODAY_TS,
      body: draft.body,
      thread: [],
      classification: 'purchase_order',
      aiConfidence: 100,
      read: true,
      needsReview: false,
      officeId: so.officeId,
      owner: so.owner,
      partyId: so.partyId,
      customerName: so.customerName,
      customerCode: so.customerCode,
      linkedPO: so.poNumber,
      linkedQuotation: so.quotationNumber,
      linkedSO: so.number,
      // Keeps the outgoing mail inside the same inquiry bundle as the thread it
      // was answered from, even though it is a brand-new conversation.
      inquiryId: email.inquiryId ?? so.quotationId,
      attachedQuote: withAttachment ? email.attachedQuote : undefined,
      extraction: [],
      extractionConfirmed: true,
      draftSaved: true,
      sent: true,
      sentAt: TODAY_TS,
    });
  };

  // ---- PO verification — Path 1: request an updated PO (no attachment). The
  // workflow state moves to "Awaiting Corrected PO" ONLY now, on send. ----
  const sendPoRequest = () => {
    if (!canFinalSend || !salesOrder) return;
    const so = salesOrder;
    const targetKeys = new Set(actionableFields(so.verificationFields).map((f) => f.key));
    const newFields: VerificationField[] = so.verificationFields.map((f) =>
      targetKeys.has(f.key) ? { ...f, resolution: 'awaiting_po' } : f
    );
    const newStatus = deriveVerificationStatus(newFields);
    updateSalesOrder(so.id, {
      verificationFields: newFields,
      verificationStatus: newStatus,
      reviewDate,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-po-${Date.now()}`, date: TODAY_TS, actor: currentUser.fullName, action: 'Requested updated PO from customer', detail: `${targetKeys.size} field(s) flagged · next review ${reviewDate}` },
      ],
    });
    recordOutgoing(so, false);
    // Reset the composer — the PO conversation stays open for the correction.
    updateEmail(email.id, { reviewDate, needsReview: newStatus !== 'verified', draft: undefined, composeIntent: undefined, draftSaved: false });
    addToast({ type: 'success', title: 'Updated PO requested', message: `Sent to ${draft.to}. Case moved to Awaiting Corrected PO.` });
  };

  // ---- PO verification — Path 2: send the corrected quotation. The quote was
  // already corrected + saved by the right panel. ----
  const sendQuoteCorrection = () => {
    if (!canFinalSend || !salesOrder) return;
    const so = salesOrder;
    const targetKeys = new Set(actionableFields(so.verificationFields).map((f) => f.key));
    const newFields: VerificationField[] = so.verificationFields.map((f) =>
      targetKeys.has(f.key) ? { ...f, resolution: 'awaiting_quote' } : f
    );
    const newStatus = deriveVerificationStatus(newFields);
    updateSalesOrder(so.id, {
      verificationFields: newFields,
      verificationStatus: newStatus,
      reviewDate,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-qc-${Date.now()}`, date: TODAY_TS, actor: currentUser.fullName, action: 'Sent corrected quotation to customer', detail: `${email.attachedQuote?.qtnNumber ?? so.quotationNumber ?? ''} → ${draft.to} · next review ${reviewDate}` },
      ],
    });
    if (quotation) {
      updateQuotation(quotation.id, {
        reviewDate,
        lastUpdated: '2026-08-13',
        activity: [
          ...quotation.activity,
          { id: `act-${quotation.id}-qc-${Date.now()}`, date: TODAY_TS, actor: currentUser.fullName, action: 'Corrected quotation sent to customer', detail: `PO ${so.poNumber} · next review ${reviewDate}` },
        ],
      });
    }
    recordOutgoing(so, true);
    updateEmail(email.id, { reviewDate, needsReview: newStatus !== 'verified', draft: undefined, composeIntent: undefined, attachedQuote: undefined, draftSaved: false });
    addToast({ type: 'success', title: 'Corrected quotation sent', message: `Sent to ${draft.to}. Case moved to Updated Quote Sent.` });
  };

  // ---- PO verification — Path 3: send the generated Sales Order. The SO was
  // generated + attached by the SO Generation drawer; here we email it, stamp
  // the SO Sent Date and — now that the customer email has actually gone out —
  // submit the SO to ERP Handoff (Submitted). Legacy records that already carry
  // a handoff keep it untouched (no duplicate is ever created). ----
  const sendSalesOrder = () => {
    if (!canFinalSend || !salesOrder) return;
    const so = salesOrder;
    const newHandoff = !so.erpHandoff;
    const erpHandoff: ErpHandoff = so.erpHandoff ?? {
      state: 'submitted',
      source: 'po_verification',
      submittedAt: SENT_TS,
      submittedBy: currentUser.fullName,
      updatedAt: SENT_TS,
      revisionNumber: so.revisionNumber,
    };
    const activity = [
      ...so.activity,
      { id: `act-${so.id}-sosend-${Date.now()}`, date: SENT_TS, actor: currentUser.fullName, action: 'Sales Order emailed to customer', detail: `${email.attachedSalesOrder?.soNumber ?? so.number} → ${draft.to}` },
    ];
    if (newHandoff) {
      activity.push({
        id: `act-${so.id}-handoff-${Date.now()}`,
        date: SENT_TS,
        actor: currentUser.fullName,
        action: 'Submitted to ERP Handoff',
        detail: `${so.number} added to ERP Handoff (Submitted) after the SO email was sent`,
      });
    }
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: SENT_TS, needsReview: false });
    updateSalesOrder(so.id, {
      sentAt: SENT_TS,
      status: 'so_sent',
      erpHandoff,
      activity,
    });
    addToast({
      type: 'success',
      title: 'Sales Order sent successfully.',
      message: newHandoff
        ? `${so.number} emailed to ${draft.to} and submitted to ERP Handoff (Submitted).`
        : `${so.number} emailed to ${draft.to}. Already in ERP Handoff (Submitted).`,
    });
  };

  // ---- Sales Order Revision send (Send Email): the SO was already revised,
  // saved and attached by the right panel. Here we promote the saved revised
  // snapshot to a NEW immutable version, increment the revision number, stamp the
  // SO Sent Date, mark the revision request completed, and update the EXISTING
  // ERP Handoff to flag that a revised SO is available — no duplicate SO or
  // handoff, and manufacturing is NOT auto-confirmed. ----
  const sendSoRevision = () => {
    if (!canFinalSend || !salesOrder) return;
    const so = salesOrder;
    const snapshot: SORevisionSnapshot = so.revisionDraft ?? {
      items: so.items.map((it) => ({ ...it })),
      paymentTerms: so.paymentTerms,
      deliveryTerms: so.deliveryTerms,
      deliveryDate: so.deliveryDate,
      billingAddress: so.billingAddress,
      shippingAddress: so.shippingAddress,
    };
    const nextNum = so.revisionNumber + 1;
    const newValue = computeTotals(snapshot.items, so.packingCharges).grandTotal;
    const newVersion: SORevisionVersion = {
      id: `ver-${so.id}-${nextNum}`,
      label: `Rev ${nextNum}`,
      version: nextNum,
      createdAt: SENT_TS,
      by: currentUser.fullName,
      reason: so.revisionReason ?? 'Customer-requested Sales Order revision',
      notes: so.revisionNotes,
      snapshot,
    };
    // Update (never duplicate) the ERP Handoff so operations see a revised SO is
    // available. Existing handoff → annotate in place; none → create the single
    // handoff record. State stays as-is (manufacturing is not auto-confirmed).
    const handoffNote = `Revised Sales Order ${so.number} (Rev ${nextNum}) available for ERP update.`;
    // Update the SINGLE ERP Handoff record in place — never create a duplicate.
    // The record stays Submitted, carrying the new revision number and a fresh
    // updated timestamp so the ERP picks up the revised order.
    const erpHandoff: ErpHandoff = so.erpHandoff
      ? { ...so.erpHandoff, state: 'submitted', revisionNumber: nextNum, updatedAt: SENT_TS, reference: handoffNote }
      : {
          state: 'submitted',
          source: 'po_verification',
          submittedAt: SENT_TS,
          submittedBy: currentUser.fullName,
          updatedAt: SENT_TS,
          revisionNumber: nextNum,
          reference: handoffNote,
        };
    updateSalesOrder(so.id, {
      revisionNumber: nextNum,
      revisionState: 'revised_sent',
      revisionDraft: undefined,
      revisionPreviewed: false,
      sentAt: SENT_TS,
      status: 'so_sent',
      items: snapshot.items.map((it) => ({ ...it })),
      paymentTerms: snapshot.paymentTerms,
      deliveryTerms: snapshot.deliveryTerms,
      deliveryDate: snapshot.deliveryDate,
      billingAddress: snapshot.billingAddress,
      shippingAddress: snapshot.shippingAddress,
      value: newValue,
      versions: [...so.versions, newVersion],
      erpHandoff,
      reviewDate,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-sorev-${nextNum}`, date: SENT_TS, actor: currentUser.fullName, action: 'Revised Sales Order sent to customer', detail: `${email.attachedSalesOrder?.soNumber ?? so.number} · Rev ${nextNum} → ${draft.to} · next review ${reviewDate}` },
        { id: `act-${so.id}-erp-${nextNum}`, date: SENT_TS, actor: currentUser.fullName, action: 'ERP Handoff updated', detail: handoffNote },
      ],
    });
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: SENT_TS, needsReview: false, reviewDate });
    addToast({ type: 'success', title: 'Revised Sales Order sent successfully.', message: `${so.number} (Rev ${nextNum}) emailed to ${draft.to}. ERP Handoff flagged for update.` });
  };

  const onWorkflowSend = () => {
    if (mode === 'quote-send') sendQuote();
    else if (mode === 'so-revision') sendSoRevision();
    else if (mode === 'po-verify') {
      if (intent === 'po-request') sendPoRequest();
      else if (intent === 'so-send') sendSalesOrder();
      else sendQuoteCorrection();
    }
  };

  const headingKey = mode === 'po-verify' ? intent ?? 'po-request' : mode;
  const heading = COMPOSE_HEADING[headingKey] ?? 'Outgoing Email';

  return (
    <div className="flex h-full flex-col">
      {/* Thread — independently scrollable above the pinned composer */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* The centre panel is the conversation, nothing else: confirming what
            the AI read happens on the right — line by line for an enquiry, in
            its own workspace for every other workflow. */}
        <EmailCenter email={email} embedded />
      </div>

      {/* Composer — WORKFLOW modes only.
          Normal mail used to carry this form open at all times, so every email
          looked half-answered and the thread was squeezed into the space left
          over. Ordinary replies are now written in the compose window, opened
          on purpose from the Business Action panel — which leaves the whole
          centre panel to the conversation being read. */}
      {isWorkflow && (
      <div className="max-h-[40%] flex-none overflow-y-auto border-t border-surface-100">
        <div ref={composerRef} className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">{heading}</p>
            {composePrepared && draft.aiGenerated && (
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

          {isWorkflow && !composePrepared && !email.sent ? (
            /* Awaiting preparation from the right-hand workspace */
            <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-surface-300 bg-surface-50/70 px-3.5 py-3 text-[12px] text-surface-500">
              <Wand2 className="mt-0.5 h-4 w-4 flex-none text-brand-400" />
              <span>
                Prepare this reply from the workspace on the right.{' '}
                {isSoRevise
                  ? 'Edit the revised Sales Order, then use “Add Revised SO to Email”'
                  : 'Use “Request Updated PO” or “Correct Quote”'}{' '}
                — it will appear here to review, set the next review date, and send.
              </span>
            </div>
          ) : (
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
                  {/* Required next review date — not part of the SO send step */}
                  {!isSoSend && (
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
                  )}

                  {/* SO attachment chip — the generated / revised Sales Order PDF */}
                  {(isSoSend || isSoRevise) && (
                    <div>
                      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-surface-500">
                        <Paperclip className="h-3.5 w-3.5" /> {isSoRevise ? 'Attached Revised Sales Order' : 'Attached Sales Order'}
                      </p>
                      {email.attachedSalesOrder ? (
                        <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                          <FileSpreadsheet className="h-4 w-4 flex-none text-brand-600" />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate text-[12px] font-medium text-surface-800">
                              {email.attachedSalesOrder.soNumber}
                              {email.attachedSalesOrder.revisionLabel && (
                                <span className="inline-flex flex-none items-center rounded-full bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                                  {email.attachedSalesOrder.revisionLabel}
                                </span>
                              )}
                            </p>
                            <p className="truncate text-[11px] text-surface-500">
                              {email.attachedSalesOrder.fileType}
                              {email.attachedSalesOrder.sizeLabel ? ` · ${email.attachedSalesOrder.sizeLabel}` : ''}
                              {' · '}{formatINR(email.attachedSalesOrder.value)}
                            </p>
                          </div>
                          {salesOrder && (
                            <button onClick={() => setSoPreview(true)} className="flex-none rounded p-1 text-surface-400 transition-colors hover:bg-white hover:text-brand-600" title="Preview Sales Order">
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!email.sent && (
                            <button onClick={removeSoAttachment} className="flex-none rounded p-1 text-surface-400 transition-colors hover:bg-white hover:text-rose-600" title="Remove Sales Order">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded-lg border border-dashed border-surface-300 bg-surface-50 px-3 py-2 text-[12px] text-surface-500">
                          <Paperclip className="h-4 w-4 flex-none" />
                          {isSoRevise
                            ? 'No revised Sales Order attached — use “Add Revised SO to Email” in the workspace.'
                            : 'No Sales Order attached — use “Add Sales Order to Email” in the workspace.'}
                        </div>
                      )}
                    </div>
                  )}

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
          )}
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
      {!email.sent && isWorkflow && composePrepared && (
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
              onClick={onWorkflowSend}
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

      {/* Sales Order preview — read-only document exactly as attached. For a
          revision, reflect the saved revised draft (falls back to the live SO). */}
      {salesOrder && (() => {
        const snap = isSoRevise ? salesOrder.revisionDraft ?? null : null;
        const soForDoc = snap
          ? { ...salesOrder, items: snap.items, deliveryTerms: snap.deliveryTerms, paymentTerms: snap.paymentTerms }
          : salesOrder;
        const resolved = resolveSalesOrder(soForDoc, { parties, catalog: ITEMS });
        const revLabel = email.attachedSalesOrder?.revisionLabel;
        return (
        <Modal
          open={soPreview}
          onClose={() => setSoPreview(false)}
          size="xl"
          title={isSoRevise ? 'Revised Sales Order Preview' : 'Sales Order Preview'}
          subtitle={`${salesOrder.number}${revLabel ? ` · ${revLabel}` : ''} · ${salesOrder.customerName}`}
          footer={<Button variant="secondary" onClick={() => setSoPreview(false)}>Close Preview</Button>}
        >
          <SalesOrderDocument resolved={resolved} showLetterhead />
        </Modal>
        );
      })()}

    </div>
  );
}
