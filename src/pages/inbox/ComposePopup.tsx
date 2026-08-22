import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, FileText, Maximize2, Minimize2, Minus, Paperclip, Save, Send, X } from 'lucide-react';
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
import { Button, Modal } from '@/components/ui';
import { DocumentLetterhead } from '@/components/DocumentLetterhead';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
import { useApp } from '@/context/AppContext';
import { ITEMS } from '@/data/masters';
import { officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { classNames, computeTotals, formatINR, lineTotal } from '@/lib/format';
import { resolveSalesOrder } from '@/lib/salesOrder';
import { REVIEW_DATE_REQUIRED, reviewDateError } from '@/lib/quotationWorkflow';
import { actionableFields, deriveVerificationStatus } from '@/lib/verification';
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
 * Pending to be Sent, or out of Quotes Needing Revision — and the chosen review
 * date moves it on to Follow-up Pending. A revision additionally snapshots the
 * quote it just sent as the next version, so the previous one stays readable.
 */
export function ComposePopup({
  email,
  quotation,
  inquiryId,
  revision = false,
  salesOrder = null,
  soRevision = false,
  poVerification = false,
  onClose,
}: {
  email: InboxEmail;
  /** The quotation attached to this mail, when the quote builder handed over. */
  quotation: Quotation | null;
  /** Conversation the sent mail is filed under. */
  inquiryId: string | null;
  /**
   * This mail carries a REVISED quotation. Sending it cuts the next immutable
   * version of the same quotation rather than simply marking the first one
   * sent — the customer now holds two quotes, and both have to be readable.
   */
  revision?: boolean;
  /** The Sales Order this mail revises, in the SO Revision flow. */
  salesOrder?: SalesOrder | null;
  /**
   * This mail carries a REVISED Sales Order. Sending it promotes the saved
   * revised snapshot to the next version of the SAME Sales Order and updates
   * the one ERP Handoff record — it never creates a second SO.
   */
  soRevision?: boolean;
  /**
   * This is a PO vs Quote Verification reply. Which of the three it is comes
   * from the mail's own compose intent, written by whichever workspace prepared
   * it — request an updated PO, send the corrected quotation, or send the
   * generated Sales Order.
   */
  poVerification?: boolean;
  onClose: () => void;
}) {
  const { updateEmail, updateQuotation, updateSalesOrder, addEmail, addToast, canInbox, currentUser, parties } =
    useApp();

  const canSend = canInbox('send');

  // Seeded once: the draft the email already carries (the quote builder writes
  // one when it attaches), otherwise a plain acknowledgement.
  const [draft, setDraft] = useState<OutgoingDraft>(() => email.draft ?? acknowledgement(email));
  const [reviewDate, setReviewDate] = useState(email.reviewDate ?? '');
  const [state, setState] = useState<WindowState>('normal');
  const [showPreview, setShowPreview] = useState(false);
  const [pos, setPos] = useState({ right: 20, bottom: 0 });

  const drag = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);

  // Which PO-verification reply this is. Read off the email rather than passed
  // in, so the window always matches the draft the workspace actually wrote.
  const poIntent = poVerification ? email.composeIntent : undefined;
  const isPoRequest = poIntent === 'po-request';
  const isQuoteCorrect = poIntent === 'quote-correct';
  const isSoSend = poIntent === 'so-send';

  const attachment = email.attachedQuote;
  // The SO Revision and SO Generation flows attach a Sales Order PDF instead of
  // a quotation; a PO correction request carries no attachment at all.
  const soAttachment = soRevision || isSoSend ? email.attachedSalesOrder : undefined;
  const set = (patch: Partial<OutgoingDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // The shared validator's "before updating the quotation" wording belongs to
  // the quotation workspace; here the date gates an outgoing email, and the
  // same window sends Sales Orders and PO corrections too.
  const rawDateError = reviewDateError(reviewDate);
  const dateError =
    rawDateError === REVIEW_DATE_REQUIRED ? 'Select the next review date before sending.' : rawDateError;

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!isValidEmail(draft.to.trim())) out.push('a valid recipient address');
    if (!draft.subject.trim()) out.push('a subject');
    if (!draft.body.trim()) out.push('a message body');
    if (dateError) out.push('a next review date');
    // A revised SO email is only worth sending with the revised SO on it — the
    // attachment IS the deliverable, so removing it blocks Send.
    if (soRevision && !soAttachment) out.push('the revised Sales Order attachment');
    if (isSoSend && !soAttachment) out.push('the Sales Order attachment');
    if (isQuoteCorrect && !attachment) out.push('the corrected quotation attachment');
    return out;
  }, [draft, dateError, soRevision, soAttachment, isSoSend, isQuoteCorrect, attachment]);

  const blocked = !canSend || blockers.length > 0;

  const saveDraft = () => {
    updateEmail(email.id, { draft, draftSaved: true, reviewDate: reviewDate || undefined });
    addToast({ type: 'success', title: 'Draft saved', message: 'This reply is kept with the email.' });
  };

  const removeAttachment = () => {
    if (soAttachment) {
      updateEmail(email.id, { attachedSalesOrder: undefined });
      addToast({
        type: 'info',
        title: 'Attachment removed',
        message: soRevision
          ? 'Re-open Revise Sales Order to attach the revised SO again.'
          : 'Use “Add Sales Order to Email” in the workspace to attach it again.',
      });
      return;
    }
    updateEmail(email.id, { attachedQuote: undefined });
    addToast({
      type: 'info',
      title: 'Attachment removed',
      message: isQuoteCorrect
        ? 'Re-open Correct Quote to attach the corrected quotation again.'
        : 'Re-open Generate Quote to attach the quotation again.',
    });
  };

  /**
   * The Sales Order half of Send. The revised SO was prepared, saved and
   * attached in the revision modal; here it becomes real: the saved snapshot is
   * frozen as the NEXT immutable version of the SAME Sales Order (Rev n → Rev
   * n+1), the live SO fields move to the revised values so the List of Sales
   * Orders shows the latest, the revision request is marked resolved, and the
   * SINGLE ERP Handoff record is updated in place to the latest revision with
   * status Submitted. No duplicate Sales Order and no duplicate handoff.
   */
  const sendSoRevision = (so: SalesOrder) => {
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
    const handoffNote = `Revised Sales Order ${so.number} (Rev ${nextNum}) available for ERP update.`;
    // A revision puts the ERP out of date: whatever it holds is now the
    // superseded version, so the record drops back to Pending and the earlier
    // submission stamp is cleared. Re-submitting is the operator's call.
    const erpHandoff: ErpHandoff = so.erpHandoff
      ? {
          ...so.erpHandoff,
          state: 'pending',
          submittedAt: undefined,
          submittedBy: undefined,
          revisionNumber: nextNum,
          updatedAt: SENT_TS,
          reference: handoffNote,
        }
      : {
          state: 'pending',
          source: 'po_verification',
          queuedAt: SENT_TS,
          queuedBy: currentUser.fullName,
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
        {
          id: `act-${so.id}-sorev-${nextNum}`,
          date: SENT_TS,
          actor: currentUser.fullName,
          action: 'Revised Sales Order sent to customer',
          detail: `${so.number} · Rev ${nextNum} → ${draft.to} · next review ${reviewDate}`,
        },
        {
          id: `act-${so.id}-erp-${nextNum}`,
          date: SENT_TS,
          actor: currentUser.fullName,
          action: 'ERP Handoff reset to Pending',
          detail: `${handoffNote} Awaiting Submit to ERP.`,
        },
      ],
    });
    addToast({
      type: 'success',
      title: 'Revised Sales Order sent successfully.',
      message: `${so.number} (Rev ${nextNum}) emailed to ${draft.to}. ERP Handoff moved to Rev ${nextNum} · Pending — submit it to the ERP from the ERP Handoff screen.`,
    });
  };

  /**
   * The PO vs Quote Verification half of Send. There are exactly three replies,
   * and the mail's compose intent says which one is on screen:
   *
   *   • po-request    → the flagged fields move to "Updated PO awaited"
   *   • quote-correct → they move to "Corrected quote awaited"
   *   • so-send       → the Sales Order is stamped as sent and — now that the
   *                     customer email has actually gone out — queued in ERP
   *                     Handoff as Pending. The email having gone out is not
   *                     the ERP having been keyed: that is a separate, explicit
   *                     Submit to ERP action on the ERP Handoff screen.
   *
   * The first two deliberately leave the record on Mismatch Found: a correction
   * having been SENT is not evidence that the numbers now agree. Only the re-run
   * comparison in the workspace, done once the corrected document is in hand,
   * clears those fields.
   */
  const sendPoVerification = (so: SalesOrder) => {
    if (isSoSend) {
      // An SO that already carries a handoff keeps it — sending the mail twice
      // must never mint a second ERP Handoff record for the same order.
      const newHandoff = !so.erpHandoff;
      const erpHandoff: ErpHandoff = so.erpHandoff ?? {
        state: 'pending',
        source: 'po_verification',
        queuedAt: SENT_TS,
        queuedBy: currentUser.fullName,
        updatedAt: SENT_TS,
        revisionNumber: so.revisionNumber,
      };
      const activity = [
        ...so.activity,
        {
          id: `act-${so.id}-sosend-${Date.now()}`,
          date: SENT_TS,
          actor: currentUser.fullName,
          action: 'Sales Order emailed to customer',
          detail: `${soAttachment?.soNumber ?? so.number} → ${draft.to} · next review ${reviewDate}`,
        },
      ];
      if (newHandoff) {
        activity.push({
          id: `act-${so.id}-handoff-${Date.now()}`,
          date: SENT_TS,
          actor: currentUser.fullName,
          action: 'Added to ERP Handoff',
          detail: `${so.number} queued in ERP Handoff (Pending) after the SO email was sent`,
        });
      }
      updateSalesOrder(so.id, { sentAt: SENT_TS, status: 'so_sent', erpHandoff, reviewDate, activity });
      updateEmail(email.id, { composeIntent: undefined, draft: undefined, draftSaved: false });
      addToast({
        type: 'success',
        title: 'Sales Order sent successfully.',
        message: newHandoff
          ? `${so.number} emailed to ${draft.to} and added to ERP Handoff (Pending).`
          : `${so.number} emailed to ${draft.to}. Already in the ERP Handoff queue.`,
      });
      return;
    }

    const target = isPoRequest ? 'awaiting_po' : 'awaiting_quote';
    const targetKeys = new Set(actionableFields(so.verificationFields).map((f) => f.key));
    const newFields: VerificationField[] = so.verificationFields.map((f) =>
      targetKeys.has(f.key) ? { ...f, resolution: target } : f
    );
    const newStatus = deriveVerificationStatus(newFields);
    updateSalesOrder(so.id, {
      verificationFields: newFields,
      verificationStatus: newStatus,
      reviewDate,
      activity: [
        ...so.activity,
        isPoRequest
          ? {
              id: `act-${so.id}-po-${Date.now()}`,
              date: SENT_TS,
              actor: currentUser.fullName,
              action: 'Requested updated PO from customer',
              detail: `${targetKeys.size} field(s) flagged · next review ${reviewDate}`,
            }
          : {
              id: `act-${so.id}-qc-${Date.now()}`,
              date: SENT_TS,
              actor: currentUser.fullName,
              action: 'Sent corrected quotation to customer',
              detail: `${attachment?.qtnNumber ?? so.quotationNumber ?? ''} → ${draft.to} · next review ${reviewDate}`,
            },
      ],
    });
    if (isQuoteCorrect && quotation) {
      updateQuotation(quotation.id, {
        reviewDate,
        lastUpdated: TODAY,
        activity: [
          ...quotation.activity,
          {
            id: `act-${quotation.id}-qc-${Date.now()}`,
            date: SENT_TS,
            actor: currentUser.fullName,
            action: 'Corrected quotation sent to customer',
            detail: `PO ${so.poNumber} · next review ${reviewDate}`,
          },
        ],
      });
    }
    // The PO conversation stays open — the correction is out, so the composer
    // resets and the workspace is free to prepare the next reply on it.
    updateEmail(email.id, {
      needsReview: newStatus !== 'verified',
      composeIntent: undefined,
      draft: undefined,
      draftSaved: false,
      attachedQuote: undefined,
    });
    addToast(
      isPoRequest
        ? {
            type: 'success',
            title: 'Updated PO requested',
            message: `Sent to ${draft.to}. Re-run the comparison once the updated PO arrives.`,
          }
        : {
            type: 'success',
            title: 'Corrected quotation sent',
            message: `Sent to ${draft.to}. Re-run the comparison once the customer accepts it.`,
          }
    );
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
      linkedSO: salesOrder?.number ?? email.linkedSO,
      inquiryId: inquiryId ?? email.inquiryId ?? quotation?.id,
      inquiryNo: email.inquiryNo,
      reviewDate,
      attachedQuote: attachment,
      attachedSalesOrder: soAttachment,
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

    if (soRevision && salesOrder && soAttachment) {
      sendSoRevision(salesOrder);
    } else if (poIntent && salesOrder) {
      // Checked BEFORE the quotation branch: a corrected quote sent during
      // verification must not be marked "Sent" and pushed into Follow-up
      // Pending — that quotation was already sent and accepted long ago.
      sendPoVerification(salesOrder);
    } else if (quotation && attachment) {
      // A revision leaves the queue as a NEW version: the quote as it stands
      // (the revised lines the editor saved) is frozen and appended, so the
      // history reads V1 → V2 rather than one record edited over.
      const existing = quotation.quoteVersions ?? [];
      const nextVersion = existing.length + 1;
      const versionPatch = revision
        ? {
            quoteVersions: [
              ...existing,
              {
                id: `qv-${quotation.id}-${nextVersion}`,
                label: `V${nextVersion}`,
                version: nextVersion,
                createdAt: SENT_TS,
                by: currentUser.fullName,
                value: quotation.value,
                items: quotation.items.map((it) => ({ ...it })),
                paymentTerms: quotation.paymentTerms,
                deliveryTerms: quotation.deliveryTerms,
                warranty: quotation.warranty,
                packingCharges: quotation.packingCharges,
                otherTerms: quotation.otherTerms,
                note: 'Revised quotation sent to customer',
                sent: true,
                sentAt: SENT_TS,
              },
            ],
            revisions: [
              ...quotation.revisions,
              {
                id: `rev-${quotation.id}-sent-${nextVersion}`,
                version: nextVersion,
                date: TODAY,
                reason: 'Revised quotation sent to customer',
                by: currentUser.fullName,
              },
            ],
          }
        : {};

      updateQuotation(quotation.id, {
        ...versionPatch,
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
            action: revision ? 'Revised quotation emailed to customer' : 'Quotation emailed to customer',
            detail:
              `${attachment.fileName} → ${draft.to} · ${formatINR(attachment.quoteValue)}` +
              (revision ? ` · saved as V${nextVersion}` : ''),
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
        title: revision ? 'Revised quotation sent successfully.' : 'Quotation sent successfully.',
        message: revision
          ? `${quotation.number} sent to ${draft.to} — saved as V${nextVersion} and moved from Quotes Needing Revision to Follow-up Pending.`
          : `${quotation.number} sent to ${draft.to} — moved from Quotes Pending to Follow-up Pending.`,
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
            {soRevision && salesOrder
              ? `Revised Sales Order ${salesOrder.number}`
              : isSoSend && salesOrder
                ? `Sales Order ${salesOrder.number}`
                : isPoRequest && salesOrder
                  ? `Updated PO requested — ${salesOrder.poNumber}`
                  : isQuoteCorrect && quotation
                    ? `Corrected Quotation ${quotation.number}`
                    : quotation
                      ? `Quotation ${quotation.number}`
                      : draft.subject || 'New Message'}
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

              {soAttachment && (
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5">
                  <FileText className="h-4 w-4 flex-none text-brand-600" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-surface-800">{soAttachment.fileName}</p>
                    <p className="text-[11px] text-surface-500">
                      {soAttachment.fileType}
                      {soAttachment.revisionLabel ? ` · ${soAttachment.revisionLabel}` : ''} ·{' '}
                      {soAttachment.sizeLabel ?? '—'} · {formatINR(soAttachment.value)}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowPreview(true)}
                    aria-label="Preview revised Sales Order"
                    title="Preview revised Sales Order"
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
              {attachment || soAttachment ? (
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

      {/* Sales Order preview — the document exactly as attached. In the revision
          flow it is built from the saved revised draft, so it shows the
          revision rather than the SO it replaces. */}
      {soAttachment && salesOrder && (() => {
        const snap = salesOrder.revisionDraft;
        const soForDoc = snap
          ? {
              ...salesOrder,
              items: snap.items,
              deliveryTerms: snap.deliveryTerms,
              paymentTerms: snap.paymentTerms,
              deliveryDate: snap.deliveryDate,
              billingAddress: snap.billingAddress,
              shippingAddress: snap.shippingAddress,
            }
          : salesOrder;
        const resolved = resolveSalesOrder(soForDoc, { parties, catalog: ITEMS });
        return (
          <Modal
            open={showPreview}
            onClose={() => setShowPreview(false)}
            size="xl"
            title={soRevision ? 'Revised Sales Order Preview' : 'Sales Order Preview'}
            subtitle={`${soAttachment.fileName}${soAttachment.revisionLabel ? ` · ${soAttachment.revisionLabel}` : ''} · ${formatINR(soAttachment.value)}`}
            footer={
              <Button variant="primary" onClick={() => setShowPreview(false)}>
                Close
              </Button>
            }
          >
            <SalesOrderDocument resolved={resolved} showLetterhead />
          </Modal>
        );
      })()}

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
