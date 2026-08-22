import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  FileSpreadsheet,
  Mail,
  Lock,
  Inbox,
  RefreshCw,
  ShieldCheck,
  Paperclip,
  ArrowLeft,
  Wand2,
  Pencil,
} from 'lucide-react';
import type { InboxEmail, Quotation, SalesOrder, VerificationField } from '@/types';
import { Button, IconButton, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { classNames, formatDate, formatDateTime, formatINR } from '@/lib/format';
import { poReceivedAtOf, slaDueAt, verificationSla } from '@/lib/sla';
import { SO_STATUS, VERIFICATION_STATUS } from '@/lib/labels';
import { resolveSalesOrder } from '@/lib/salesOrder';
import { soSendEmailPatch } from './helpers';
import { CorrectQuoteModal } from './CorrectQuoteModal';
import { SoPreviewModal } from './SoGenerationModal';
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

/**
 * RIGHT panel for a "PO vs Quote Verification" conversation. It surfaces the
 * field-by-field comparison and gates Sales-Order generation until every
 * mismatch is resolved. The two resolution paths only PREPARE the customer
 * email in the centre composer:
 *   • Request Updated PO  → prefill the composer with a PO-correction request
 *   • Correct Quote       → re-price the quotation in a full-width modal, then
 *                            attach the corrected PDF to the composer
 * Nothing is sent from this panel, and the workflow state only advances once
 * the email is actually sent from the centre panel. When the corrected document
 * comes back, the comparison is re-run from here and the record flips to
 * Verified the moment every field reconciles.
 */
export function PoVerificationPanel({
  email,
  onPrepared,
  onGenerateSo,
}: {
  email: InboxEmail;
  onPrepared?: () => void;
  /** Opens the large SO Generation modal (owned by GlobalInbox). */
  onGenerateSo?: () => void;
}) {
  const {
    salesOrders,
    quotations,
    updateSalesOrder,
    updateQuotation,
    updateEmail,
    addToast,
    currentUser,
    can,
    canInbox,
  } = useApp();

  const so = salesOrders.find((s) => s.id === email.poVerifyId) ?? null;
  const quote = so ? quotations.find((q) => q.id === so.quotationId) ?? null : null;

  const canVerify = can('sales_orders', 'edit');
  const canSend = canInbox('send');
  const canEditQuote = can('quotations', 'edit');

  const [tab, setTab] = useState<'compare' | 'generate'>('compare');
  // Correct Quote opens over the workspace (Path 2) rather than replacing this
  // panel — a quotation is not something to re-price inside a 320px strip.
  const [correcting, setCorrecting] = useState(false);

  useEffect(() => {
    setTab('compare');
    setCorrecting(false);
  }, [email.id]);

  const fields = so?.verificationFields ?? [];
  const unresolved = useMemo(() => unresolvedFields(fields), [fields]);
  const actionable = useMemo(() => actionableFields(fields), [fields]);
  const awaitingPo = fields.filter((f) => fieldResolution(f) === 'awaiting_po');
  const awaitingQuote = fields.filter((f) => fieldResolution(f) === 'awaiting_quote');
  const resolvedAll = allResolved(fields);

  if (!so) {
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

  // Once a correction is already out with the customer no field reads as a live
  // "mismatch" any more, so the email falls back to everything still
  // unreconciled rather than listing nothing at all.
  const mismatchLines = (actionable.length > 0 ? actionable : unresolved)
    .map((f) => `• ${f.label}: quotation shows "${f.quoteValue}", your PO shows "${f.poValue}"`)
    .join('\n');

  // ---- Path 1: prepare the "Request Updated PO" email in the centre panel ---
  const prepareRequestPo = () => {
    updateEmail(email.id, {
      composeIntent: 'po-request',
      attachedQuote: undefined,
      draft: {
        from: email.recipient,
        to: email.senderEmail,
        cc: email.cc.join(', '),
        subject: `Correction required in PO ${so.poNumber}`,
        body:
          `Dear ${contact},\n\nThank you for Purchase Order ${so.poNumber} issued against our quotation ${so.quotationNumber ?? ''}.\n\n` +
          `On verifying the PO against the accepted quotation, the following field(s) do not match and need a corrected Purchase Order:\n\n` +
          `${mismatchLines}\n\n` +
          `Request you to kindly share a revised Purchase Order reflecting the accepted terms so we may proceed with the Sales Order.\n\n` +
          emailSignature(so.owner, officeName(so.officeId)),
        relatedDoc: so.poNumber,
        aiGenerated: true,
      },
    });
    addToast({ type: 'success', title: 'Draft ready', message: 'Updated-PO request prepared in the centre panel. Set the review date and send.' });
    onPrepared?.();
  };

  // ---- Re-run the comparison once the corrected document is in ---------------
  // Manual and deliberate: receiving an email is not evidence that the numbers
  // now agree, so the fields awaiting that side are re-checked only when a
  // human says the corrected PO / quotation is actually available.
  const rerunComparison = (mode: 'po' | 'quote') => {
    const target = mode === 'po' ? 'awaiting_po' : 'awaiting_quote';
    const newFields: VerificationField[] = fields.map((f) =>
      fieldResolution(f) === target ? { ...f, resolution: 'resolved' } : f
    );
    const newStatus = deriveVerificationStatus(newFields);
    const nowVerified = newStatus === 'verified';
    const activity = [
      ...so.activity,
      {
        id: `act-${so.id}-rerun-${Date.now()}`,
        date: `${TODAY_ISO}T12:30:00`,
        actor: currentUser.fullName,
        action: mode === 'po' ? 'Comparison re-run against updated PO' : 'Comparison re-run against corrected quotation',
        detail: 'Corrected values reconciled against the accepted quotation.',
      },
    ];
    if (nowVerified) {
      activity.push({
        id: `act-${so.id}-verified-${Date.now()}`,
        date: `${TODAY_ISO}T12:30:00`,
        actor: currentUser.fullName,
        action: 'PO verified against quotation',
        detail: 'All fields resolved — ready for Sales Order generation.',
      });
    }
    updateSalesOrder(so.id, {
      verificationFields: newFields,
      verificationStatus: newStatus,
      verifiedBy: nowVerified ? currentUser.fullName : so.verifiedBy,
      verifiedAt: nowVerified ? `${TODAY_ISO}T12:30:00` : so.verifiedAt,
      activity,
    });
    updateEmail(email.id, { needsReview: !nowVerified });
    addToast({
      type: 'success',
      title: nowVerified ? 'Verification complete' : 'Comparison re-run',
      message: nowVerified
        ? 'Every field reconciles — the record is Verified and Sales Order generation is now available.'
        : 'Those fields now reconcile. The remaining mismatches still need resolution.',
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Case header */}
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge tone={statusMeta.tone} label={statusMeta.label} />
            {(() => { const info = verificationSla(so); return info ? <StatusBadge tone={info.tone} label={info.label} dot /> : null; })()}
          </div>
          <span className="text-[11px] font-semibold text-surface-400">{so.number}</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-y-0.5 text-[12px]">
          <p><span className="text-surface-400">PO Number:</span> <span className="font-semibold text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-700">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-700">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-700">{officeName(so.officeId)}</span> · <span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-700">{so.owner}</span></p>
          {(() => {
            const receivedAt = poReceivedAtOf(so);
            if (!receivedAt) return null;
            return (
              <p><span className="text-surface-400">PO Received:</span> <span className="font-medium text-surface-700">{formatDateTime(receivedAt)}</span> · <span className="text-surface-400">Due (24h SLA):</span> <span className="font-medium text-surface-700">{formatDateTime(slaDueAt(receivedAt))}</span></p>
            );
          })()}
          {so.reviewDate && (
            <p className="flex items-center gap-1 text-surface-500"><CalendarClock className="h-3 w-3" /> Next review (manual) {formatDate(so.reviewDate, { short: true })}</p>
          )}
        </div>
      </div>

      {/* Two-step tab strip — Tab 2 stays locked until every field is resolved */}
      <div className="flex-none border-b border-surface-200 px-4">
        <div className="flex gap-1">
          <TabButton active={tab === 'compare'} onClick={() => setTab('compare')} icon={<ClipboardCheck className="h-3.5 w-3.5" />}>
            PO vs Quote
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
        {tab === 'generate' ? (
          <GenerateTab email={email} so={so} quote={quote} onPrepared={onPrepared} onOpenSoModal={onGenerateSo} />
        ) : (
          <CompareTab
            fields={fields}
            unresolvedCount={unresolved.length}
            resolvedAll={resolvedAll}
            awaitingPoCount={awaitingPo.length}
            awaitingQuoteCount={awaitingQuote.length}
            canVerify={canVerify}
            canSend={canSend}
            canCorrect={canEditQuote && !!quote}
            hasQuoteIntent={email.composeIntent === 'quote-correct'}
            hasPoIntent={email.composeIntent === 'po-request'}
            onRequestPo={prepareRequestPo}
            onCorrectQuote={() => setCorrecting(true)}
            onRerunWithPo={() => rerunComparison('po')}
            onRerunWithQuote={() => rerunComparison('quote')}
          />
        )}
      </div>

      {/* Correct Quote — the quotation re-priced at full width, over the inbox.
          Only mounted while open so it seeds fresh from the current quotation. */}
      {correcting && quote && (
        <CorrectQuoteModal
          email={email}
          so={so}
          quote={quote}
          onAddedToEmail={() => {
            setCorrecting(false);
            onPrepared?.();
          }}
          onClose={() => setCorrecting(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CompareTab({
  fields,
  unresolvedCount,
  resolvedAll,
  awaitingPoCount,
  awaitingQuoteCount,
  canVerify,
  canSend,
  canCorrect,
  hasQuoteIntent,
  hasPoIntent,
  onRequestPo,
  onCorrectQuote,
  onRerunWithPo,
  onRerunWithQuote,
}: {
  fields: VerificationField[];
  unresolvedCount: number;
  resolvedAll: boolean;
  awaitingPoCount: number;
  awaitingQuoteCount: number;
  canVerify: boolean;
  canSend: boolean;
  canCorrect: boolean;
  hasQuoteIntent: boolean;
  hasPoIntent: boolean;
  onRequestPo: () => void;
  onCorrectQuote: () => void;
  onRerunWithPo: () => void;
  onRerunWithQuote: () => void;
}) {
  if (fields.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-surface-200 px-4 py-8 text-center">
        <ClipboardCheck className="mx-auto h-6 w-6 text-surface-300" />
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
            <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
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

      {/* Resolution actions — exactly two, because a mismatch has exactly two
          causes: the customer's PO is wrong, or our quotation is. One asks them
          to reissue, the other re-prices ours. Both end at the same composer. */}
      {!resolvedAll && (
        <section className="mt-4">
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Resolve Mismatches</h4>

          <div className="space-y-2 rounded-xl border border-surface-200 p-3">
            <p className="text-[12px] text-surface-600">
              {unresolvedCount} field{unresolvedCount === 1 ? '' : 's'} still to reconcile. Correct whichever side is wrong:
            </p>
            <div className="space-y-2.5">
              <div>
                <Button variant="primary" size="sm" className="w-full justify-start" leftIcon={<Mail className="h-4 w-4" />} onClick={onRequestPo} disabled={!canSend}>
                  Request Updated PO
                </Button>
                <p className="mt-1 pl-1 text-[11px] text-surface-400">Customer PO is wrong — ask for a corrected PO. Opens the compose window in the centre panel.</p>
                {hasPoIntent && (
                  <p className="mt-1 flex items-center gap-1 pl-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Draft ready in the centre composer.</p>
                )}
              </div>
              <div>
                <Button variant="secondary" size="sm" className="w-full justify-start" leftIcon={<Wand2 className="h-4 w-4" />} onClick={onCorrectQuote} disabled={!canCorrect}>
                  Correct Quote
                </Button>
                <p className="mt-1 pl-1 text-[11px] text-surface-400">Our quotation is wrong — re-price it in the editor, then attach the corrected quote to the email.</p>
                {hasQuoteIntent && (
                  <p className="mt-1 flex items-center gap-1 pl-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Corrected quote attached in the centre composer.</p>
                )}
              </div>
            </div>
            {!canSend && <p className="text-[11px] font-medium text-rose-600">Send permission required to email the customer.</p>}
            {!canCorrect && <p className="text-[11px] font-medium text-rose-600">Edit permission and a linked quotation are required to correct the quote.</p>}
          </div>

          {/* Re-run, never auto-run: a reply landing in the thread is not proof
              the numbers now agree. The comparison is redone on demand, once
              the corrected document is actually in hand. */}
          {(awaitingPoCount > 0 || awaitingQuoteCount > 0) && (
            <div className="mt-2 space-y-2 rounded-xl border border-surface-200 bg-surface-50/60 p-3">
              <p className="text-[12px] text-surface-600">Correction sent — re-run the comparison once the updated document is in hand:</p>
              {awaitingPoCount > 0 && (
                <Button variant="secondary" size="sm" className="w-full justify-start" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={onRerunWithPo} disabled={!canVerify}>
                  Re-run Comparison with Updated PO ({awaitingPoCount})
                </Button>
              )}
              {awaitingQuoteCount > 0 && (
                <Button variant="secondary" size="sm" className="w-full justify-start" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={onRerunWithQuote} disabled={!canVerify}>
                  Re-run Comparison with Corrected Quote ({awaitingQuoteCount})
                </Button>
              )}
              {!canVerify && <p className="text-[11px] font-medium text-rose-600">Edit permission required to re-run the comparison.</p>}
            </div>
          )}
        </section>
      )}

    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * SO Generation tab — entry point into the large SO Generation modal.
 *
 * The Generate action exists in exactly one state: verified, and no Sales Order
 * yet. The moment one exists the card flips to the generated document, whose
 * primary affordance is View Sales Order plus that order's current status —
 * there is no second Generate button to press, so a duplicate SO cannot be
 * created by pressing the same card twice. The only send path is the middle
 * composer ("Add Sales Order to Email"), and the SO reaches ERP Handoff only
 * once that email is actually sent.
 */
function GenerateTab({
  email,
  so,
  quote,
  onPrepared,
  onOpenSoModal,
}: {
  email: InboxEmail;
  so: SalesOrder;
  quote: Quotation | null;
  onPrepared?: () => void;
  onOpenSoModal?: () => void;
}) {
  const { parties, items: catalog, updateSalesOrder, updateEmail, addToast, currentUser, can } = useApp();
  const navigate = useNavigate();
  const canGenerate = can('sales_orders', 'create');

  const generated = so.soGenerated || !!so.erpHandoff;
  const soEmailed = !!so.sentAt; // SO Sent Date populated → the SO email has gone out
  // Handoff now happens at send time — only an EMAILED SO without a handoff
  // record (seed/legacy data) is broken and needs repair.
  const handoffMissing = soEmailed && !so.erpHandoff;

  const [preview, setPreview] = useState(false);
  const previewResolved = useMemo(() => resolveSalesOrder(so, { parties, catalog }), [so, parties, catalog]);

  // Repair a broken link: a Sales Order already emailed (seed/legacy) but with
  // no ERP Handoff record. Creates the missing Submitted handoff.
  const repairHandoff = () => {
    if (so.erpHandoff) return;
    const now = `${TODAY_ISO}T12:30:00`;
    updateSalesOrder(so.id, {
      erpHandoff: { state: 'submitted', source: 'po_verification', submittedAt: now, submittedBy: currentUser.fullName, updatedAt: now, revisionNumber: so.revisionNumber },
      activity: [
        ...so.activity,
        { id: `act-${so.id}-handoffrepair-${Date.now()}`, date: now, actor: currentUser.fullName, action: 'ERP Handoff record created', detail: `Linked ERP Handoff (Submitted) created for ${so.number}` },
      ],
    });
    addToast({ type: 'success', title: 'ERP Handoff linked', message: `${so.number} added to ERP Handoff (Submitted).` });
  };

  // Attach the generated SO PDF to the middle composer and prefill the customer
  // email. Only the system-generated SO document can be attached — there is no
  // generic file upload. The final send happens from the centre panel.
  const addSoToEmail = () => {
    updateEmail(email.id, soSendEmailPatch(email, so));
    addToast({ type: 'success', title: 'Added to email', message: 'Sales Order attached. Review the email in the centre panel and send it.' });
    onPrepared?.();
  };

  const soAttached = email.attachedSalesOrder?.soNumber === so.number && email.composeIntent === 'so-send';

  // ---- Not yet generated: entry card that opens the SO Generation drawer ----
  if (!generated) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          <ShieldCheck className="h-4 w-4 flex-none" />
          <span>
            PO verified against the accepted quotation
            {so.verifiedBy ? ` by ${so.verifiedBy}` : ''}
            {so.verifiedAt ? ` on ${formatDate(so.verifiedAt.slice(0, 10), { short: true })}` : ''}. The Sales Order is ready to be generated.
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-surface-200">
          <div className="flex items-center justify-between border-b border-surface-100 bg-surface-50/70 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
              <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> {so.number}
            </span>
            <StatusBadge tone="blue" label="Ready to Generate" dot />
          </div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px]">
            <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
            <p><span className="text-surface-400">PO Number:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
            <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? quote?.number ?? '—'}</span></p>
            <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
            <p><span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-800">{so.owner}</span></p>
          </div>
          <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
            <span className="text-[12px] font-medium text-surface-600">Order Value</span>
            <span className="text-[15px] font-bold text-surface-900">{formatINR(so.value)}</span>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          className="w-full"
          leftIcon={<FileSpreadsheet className="h-4 w-4" />}
          onClick={onOpenSoModal}
          disabled={!canGenerate}
          title={!canGenerate ? 'You do not have permission to generate Sales Orders' : 'Open the prefilled Sales Order form'}
        >
          Generate Sales Order
        </Button>
        <p className="text-center text-[11px] text-surface-400">
          Opens the prefilled Sales Order form. Once generated, it is attached to the email and submitted to ERP Handoff after the email is sent.
        </p>
        {!canGenerate && <p className="text-center text-[11px] font-medium text-rose-600">Create permission required.</p>}
      </div>
    );
  }

  // ---- Generated document view (read-only) ---------------------------------
  const paymentTermsText = so.paymentTerms || '—';
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
        <CheckCircle2 className="h-4 w-4 flex-none" />
        <span>
          <span className="font-semibold">{so.number}</span> generated from the verified PO &amp; quotation
          {so.erpHandoff ? ' and added to ERP Handoff (Submitted).' : '.'}
          {!so.erpHandoff && !soEmailed && ' It will be submitted to ERP Handoff once the email is sent.'}
          {!soEmailed && ' Review the email in the centre panel and send it.'}
        </span>
      </div>

      {/* Generated SO document summary */}
      <div className="overflow-hidden rounded-xl border border-surface-200">
        <div className="flex items-center justify-between border-b border-surface-100 bg-surface-50/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
            <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> {so.number}
          </span>
          {/* The record's own lifecycle status once it has actually gone out;
              until then "Generated" — so.status flips to so_sent at generation
              time and would otherwise claim a send that has not happened. */}
          {soEmailed ? (
            <StatusBadge tone={SO_STATUS[so.status].tone} label={SO_STATUS[so.status].label} dot />
          ) : (
            <StatusBadge tone="blue" label="Generated" dot />
          )}
        </div>
        <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px] sm:grid-cols-2">
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
          <p><span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-800">{so.owner}</span></p>
          <p><span className="text-surface-400">PO Number:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">PO Date:</span> <span className="font-medium text-surface-800">{formatDate(so.poDate, { short: true })}</span></p>
          <p><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-800">{paymentTermsText}</span></p>
          <p><span className="text-surface-400">Delivery:</span> <span className="font-medium text-surface-800">{so.deliveryTerms}</span></p>
          {so.sentAt && <p><span className="text-surface-400">SO Sent Date:</span> <span className="font-medium text-surface-800">{formatDate(so.sentAt.slice(0, 10), { short: true })}</span></p>}
        </div>
        <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
          <span className="text-[12px] font-medium text-surface-600">Order Value</span>
          <span className="text-[15px] font-bold text-surface-900">{formatINR(so.value)}</span>
        </div>
      </div>

      {handoffMissing && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          <p className="flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 flex-none" /> This Sales Order has no linked ERP Handoff record.
          </p>
          <Button variant="secondary" size="sm" className="mt-2 w-full" onClick={repairHandoff}>Create ERP Handoff record</Button>
        </div>
      )}

      {soAttached && !soEmailed && (
        <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
          <Paperclip className="h-4 w-4 flex-none" /> Sales Order added to the email — review and send it from the centre panel.
        </div>
      )}

      {soEmailed && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          <CheckCircle2 className="h-4 w-4 flex-none" /> Sales Order emailed to the customer on {formatDate(so.sentAt!.slice(0, 10), { short: true })}.
        </div>
      )}

      {/* Generated-SO actions — NO direct send here; the send is the composer's */}
      <div className="space-y-2">
        {!soEmailed && (
          /* Secondary Edit / Preview are compact icon buttons; the primary
             Add-to-Email action keeps its visible text label. */
          <div className="flex items-center gap-2">
            <IconButton label="Edit Sales Order" icon={<Pencil className="h-4 w-4" />} onClick={onOpenSoModal} disabled={!canGenerate} />
            <IconButton label="Preview Sales Order" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)} />
            <Button variant="primary" size="sm" className="min-w-0 flex-1" leftIcon={<Mail className="h-4 w-4" />} onClick={addSoToEmail}>
              {soAttached ? 'Update Sales Order in Email' : 'Add Sales Order to Email'}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant={soEmailed ? 'primary' : 'secondary'} size="sm" leftIcon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => navigate('/sales-orders', { state: { highlightId: so.id } })}>
            View Sales Order
          </Button>
          {so.erpHandoff && (
            <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="h-3.5 w-3.5 rotate-180" />} onClick={() => navigate('/erp-handoff', { state: { highlightId: so.id } })}>View in ERP Handoff</Button>
          )}
        </div>
      </div>

      <SoPreviewModal open={preview} onClose={() => setPreview(false)} resolved={previewResolved} />
    </div>
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
