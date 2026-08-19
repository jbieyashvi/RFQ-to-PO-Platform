import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Sparkles,
  Send,
  Eye,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Ban,
  ClipboardCheck,
  FileSpreadsheet,
  Mail,
  Paperclip,
  Lock,
  Inbox,
  ShieldCheck,
} from 'lucide-react';
import type { EmailAttachment, InboxEmail, SalesOrder, VerificationField } from '@/types';
import { Button, Modal, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { classNames, formatDate, formatINR, lineTotal } from '@/lib/format';
import { VERIFICATION_STATUS } from '@/lib/labels';
import {
  FIELD_RESOLUTION_META,
  actionableFields,
  allResolved,
  deriveVerificationStatus,
  fieldResolution,
  unresolvedFields,
} from '@/lib/verification';

// Prototype "today" — kept consistent with the rest of the app's seeded data.
const TODAY_ISO = '2026-08-13';
const TODAY_TS = '2026-08-13T12:30:00';

type ComposerMode = 'po' | 'quote';

let outSeq = 0;

export function PoVerificationPanel({ email }: { email: InboxEmail }) {
  const {
    salesOrders,
    quotations,
    updateSalesOrder,
    updateEmail,
    addEmail,
    addToast,
    currentUser,
    can,
    canInbox,
  } = useApp();
  const navigate = useNavigate();

  const so = salesOrders.find((s) => s.id === email.poVerifyId) ?? null;
  const quote = so ? quotations.find((q) => q.id === so.quotationId) ?? null : null;

  const canVerify = can('sales_orders', 'edit');
  const canGenerate = can('sales_orders', 'create');
  const canSend = canInbox('send');

  const [tab, setTab] = useState<'compare' | 'generate'>('compare');
  const [showLatest, setShowLatest] = useState(false);

  // Composer state (Request Updated PO / Send Updated Quote).
  const [composer, setComposer] = useState<ComposerMode | null>(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [reviewDate, setReviewDate] = useState('');
  const [dateError, setDateError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    setTab('compare');
    setComposer(null);
    setShowLatest(false);
    setPreview(false);
    setDateError(null);
  }, [email.id]);

  const fields = so?.verificationFields ?? [];
  const unresolved = useMemo(() => unresolvedFields(fields), [fields]);
  const actionable = useMemo(() => actionableFields(fields), [fields]);
  const awaitingPo = fields.filter((f) => fieldResolution(f) === 'awaiting_po');
  const awaitingQuote = fields.filter((f) => fieldResolution(f) === 'awaiting_quote');
  const resolvedAll = allResolved(fields);

  if (!so) {
    // Exact copy required by the spec when the linked PO email/record is missing.
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-xs">
          <Inbox className="mx-auto h-8 w-8 text-surface-300" />
          <p className="mt-3 text-[13px] font-medium text-surface-700">
            The source Purchase Order email could not be found.
          </p>
        </div>
      </div>
    );
  }

  const statusMeta = VERIFICATION_STATUS[so.verificationStatus];
  const contact = (so.customerName.split(' ')[0] || 'Sir/Madam').trim();

  // ---- Composer builders ---------------------------------------------------
  const openComposer = (mode: ComposerMode) => {
    const mismatchLines = actionable
      .map((f) => `• ${f.label}: quotation shows "${f.quoteValue}", your PO shows "${f.poValue}"`)
      .join('\n');
    setTo(email.senderEmail);
    if (mode === 'po') {
      setSubject(`Request for updated Purchase Order — ${so.poNumber}`);
      setBody(
        `Dear ${contact},\n\nThank you for Purchase Order ${so.poNumber} issued against our quotation ${so.quotationNumber ?? ''}.\n\n` +
          `On verifying the PO against the accepted quotation, the following field(s) do not match and require a corrected Purchase Order:\n\n` +
          `${mismatchLines}\n\n` +
          `Request you to kindly share a revised Purchase Order reflecting the accepted terms so we may proceed with the Sales Order.\n\n` +
          `Warm regards,\n${so.owner}\nNexus RFQ — ${officeName(so.officeId)}`
      );
      setAttachments([]);
    } else {
      const pdfName = `${(so.quotationNumber ?? 'quotation').replace(/\//g, '-')}-latest.pdf`;
      setSubject(`Updated quotation ${so.quotationNumber ?? ''} — ${so.customerName}`);
      setBody(
        `Dear ${contact},\n\nFollowing your Purchase Order ${so.poNumber}, please find attached our latest quotation ${so.quotationNumber ?? ''} reflecting the correct terms for the following field(s):\n\n` +
          `${mismatchLines}\n\n` +
          `Kindly review and confirm so we may align the Purchase Order and proceed with the Sales Order.\n\n` +
          `Warm regards,\n${so.owner}\nNexus RFQ — ${officeName(so.officeId)}`
      );
      setAttachments([
        { id: `att-q-${so.id}`, name: pdfName, size: '212 KB', type: 'PDF' },
      ]);
    }
    setReviewDate(so.reviewDate ?? '');
    setDateError(null);
    setPreview(false);
    setComposer(mode);
  };

  const closeComposer = () => {
    setComposer(null);
    setPreview(false);
    setDateError(null);
  };

  // Validate the mandatory review date, then commit the email action + workflow
  // state + review date together (spec §6).
  const confirmSend = () => {
    if (!composer) return;
    if (!reviewDate || reviewDate < TODAY_ISO) {
      setDateError('Select the next review date before completing this action.');
      setPreview(false);
      return;
    }
    const mode = composer;
    const targetKeys = new Set(actionable.map((f) => f.key));
    const nextResolution = mode === 'po' ? 'awaiting_po' : 'awaiting_quote';
    const newFields: VerificationField[] = fields.map((f) =>
      targetKeys.has(f.key) ? { ...f, resolution: nextResolution } : f
    );
    const newStatus = deriveVerificationStatus(newFields);

    const action = mode === 'po' ? 'Requested updated PO from customer' : 'Sent updated quotation to customer';
    const detail =
      mode === 'po'
        ? `${targetKeys.size} field(s) flagged · next review ${reviewDate}`
        : `${so.quotationNumber ?? ''} attached · next review ${reviewDate}`;

    updateSalesOrder(so.id, {
      verificationFields: newFields,
      verificationStatus: newStatus,
      reviewDate,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-${mode}-${++outSeq}`, date: TODAY_TS, actor: currentUser.fullName, action, detail },
      ],
    });

    // Reflect the review date on the source PO email and record the outgoing mail.
    updateEmail(email.id, { reviewDate, needsReview: newStatus !== 'verified' });
    addEmail({
      id: `em-out-${so.id}-${mode}-${outSeq}`,
      senderName: so.owner,
      senderEmail: email.recipient,
      recipient: to,
      cc: [],
      subject,
      receivedAt: TODAY_TS,
      body,
      thread: [],
      attachments,
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
      extraction: [],
      extractionConfirmed: true,
      draftSaved: true,
      sent: true,
      sentAt: TODAY_TS,
    });

    addToast({
      type: 'success',
      title: mode === 'po' ? 'Updated PO requested' : 'Updated quote sent',
      message: `Sent to ${to}. Next review ${formatDate(reviewDate, { short: true })}.`,
    });
    closeComposer();
  };

  // Record that the awaited correction was received & accepted → those fields
  // resolve; when the last one clears, the SO is verified (who/when recorded).
  const acceptCorrection = (mode: ComposerMode) => {
    const target = mode === 'po' ? 'awaiting_po' : 'awaiting_quote';
    const newFields: VerificationField[] = fields.map((f) =>
      fieldResolution(f) === target ? { ...f, resolution: 'resolved' } : f
    );
    const newStatus = deriveVerificationStatus(newFields);
    const nowVerified = newStatus === 'verified';
    const activity = [
      ...so.activity,
      {
        id: `act-${so.id}-accept-${++outSeq}`,
        date: TODAY_TS,
        actor: currentUser.fullName,
        action: mode === 'po' ? 'Updated PO received & accepted' : 'Updated quotation accepted',
        detail: 'Corrected values reconciled against the accepted quotation.',
      },
    ];
    if (nowVerified) {
      activity.push({
        id: `act-${so.id}-verified-${outSeq}`,
        date: TODAY_TS,
        actor: currentUser.fullName,
        action: 'PO verified against quotation',
        detail: 'All fields resolved — ready for Sales Order generation.',
      });
    }
    updateSalesOrder(so.id, {
      verificationFields: newFields,
      verificationStatus: newStatus,
      verifiedBy: nowVerified ? currentUser.fullName : so.verifiedBy,
      verifiedAt: nowVerified ? TODAY_TS : so.verifiedAt,
      activity,
    });
    updateEmail(email.id, { needsReview: !nowVerified });
    addToast({
      type: 'success',
      title: nowVerified ? 'Verification complete' : 'Correction accepted',
      message: nowVerified
        ? 'All fields resolved — Sales Order generation is now available.'
        : 'Field resolved. Remaining mismatches still need resolution.',
    });
  };

  const generateSO = () => {
    if (!resolvedAll) return;
    const verifiedBy = so.verifiedBy ?? currentUser.fullName;
    const verifiedAt = so.verifiedAt ?? TODAY_TS;
    updateSalesOrder(so.id, {
      soGenerated: true,
      verifiedBy,
      verifiedAt,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-sogen-${++outSeq}`, date: TODAY_TS, actor: currentUser.fullName, action: 'Sales Order generated', detail: `${so.number} generated from verified PO & quotation` },
      ],
    });
    addToast({ type: 'success', title: 'Sales Order generated', message: `${so.number} created from verified data.` });
    navigate('/sales-orders');
  };

  const dateInvalid = !reviewDate || reviewDate < TODAY_ISO;

  return (
    <div className="flex h-full flex-col">
      {/* Case header */}
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone={statusMeta.tone} label={statusMeta.label} />
          <span className="text-[11px] font-semibold text-surface-400">{so.number}</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-y-0.5 text-[12px]">
          <p><span className="text-surface-400">PO Number:</span> <span className="font-semibold text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-700">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-700">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-700">{officeName(so.officeId)}</span> · <span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-700">{so.owner}</span></p>
          {so.reviewDate && (
            <p className="flex items-center gap-1 text-surface-500"><CalendarClock className="h-3 w-3" /> Next review {formatDate(so.reviewDate, { short: true })}</p>
          )}
        </div>
      </div>

      {/* Two-step tab strip — Tab 2 stays locked until every field is resolved */}
      <div className="flex-none border-b border-surface-200 px-4">
        <div className="flex gap-1">
          <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={<ClipboardCheck className="h-3.5 w-3.5" />}>
            PO vs Quote Mismatch
          </TabButton>
          <TabButton
            active={tab === 'generate'}
            onClick={() => resolvedAll && setTab('generate')}
            disabled={!resolvedAll}
            icon={resolvedAll ? <FileSpreadsheet className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          >
            SO Generation
          </TabButton>
        </div>
        {!resolvedAll && (
          <p className="flex items-center gap-1 py-1.5 text-[11px] text-surface-400">
            <Lock className="h-3 w-3" /> Resolve all PO and quotation mismatches before generating the Sales Order.
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {tab === 'compare' ? (
          <CompareTab
            so={so}
            fields={fields}
            unresolvedCount={unresolved.length}
            resolvedAll={resolvedAll}
            actionableCount={actionable.length}
            awaitingPoCount={awaitingPo.length}
            awaitingQuoteCount={awaitingQuote.length}
            canVerify={canVerify}
            canSend={canSend}
            onRequestPo={() => openComposer('po')}
            onSendQuote={() => openComposer('quote')}
            onViewLatest={() => setShowLatest(true)}
            onAcceptPo={() => acceptCorrection('po')}
            onAcceptQuote={() => acceptCorrection('quote')}
          />
        ) : (
          <GenerateTab so={so} canGenerate={canGenerate} onGenerate={generateSO} />
        )}
      </div>

      {/* Composer modal — Request Updated PO / Send Updated Quote */}
      <Modal
        open={composer !== null}
        onClose={closeComposer}
        size="xl"
        title={composer === 'po' ? 'Request Updated PO' : 'Send Updated Quote'}
        subtitle={`${so.customerName} · ${so.poNumber}`}
        footer={
          <>
            <Button variant="secondary" onClick={closeComposer}>Cancel</Button>
            <Button
              variant="primary"
              leftIcon={canSend ? <Send className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
              onClick={() => (dateInvalid ? setDateError('Select the next review date before completing this action.') : setPreview(true))}
              disabled={!canSend}
              title={!canSend ? 'You do not have permission to send' : 'Review before sending'}
            >
              Review &amp; Send
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
            <Sparkles className="h-4 w-4 flex-none" />
            {composer === 'po'
              ? 'Draft prepared for the customer. Edit anything before sending — nothing is sent until you confirm.'
              : 'The latest quotation PDF is attached automatically. Edit the message before sending — nothing is sent until you confirm.'}
          </div>

          <LabeledInput label="To" value={to} onChange={setTo} />
          <LabeledInput label="Subject" value={subject} onChange={setSubject} />
          <div>
            <label className="mb-1 block text-[12px] font-medium text-surface-600">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              className="input w-full px-2.5 py-1.5 text-[12px]"
            />
          </div>

          {/* Attachments — the updated-quote PDF is shown clearly */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-surface-600">
              <Paperclip className="h-3.5 w-3.5" /> Attachments
            </label>
            {attachments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-surface-200 px-3 py-2 text-[12px] text-surface-400">
                No attachment required for this request.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 px-3 py-1.5">
                    <FileText className="h-4 w-4 text-brand-500" />
                    <span className="flex-1 truncate text-[12px] font-medium text-surface-700">{a.name}</span>
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-700">Latest quotation</span>
                    <span className="text-[11px] text-surface-400">{a.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Mandatory review date */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-surface-600">
              <CalendarClock className="h-3.5 w-3.5" /> Next Review Date <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              value={reviewDate}
              min={TODAY_ISO}
              onChange={(e) => {
                setReviewDate(e.target.value);
                setDateError(null);
              }}
              className={classNames('input h-8 w-full px-2.5 py-0 text-[12px]', dateError && 'border-rose-400')}
            />
            {dateError ? (
              <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-rose-600">
                <AlertTriangle className="h-3 w-3" /> {dateError}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-surface-400">Required — today or a future date. Saved together with this action.</p>
            )}
          </div>
        </div>
      </Modal>

      {/* Final confirm before the email actually leaves */}
      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        size="lg"
        title={composer === 'po' ? 'Confirm — Request Updated PO' : 'Confirm — Send Updated Quote'}
        subtitle={`${so.customerName} · next review ${reviewDate ? formatDate(reviewDate, { short: true }) : '—'}`}
        footer={
          <>
            <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => setPreview(false)}>Back to Edit</Button>
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={confirmSend}>Confirm &amp; Send</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-surface-200">
            <div className="space-y-1 border-b border-surface-100 px-4 py-3 text-[13px]">
              <p><span className="text-surface-400">To:</span> <span className="font-medium text-surface-800">{to}</span></p>
              <p><span className="text-surface-400">Subject:</span> <span className="font-medium text-surface-800">{subject}</span></p>
            </div>
            <div className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-surface-700">{body}</div>
            {attachments.length > 0 && (
              <div className="border-t border-surface-100 px-4 py-3">
                <ul className="flex flex-wrap gap-2">
                  {attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1 text-[12px] text-surface-700">
                      <FileText className="h-3.5 w-3.5 text-brand-500" /> {a.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <CalendarClock className="h-4 w-4 flex-none" />
            After sending, this case moves to
            <span className="font-semibold">{composer === 'po' ? ' Updated PO Awaited' : ' Updated Quote Sent'}</span>
            with a review date of {reviewDate ? formatDate(reviewDate, { short: true }) : '—'}.
          </div>
        </div>
      </Modal>

      {/* View Latest Quote */}
      <Modal
        open={showLatest}
        onClose={() => setShowLatest(false)}
        size="lg"
        title="Latest Quotation"
        subtitle={`${so.quotationNumber ?? ''} · ${so.customerName}`}
        footer={<Button variant="primary" onClick={() => setShowLatest(false)}>Close</Button>}
      >
        {quote ? (
          <div className="overflow-hidden rounded-xl border border-surface-200">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit Price</th>
                  <th className="px-3 py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {quote.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description}</p><p className="text-[10.5px] text-surface-400">{it.itemCode}</p></td>
                    <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                    <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                    <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
              <span className="text-[12px] font-medium text-surface-600">Quotation Value</span>
              <span className="text-[14px] font-bold text-surface-900">{formatINR(quote.value)}</span>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-surface-500">The linked quotation could not be found.</p>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CompareTab({
  so,
  fields,
  unresolvedCount,
  resolvedAll,
  actionableCount,
  awaitingPoCount,
  awaitingQuoteCount,
  canVerify,
  canSend,
  onRequestPo,
  onSendQuote,
  onViewLatest,
  onAcceptPo,
  onAcceptQuote,
}: {
  so: SalesOrder;
  fields: VerificationField[];
  unresolvedCount: number;
  resolvedAll: boolean;
  actionableCount: number;
  awaitingPoCount: number;
  awaitingQuoteCount: number;
  canVerify: boolean;
  canSend: boolean;
  onRequestPo: () => void;
  onSendQuote: () => void;
  onViewLatest: () => void;
  onAcceptPo: () => void;
  onAcceptQuote: () => void;
}) {
  if (fields.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-surface-200 px-4 py-8 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-surface-300" />
        <p className="mt-2 text-[12px] text-surface-500">
          The PO vs Quote comparison will be generated automatically once this Purchase Order email is processed.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* AI comparison banner + summary */}
      <div className="mb-3 flex items-center gap-1.5">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-50 text-brand-600"><Sparkles className="h-3 w-3" /></span>
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">Accepted Quotation vs Customer PO</h3>
      </div>

      <div
        className={classNames(
          'mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]',
          resolvedAll ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'
        )}
      >
        {resolvedAll ? <CheckCircle2 className="h-4 w-4 flex-none" /> : <AlertTriangle className="h-4 w-4 flex-none" />}
        <span>
          {resolvedAll
            ? 'All fields resolved — the Sales Order can now be generated.'
            : `${unresolvedCount} field${unresolvedCount === 1 ? '' : 's'} require resolution before a Sales Order can be generated.`}
        </span>
      </div>

      {/* Comparison table */}
      <div className="overflow-hidden rounded-xl border border-surface-200">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-surface-500">
              <th className="px-2.5 py-2 text-left">Field</th>
              <th className="px-2.5 py-2 text-left">Accepted Quotation</th>
              <th className="px-2.5 py-2 text-left">Customer PO</th>
              <th className="px-2.5 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {fields.map((f) => {
              const res = fieldResolution(f);
              const meta = FIELD_RESOLUTION_META[res];
              const bad = res !== 'matched' && res !== 'resolved';
              return (
                <tr key={f.key}>
                  <td className="px-2.5 py-2 align-top font-medium text-surface-800">{f.label}</td>
                  <td className="px-2.5 py-2 align-top text-surface-700">{f.quoteValue}</td>
                  <td className={classNames('px-2.5 py-2 align-top', bad ? 'font-medium text-rose-700' : 'text-surface-700')}>{f.poValue}</td>
                  <td className="px-2.5 py-2 align-top"><StatusBadge tone={meta.tone} label={meta.label} dot /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Resolution actions */}
      {!resolvedAll && (
        <section className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Resolve Mismatches</h4>

          {actionableCount > 0 && (
            <div className="space-y-2 rounded-xl border border-surface-200 p-3">
              <p className="text-[12px] text-surface-600">
                {actionableCount} field{actionableCount === 1 ? '' : 's'} still mismatched. Choose how to reconcile them:
              </p>
              <div className="grid grid-cols-1 gap-2">
                <Button variant="primary" size="sm" className="justify-start" leftIcon={<Mail className="h-4 w-4" />} onClick={onRequestPo} disabled={!canSend}>
                  Request Updated PO
                </Button>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-none" leftIcon={<Eye className="h-4 w-4" />} onClick={onViewLatest}>
                    View Latest Quote
                  </Button>
                  <Button variant="secondary" size="sm" className="flex-1 justify-start" leftIcon={<Send className="h-4 w-4" />} onClick={onSendQuote} disabled={!canSend}>
                    Send Updated Quote
                  </Button>
                </div>
              </div>
              {!canSend && <p className="text-[11px] font-medium text-rose-600">Send permission required to email the customer.</p>}
            </div>
          )}

          {(awaitingPoCount > 0 || awaitingQuoteCount > 0) && (
            <div className="mt-2 space-y-2 rounded-xl border border-surface-200 bg-surface-50/60 p-3">
              <p className="text-[12px] text-surface-600">Corrections requested — record the reply once the customer responds:</p>
              {awaitingPoCount > 0 && (
                <Button variant="secondary" size="sm" className="w-full justify-start" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={onAcceptPo} disabled={!canVerify}>
                  Record updated PO received &amp; accepted ({awaitingPoCount})
                </Button>
              )}
              {awaitingQuoteCount > 0 && (
                <Button variant="secondary" size="sm" className="w-full justify-start" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={onAcceptQuote} disabled={!canVerify}>
                  Record updated quote accepted ({awaitingQuoteCount})
                </Button>
              )}
              {!canVerify && <p className="text-[11px] font-medium text-rose-600">Edit permission required to resolve fields.</p>}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function GenerateTab({ so, canGenerate, onGenerate }: { so: SalesOrder; canGenerate: boolean; onGenerate: () => void }) {
  const total = so.poValue;
  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
        <ShieldCheck className="h-4 w-4 flex-none" />
        <span>
          PO verified against the accepted quotation
          {so.verifiedBy ? ` by ${so.verifiedBy}` : ''}
          {so.verifiedAt ? ` on ${formatDate(so.verifiedAt.slice(0, 10), { short: true })}` : ''}. Verified data is carried into the Sales Order below.
        </span>
      </div>

      <div className="rounded-xl border border-surface-200">
        <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-4 py-3 text-[12px] sm:grid-cols-2">
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
          <p><span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-800">{so.owner}</span></p>
          <p><span className="text-surface-400">PO Number:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">PO Date:</span> <span className="font-medium text-surface-800">{formatDate(so.poDate, { short: true })}</span></p>
          <p><span className="text-surface-400">Payment Terms:</span> <span className="font-medium text-surface-800">{so.paymentTerms}</span></p>
          <p><span className="text-surface-400">Delivery Terms:</span> <span className="font-medium text-surface-800">{so.deliveryTerms}</span></p>
        </div>
        <div className="flex items-center justify-between border-t border-surface-200 px-4 py-2.5">
          <span className="text-[12px] font-medium text-surface-600">Verified Order Value</span>
          <span className="text-[15px] font-bold text-surface-900">{formatINR(total)}</span>
        </div>
      </div>

      {so.soGenerated ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          <CheckCircle2 className="h-4 w-4 flex-none" /> Sales Order {so.number} has been generated from the verified data.
        </div>
      ) : (
        <div className="mt-4">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            leftIcon={<FileSpreadsheet className="h-4 w-4" />}
            onClick={onGenerate}
            disabled={!canGenerate}
            title={!canGenerate ? 'You do not have permission to generate Sales Orders' : 'Generate the Sales Order from the verified data'}
          >
            Generate Sales Order
          </Button>
          {!canGenerate && <p className="mt-1.5 text-center text-[11px] font-medium text-rose-600">Create permission required.</p>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  disabled,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={classNames(
        '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-[12px] font-medium transition-colors',
        active
          ? 'border-brand-600 text-brand-700'
          : disabled
          ? 'cursor-not-allowed border-transparent text-surface-300'
          : 'border-transparent text-surface-500 hover:border-surface-300 hover:text-surface-700'
      )}
      title={disabled ? 'Resolve all PO and quotation mismatches before generating the Sales Order.' : undefined}
    >
      {icon}
      {children}
    </button>
  );
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-medium text-surface-600">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input h-8 w-full px-2.5 py-0 text-[12px]" />
    </div>
  );
}
