import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Sparkles,
  Eye,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Ban,
  ClipboardCheck,
  FileSpreadsheet,
  Mail,
  Lock,
  Inbox,
  ShieldCheck,
  Paperclip,
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  Wand2,
} from 'lucide-react';
import type { InboxEmail, LineItem, Quotation, SalesOrder, VerificationField } from '@/types';
import { Button, Modal, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { ITEMS } from '@/data/masters';
import { classNames, formatDate, formatINR, lineTotal } from '@/lib/format';
import { VERIFICATION_STATUS } from '@/lib/labels';
import { buildVersions, grandTotalOf } from '@/lib/revisionQueue';
import { quoteSignature } from './helpers';
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
const ATTACH_TS = '2026-08-13T12:40:00';

const clone = (it: LineItem): LineItem => ({ ...it });

/**
 * RIGHT panel for a "PO vs Quote Verification" conversation. It surfaces the
 * field-by-field comparison and gates Sales-Order generation until every
 * mismatch is resolved. The two resolution paths only PREPARE the customer
 * email in the centre composer:
 *   • Request Updated PO  → prefill the composer with a PO-correction request
 *   • Correct Quote       → edit the quotation here, then attach the corrected
 *                            PDF to the composer
 * Nothing is sent from this panel, and the workflow state only advances once
 * the email is actually sent from the centre panel.
 */
export function PoVerificationPanel({
  email,
  onPrepared,
}: {
  email: InboxEmail;
  onPrepared?: () => void;
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
  const navigate = useNavigate();

  const so = salesOrders.find((s) => s.id === email.poVerifyId) ?? null;
  const quote = so ? quotations.find((q) => q.id === so.quotationId) ?? null : null;

  const canVerify = can('sales_orders', 'edit');
  const canGenerate = can('sales_orders', 'create');
  const canSend = canInbox('send');
  const canEditQuote = can('quotations', 'edit');

  const [tab, setTab] = useState<'compare' | 'generate'>('compare');
  const [showLatest, setShowLatest] = useState(false);

  // Correct-Quote editor state (Path 2).
  const [correcting, setCorrecting] = useState(false);
  const [items, setItems] = useState<LineItem[]>([]);
  const [addId, setAddId] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    setTab('compare');
    setShowLatest(false);
    setCorrecting(false);
    setShowPreview(false);
    setAddId('');
  }, [email.id]);

  const fields = so?.verificationFields ?? [];
  const unresolved = useMemo(() => unresolvedFields(fields), [fields]);
  const actionable = useMemo(() => actionableFields(fields), [fields]);
  const awaitingPo = fields.filter((f) => fieldResolution(f) === 'awaiting_po');
  const awaitingQuote = fields.filter((f) => fieldResolution(f) === 'awaiting_quote');
  const resolvedAll = allResolved(fields);

  const packing = quote?.packingCharges ?? 0;
  const correctedTotal = useMemo(() => grandTotalOf(items, packing), [items, packing]);

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
  const attached = email.attachedQuote;

  const mismatchLines = actionable
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
          `Warm regards,\n${so.owner}\nNexus RFQ — ${officeName(so.officeId)}`,
        relatedDoc: so.poNumber,
        aiGenerated: true,
      },
    });
    addToast({ type: 'success', title: 'Draft ready', message: 'Updated-PO request prepared in the centre panel. Set the review date and send.' });
    onPrepared?.();
  };

  // ---- Path 2: Correct Quote editor ----------------------------------------
  const startCorrecting = () => {
    if (!quote) return;
    setItems(quote.items.map(clone));
    setAddId('');
    setCorrecting(true);
  };

  const setLine = (id: string, patch: Partial<Pick<LineItem, 'quantity' | 'unitPrice'>>) =>
    setItems((rows) => rows.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeLine = (id: string) => setItems((rows) => rows.filter((it) => it.id !== id));
  const addLine = () => {
    const src = ITEMS.find((it) => it.id === addId);
    if (!src) return;
    setItems((rows) => [
      ...rows,
      {
        id: `ln-add-${src.id}-${rows.length}`,
        itemId: src.id,
        itemCode: src.code,
        description: src.name,
        hsnCode: src.hsnCode,
        quantity: 1,
        unit: src.unit,
        unitPrice: src.unitPrice,
        discountPct: 0,
        taxPct: 18,
      },
    ]);
    setAddId('');
  };

  // Persist the corrected quote, seeding a baseline version before overwriting.
  const persistCorrection = (): number => {
    if (!quote) return correctedTotal;
    const value = grandTotalOf(items, packing);
    const { existing } = buildVersions(quote, currentUser.fullName);
    updateQuotation(quote.id, {
      quoteVersions: existing,
      items: items.map(clone),
      value,
      lastUpdated: '2026-08-13',
      revisions: [
        ...quote.revisions,
        { id: `rev-${quote.id}-corr-${quote.revisions.length + 1}`, version: existing.length + 1, date: '2026-08-13', reason: `Corrected against PO ${so.poNumber}`, by: currentUser.fullName },
      ],
      activity: [
        ...quote.activity,
        { id: `act-${quote.id}-corr-${Date.now()}`, date: ATTACH_TS, actor: currentUser.fullName, action: 'Quotation corrected', detail: `Aligned to PO ${so.poNumber} · new value ${formatINR(value)}` },
      ],
    });
    return value;
  };

  const saveCorrection = () => {
    if (items.length === 0) return;
    persistCorrection();
    addToast({ type: 'success', title: 'Correction saved', message: `${quote?.number} updated. Totals recalculated to ${formatINR(correctedTotal)}.` });
  };

  const addCorrectedToEmail = () => {
    if (!quote || items.length === 0) return;
    const value = persistCorrection();
    const fileName = `${quote.number.replace(/\//g, '-')}-corrected.pdf`;
    updateEmail(email.id, {
      composeIntent: 'quote-correct',
      attachedQuote: {
        fileName,
        qtnNumber: quote.number,
        fileType: 'PDF',
        quoteValue: value,
        signature: quoteSignature({ value, items }),
        addedBy: 'system',
        addedAt: ATTACH_TS,
        version: 'Corrected',
        sizeLabel: `${118 + items.length * 9} KB`,
        kind: 'corrected',
      },
      draft: {
        from: email.recipient,
        to: email.senderEmail,
        cc: email.cc.join(', '),
        subject: `Corrected quotation ${quote.number} — ${so.customerName}`,
        body:
          `Dear ${contact},\n\nFollowing your Purchase Order ${so.poNumber}, please find attached our corrected quotation ${quote.number} reflecting the aligned terms:\n\n` +
          `${mismatchLines}\n\n` +
          `Corrected value: ${formatINR(value)}.\n\n` +
          `Kindly confirm so we may align the Purchase Order and proceed with the Sales Order.\n\n` +
          `Warm regards,\n${so.owner}\nNexus RFQ — ${officeName(so.officeId)}`,
        relatedDoc: quote.number,
        aiGenerated: true,
      },
    });
    addToast({ type: 'success', title: 'Added to email', message: 'Corrected quotation attached. Set the next review date and send from the centre panel.' });
    onPrepared?.();
  };

  // Record that an awaited correction was received & accepted (manual — never
  // triggered by sending or receiving an email).
  const acceptCorrection = (mode: 'po' | 'quote') => {
    const target = mode === 'po' ? 'awaiting_po' : 'awaiting_quote';
    const newFields: VerificationField[] = fields.map((f) =>
      fieldResolution(f) === target ? { ...f, resolution: 'resolved' } : f
    );
    const newStatus = deriveVerificationStatus(newFields);
    const nowVerified = newStatus === 'verified';
    const activity = [
      ...so.activity,
      {
        id: `act-${so.id}-accept-${Date.now()}`,
        date: `${TODAY_ISO}T12:30:00`,
        actor: currentUser.fullName,
        action: mode === 'po' ? 'Updated PO received & accepted' : 'Corrected quotation accepted',
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
      title: nowVerified ? 'Verification complete' : 'Correction accepted',
      message: nowVerified
        ? 'All fields resolved — Sales Order generation is now available.'
        : 'Field resolved. Remaining mismatches still need resolution.',
    });
  };

  const generateSO = () => {
    if (!resolvedAll) return;
    const verifiedBy = so.verifiedBy ?? currentUser.fullName;
    const verifiedAt = so.verifiedAt ?? `${TODAY_ISO}T12:30:00`;
    updateSalesOrder(so.id, {
      soGenerated: true,
      verifiedBy,
      verifiedAt,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-sogen-${Date.now()}`, date: `${TODAY_ISO}T12:30:00`, actor: currentUser.fullName, action: 'Sales Order generated', detail: `${so.number} generated from verified PO & quotation` },
      ],
    });
    addToast({ type: 'success', title: 'Sales Order generated', message: `${so.number} created from verified data. Sent to ERP Handoff (Pending).` });
    navigate('/sales-orders');
  };

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
        {tab === 'generate' ? (
          <GenerateTab so={so} canGenerate={canGenerate} onGenerate={generateSO} />
        ) : correcting ? (
          <CorrectQuoteEditor
            quote={quote}
            items={items}
            actionable={actionable}
            correctedTotal={correctedTotal}
            baselineTotal={quote?.value ?? 0}
            canEdit={canEditQuote}
            addId={addId}
            setAddId={setAddId}
            onSetLine={setLine}
            onRemoveLine={removeLine}
            onAddLine={addLine}
            onBack={() => setCorrecting(false)}
            onPreview={() => setShowPreview(true)}
            onSave={saveCorrection}
            onAddToEmail={addCorrectedToEmail}
            attached={attached}
          />
        ) : (
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
            canCorrect={canEditQuote && !!quote}
            hasQuoteIntent={email.composeIntent === 'quote-correct'}
            hasPoIntent={email.composeIntent === 'po-request'}
            onRequestPo={prepareRequestPo}
            onCorrectQuote={startCorrecting}
            onViewLatest={() => setShowLatest(true)}
            onAcceptPo={() => acceptCorrection('po')}
            onAcceptQuote={() => acceptCorrection('quote')}
          />
        )}
      </div>

      {/* Preview Corrected Quote */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="lg"
        title="Preview — Corrected Quotation"
        subtitle={`${quote?.number ?? ''} · ${so.customerName}`}
        footer={<Button variant="primary" onClick={() => setShowPreview(false)}>Close</Button>}
      >
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
              {items.map((it) => (
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
            <span className="text-[12px] font-medium text-surface-600">Corrected Grand Total</span>
            <span className="text-[14px] font-bold text-surface-900">{formatINR(correctedTotal)}</span>
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
  canCorrect,
  hasQuoteIntent,
  hasPoIntent,
  onRequestPo,
  onCorrectQuote,
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
  canCorrect: boolean;
  hasQuoteIntent: boolean;
  hasPoIntent: boolean;
  onRequestPo: () => void;
  onCorrectQuote: () => void;
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
                {actionableCount} field{actionableCount === 1 ? '' : 's'} still mismatched. Choose which side to correct:
              </p>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <Button variant="primary" size="sm" className="w-full justify-start" leftIcon={<Mail className="h-4 w-4" />} onClick={onRequestPo} disabled={!canSend}>
                    Request Updated PO
                  </Button>
                  <p className="mt-1 pl-1 text-[11px] text-surface-400">Customer PO is wrong — ask for a corrected PO. Prepares the email in the centre panel.</p>
                  {hasPoIntent && (
                    <p className="mt-1 flex items-center gap-1 pl-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Draft ready in the centre composer.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-none" leftIcon={<Eye className="h-4 w-4" />} onClick={onViewLatest}>
                    View Latest Quote
                  </Button>
                  <Button variant="secondary" size="sm" className="flex-1 justify-start" leftIcon={<Wand2 className="h-4 w-4" />} onClick={onCorrectQuote} disabled={!canCorrect}>
                    Correct Quote
                  </Button>
                </div>
                <p className="pl-1 text-[11px] text-surface-400">Our quotation is wrong — edit it here, then attach the corrected PDF to the email.</p>
                {hasQuoteIntent && (
                  <p className="flex items-center gap-1 pl-1 text-[11px] font-medium text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Corrected quote attached in the centre composer.</p>
                )}
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
                  Record corrected quote accepted ({awaitingQuoteCount})
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

// ---------------------------------------------------------------------------

function CorrectQuoteEditor({
  quote,
  items,
  actionable,
  correctedTotal,
  baselineTotal,
  canEdit,
  addId,
  setAddId,
  onSetLine,
  onRemoveLine,
  onAddLine,
  onBack,
  onPreview,
  onSave,
  onAddToEmail,
  attached,
}: {
  quote: Quotation | null;
  items: LineItem[];
  actionable: VerificationField[];
  correctedTotal: number;
  baselineTotal: number;
  canEdit: boolean;
  addId: string;
  setAddId: (v: string) => void;
  onSetLine: (id: string, patch: Partial<Pick<LineItem, 'quantity' | 'unitPrice'>>) => void;
  onRemoveLine: (id: string) => void;
  onAddLine: () => void;
  onBack: () => void;
  onPreview: () => void;
  onSave: () => void;
  onAddToEmail: () => void;
  attached: InboxEmail['attachedQuote'];
}) {
  if (!quote) {
    return <p className="text-[12px] text-surface-500">The linked quotation could not be found.</p>;
  }
  const delta = correctedTotal - baselineTotal;
  const attachIsCorrected = attached?.kind === 'corrected';

  return (
    <div>
      <button onClick={onBack} className="mb-2 flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to comparison
      </button>

      {/* Mismatch context above the editor */}
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" /> Correcting to match the PO
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] text-amber-800">
          {actionable.map((f) => (
            <li key={f.key}>• {f.label}: quote <span className="line-through">{f.quoteValue}</span> → PO <span className="font-semibold">{f.poValue}</span></li>
          ))}
          {actionable.length === 0 && <li>No field-level mismatches recorded.</li>}
        </ul>
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">Editable Quote Generator</h3>
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-200">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-surface-500">
              <th className="px-2.5 py-2 text-left">Item</th>
              <th className="px-1.5 py-2 text-right">Qty</th>
              <th className="px-1.5 py-2 text-right">Unit Price</th>
              <th className="px-2.5 py-2 text-right">Line Total</th>
              {canEdit && <th className="w-8 px-1 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {items.map((it) => (
              <tr key={it.id}>
                <td className="px-2.5 py-2 align-top">
                  <p className="font-medium text-surface-800">{it.description}</p>
                  <p className="text-[10.5px] text-surface-400">{it.itemCode} · HSN {it.hsnCode}</p>
                </td>
                <td className="px-1.5 py-2 text-right align-top">
                  {canEdit ? (
                    <input
                      type="number"
                      min={0}
                      value={it.quantity}
                      onChange={(e) => onSetLine(it.id, { quantity: Math.max(0, Number(e.target.value)) })}
                      className="input h-7 w-14 px-1.5 py-0 text-right text-[12px]"
                      aria-label={`Quantity for ${it.description}`}
                    />
                  ) : (
                    <span className="text-surface-700">{it.quantity} {it.unit}</span>
                  )}
                </td>
                <td className="px-1.5 py-2 text-right align-top">
                  {canEdit ? (
                    <input
                      type="number"
                      min={0}
                      value={it.unitPrice}
                      onChange={(e) => onSetLine(it.id, { unitPrice: Math.max(0, Number(e.target.value)) })}
                      className="input h-7 w-20 px-1.5 py-0 text-right text-[12px]"
                      aria-label={`Unit price for ${it.description}`}
                    />
                  ) : (
                    <span className="text-surface-700">{formatINR(it.unitPrice)}</span>
                  )}
                </td>
                <td className="px-2.5 py-2 text-right align-top font-medium text-surface-800">
                  {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                </td>
                {canEdit && (
                  <td className="px-1 py-2 text-center align-top">
                    <button onClick={() => onRemoveLine(it.id)} aria-label={`Remove ${it.description}`} className="rounded p-1 text-surface-300 hover:bg-rose-50 hover:text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2.5 py-4 text-center text-[12px] text-surface-400">All lines removed — add at least one item before saving.</td>
              </tr>
            )}
          </tbody>
        </table>

        {canEdit && (
          <div className="flex items-center gap-1.5 border-t border-surface-100 bg-surface-50/60 px-2.5 py-2">
            <select value={addId} onChange={(e) => setAddId(e.target.value)} className="input h-7 flex-1 px-2 py-0 text-[12px]" aria-label="Select catalogue item to add">
              <option value="">Add catalogue item…</option>
              {ITEMS.filter((it) => it.active).map((it) => (
                <option key={it.id} value={it.id}>{it.code} · {it.name}</option>
              ))}
            </select>
            <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={onAddLine} disabled={!addId}>Add</Button>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between rounded-lg bg-surface-50 px-3 py-2">
        <span className="text-[12px] font-medium text-surface-600">Corrected Grand Total</span>
        <div className="text-right">
          <span className="text-[15px] font-bold text-surface-900">{formatINR(correctedTotal)}</span>
          {delta !== 0 && (
            <span className={classNames('ml-2 text-[11px] font-medium', delta < 0 ? 'text-emerald-600' : 'text-rose-600')}>
              {delta < 0 ? '−' : '+'}{formatINR(Math.abs(delta))} vs latest
            </span>
          )}
        </div>
      </div>

      {attachIsCorrected && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          <Paperclip className="h-4 w-4 flex-none" /> Corrected quotation added to the email — set the review date and send from the centre panel.
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={onSave} disabled={!canEdit || items.length === 0}>Save Changes</Button>
          <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={onPreview} disabled={items.length === 0}>Preview</Button>
        </div>
        <Button
          variant="primary"
          size="sm"
          className="w-full"
          leftIcon={items.length > 0 ? <Paperclip className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          onClick={onAddToEmail}
          disabled={!canEdit || items.length === 0}
          title="Attach the corrected quotation to the email in the centre panel"
        >
          Add Corrected Quote to Email
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

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
