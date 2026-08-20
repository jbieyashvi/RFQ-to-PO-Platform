import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Button, TextField, TextAreaField, Modal, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
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

export type ComposeMode = 'normal' | 'quote-send' | 'revision' | 'po-verify' | 'so-revision';

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
  revision: 'Reply — Send Revised Quotation',
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
 *   • revision      → send the revised quotation (new version)
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
    salesOrders,
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
  const [preview, setPreview] = useState(false);
  const [attachPreview, setAttachPreview] = useState(false);
  const [soPreview, setSoPreview] = useState(false);

  const composerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraft(email.draft ?? (isWorkflow ? blankDraft(email) : templateFor(email)));
    setReviewDate(email.reviewDate ?? quotation?.reviewDate ?? '');
    setPreview(false);
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

  // quote-send and the generic reply both need approve + send; the revision and
  // PO follow-ups only need send (they were already approved as documents).
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
    mode === 'quote-send' || mode === 'revision' || (mode === 'po-verify' && intent === 'quote-correct');

  // The composer FORM is shown once there is something to send. For quote-send
  // and normal replies that is always; for revision / PO it is only after the
  // right panel prepares the email (sets composeIntent).
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

  // ---- Revision send (Send Email): the quote was already revised + saved by
  // the right panel; here we snapshot it as a new sent version and mark sent. ----
  const sendRevision = () => {
    if (!canFinalSend || !quotation) return;
    const q = quotation;
    const existing = q.quoteVersions && q.quoteVersions.length > 0 ? q.quoteVersions : [];
    const nextVersion = existing.length + 1;
    const newVersion = {
      id: `qv-${q.id}-${nextVersion}`,
      label: `V${nextVersion}`,
      version: nextVersion,
      createdAt: SENT_TS,
      by: currentUser.fullName,
      value: q.value,
      items: q.items.map((it) => ({ ...it })),
      note: 'Revised quotation sent to customer',
      sent: true,
      sentAt: SENT_TS,
    };
    updateQuotation(q.id, {
      quoteVersions: [...existing, newVersion],
      workState: 'sent',
      deliveryState: 'sent',
      sentAt: SENT_TS,
      sentBy: currentUser.fullName,
      sendChannel: 'Email (via Global Inbox)',
      reviewDate,
      lastUpdated: '2026-08-13',
      revisions: [
        ...q.revisions,
        { id: `rev-${q.id}-${nextVersion}`, version: nextVersion, date: '2026-08-13', reason: 'Revised quotation sent to customer', by: currentUser.fullName },
      ],
      activity: [
        ...q.activity,
        { id: `act-${q.id}-send-${nextVersion}`, date: SENT_TS, actor: currentUser.fullName, action: 'Revised quotation sent to customer', detail: `${email.attachedQuote?.fileName ?? q.number} → ${draft.to} · next review ${reviewDate}` },
      ],
    });
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: SENT_TS, needsReview: false, reviewDate });
    addToast({ type: 'success', title: 'Revised quotation sent successfully.', message: `${q.number} sent to ${draft.to}. Saved as ${newVersion.label}.` });
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
  // already generated + linked to a Pending ERP Handoff by the right panel; here
  // we email it and stamp the SO Sent Date. ERP Handoff stays Pending (no
  // duplicate is created). ----
  const sendSalesOrder = () => {
    if (!canFinalSend || !salesOrder) return;
    const so = salesOrder;
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: SENT_TS, needsReview: false });
    updateSalesOrder(so.id, {
      sentAt: SENT_TS,
      status: 'so_sent',
      activity: [
        ...so.activity,
        { id: `act-${so.id}-sosend-${Date.now()}`, date: SENT_TS, actor: currentUser.fullName, action: 'Sales Order emailed to customer', detail: `${email.attachedSalesOrder?.soNumber ?? so.number} → ${draft.to}` },
      ],
    });
    addToast({ type: 'success', title: 'Sales Order sent successfully.', message: `${so.number} emailed to ${draft.to}. ERP Handoff remains Pending.` });
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
    const erpHandoff: ErpHandoff = so.erpHandoff
      ? { ...so.erpHandoff, reference: handoffNote }
      : {
          state: 'pending',
          source: 'po_verification',
          submittedAt: SENT_TS,
          submittedBy: currentUser.fullName,
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
    else if (mode === 'revision') sendRevision();
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
      {/* Read + compose share one scroll area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmailCenter email={email} embedded />

        {/* Composer */}
        <div ref={composerRef} className="border-t border-surface-100 px-5 py-4">
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
                {mode === 'revision'
                  ? 'Edit the quote, then use “Add Revised Quote to Email”'
                  : isSoRevise
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
                          {mode === 'revision'
                            ? 'No quotation attached — use “Add Revised Quote to Email” in the workspace.'
                            : 'No quotation attached — use “Add Corrected Quote to Email” in the workspace.'}
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

      {/* Footer actions */}
      {!email.sent && (isWorkflow ? composePrepared : true) && (
        <div className="flex-none border-t border-surface-100 bg-surface-50/60 px-4 py-3">
          {isWorkflow ? (
            <>
              <Button variant="secondary" size="sm" className="w-full" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft} disabled={!canDraft}>Save Draft</Button>
              <Button
                variant="primary"
                size="sm"
                className="mt-2 w-full"
                leftIcon={canFinalSend ? <Send className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                onClick={onWorkflowSend}
                disabled={!canFinalSend}
                title={blockReason || 'Send this email'}
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

      {/* Preview modal — final human review before send (normal mode only) */}
      {mode === 'normal' && (
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
