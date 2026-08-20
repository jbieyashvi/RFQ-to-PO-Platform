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
  User2,
  Boxes,
  Receipt,
  Calculator,
  Phone,
  MessageSquare,
  Pencil,
} from 'lucide-react';
import type {
  CommercialTerms,
  InboxEmail,
  LineItem,
  Party,
  PaymentTerms,
  PoProofType,
  Quotation,
  SalesOrder,
  SalesOrderAttachment,
  VerificationField,
} from '@/types';
import {
  Button,
  Modal,
  StatusBadge,
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  ItemLineEditor,
  InfoRow,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { OWNERS, USERS } from '@/data/users';
import { ITEMS } from '@/data/masters';
import { classNames, computeTotals, formatDate, formatINR, lineTotal } from '@/lib/format';
import {
  activeDeliveryOptions,
  defaultDeliveryOption,
  formatPaymentTerms,
  formatWarranty,
  paymentTotal,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';
import { VERIFICATION_STATUS } from '@/lib/labels';
import { resolveSalesOrder, type ResolvedSalesOrder } from '@/lib/salesOrder';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
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

  const so = salesOrders.find((s) => s.id === email.poVerifyId) ?? null;
  const quote = so ? quotations.find((q) => q.id === so.quotationId) ?? null : null;

  const canVerify = can('sales_orders', 'edit');
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
          emailSignature(so.owner, officeName(so.officeId)),
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
          emailSignature(so.owner, officeName(so.officeId)),
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
          <GenerateTab email={email} so={so} quote={quote} onPrepared={onPrepared} />
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
              <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Unit Price</th>
                <th className="px-3 py-2 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {items.map((it) => (
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
                <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit Price</th>
                  <th className="px-3 py-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {quote.items.map((it) => (
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
            <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
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
                  <p className="text-[11px] text-surface-400">{it.itemCode} · HSN {it.hsnCode}</p>
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

// Clearer, spec-aligned labels for the four payment buckets (shared
// PAYMENT_FIELDS keys/order are reused; only display labels differ).
const SO_PAYMENT_LABEL: Record<keyof PaymentTerms, string> = {
  advance: 'Advance %',
  beforeDispatch: 'Before Dispatch %',
  creditDays: 'Credit %',
  afterInstall: 'After Installation %',
};

const SO_PO_PROOF_OPTIONS: { value: PoProofType; label: string; icon: typeof Phone }[] = [
  { value: 'uploaded', label: 'PO Document', icon: FileText },
  { value: 'phone_call', label: 'Phone Call', icon: Phone },
  { value: 'message', label: 'Message / WhatsApp', icon: MessageSquare },
];

// The SO Generation form mirrors "Create Sales Order Manually" but is scoped to
// the already-verified PO record: the customer is fixed (it came from the
// verified PO/quotation), so there is no new-customer toggle here.
interface SoForm {
  billingAddress: string;
  shippingAddress: string;
  sameAsBilling: boolean;
  phone: string;
  email: string;
  pincode: string;
  gstin: string;
  kindAttentionName: string;
  kindAttentionEmail: string;
  poNumber: string;
  poDate: string;
  officeId: string;
  owner: string;
  officeAdmin: string;
  poProofType: PoProofType;
  poProofNotes: string;
  packingPct: number;
  deliveryTerms: string;
  deliveryTimeline: string;
  warrantyYears: number;
  creditDays: number;
  payment: PaymentTerms;
  expectedDelivery: string;
  freight: string;
  inspection: string;
  additionalTerms: string;
}

// Prefill from the verified Sales Order, its accepted quotation and the Party
// Master. Commercial terms use the SO's structured snapshot when present and
// fall back to the T&C Master defaults for older seed records.
function initSoForm(so: SalesOrder, party: Party | undefined, ct: CommercialTerms): SoForm {
  const taxable = computeTotals(so.items, 0).taxable;
  const derivedPacking = taxable > 0 ? Math.round((so.packingCharges / taxable) * 100) : ct.packingPct;
  return {
    billingAddress: so.billingAddress ?? party?.billingAddress ?? '',
    shippingAddress: so.shippingAddress ?? party?.shippingAddress ?? '',
    sameAsBilling: false,
    phone: so.customerPhone ?? party?.phone ?? '',
    email: so.customerEmail ?? party?.email ?? '',
    pincode: so.pincode ?? '',
    gstin: party?.gstin ?? '',
    kindAttentionName: so.kindAttentionName ?? party?.contactPerson ?? '',
    kindAttentionEmail: so.kindAttentionEmail ?? party?.email ?? '',
    poNumber: so.poNumber,
    poDate: so.poDate,
    officeId: so.officeId,
    owner: so.owner,
    officeAdmin: so.officeAdmin ?? '',
    poProofType: so.poProofType ?? 'uploaded',
    poProofNotes:
      so.poProofNotes ??
      `PO ${so.poNumber} verified against accepted quotation ${so.quotationNumber ?? ''}.`.trim(),
    packingPct: so.commercials?.packingPct ?? derivedPacking,
    deliveryTerms: so.deliveryTerms || defaultDeliveryOption(ct)?.name || '',
    deliveryTimeline: so.deliveryTimeline ?? '',
    warrantyYears: parseInt(so.warranty, 10) || ct.warrantyYears,
    creditDays: so.commercials?.creditDays ?? 0,
    payment: so.commercials?.payment ? { ...so.commercials.payment } : { ...ct.payment },
    expectedDelivery: so.deliveryDate ?? '',
    freight: so.freight ?? '',
    inspection: so.inspection ?? '',
    additionalTerms: so.additionalTerms ?? '',
  };
}

/**
 * SO Generation tab — the full editable Sales Order form (the same five
 * sections as "Create Sales Order Manually"), prefilled from the verified PO,
 * accepted quotation and customer masters. Everything happens INSIDE the Global
 * Inbox: generating the SO flips it live + links a Pending ERP Handoff record,
 * then the panel switches to a read-only generated-document view whose only send
 * path is the middle composer ("Add Sales Order to Email").
 */
function GenerateTab({
  email,
  so,
  quote,
  onPrepared,
}: {
  email: InboxEmail;
  so: SalesOrder;
  quote: Quotation | null;
  onPrepared?: () => void;
}) {
  const {
    parties,
    items: catalog,
    commercialTerms,
    role,
    updateSalesOrder,
    updateEmail,
    addToast,
    currentUser,
    can,
  } = useApp();
  const navigate = useNavigate();
  const canGenerate = can('sales_orders', 'create');

  const party = parties.find((p) => p.id === so.partyId);
  const generated = so.soGenerated || !!so.erpHandoff;
  const soEmailed = !!so.sentAt; // SO Sent Date populated → the SO email has gone out
  const handoffMissing = generated && !so.erpHandoff;

  // Start in the generated-document view once the SO exists; otherwise open the
  // editable form.
  const [editing, setEditing] = useState(!generated);
  const [form, setForm] = useState<SoForm>(() => initSoForm(so, party, commercialTerms));
  const [lines, setLines] = useState<LineItem[]>(() => so.items.map(clone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);

  const set = <K extends keyof SoForm>(k: K, v: SoForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const deliveryChoices = useMemo(() => activeDeliveryOptions(commercialTerms), [commercialTerms]);
  const officeAdmins = useMemo(() => {
    const inOffice = USERS.filter((u) => u.role === 'office_admin' && u.officeId === form.officeId && u.active);
    const list = inOffice.length ? inOffice : USERS.filter((u) => u.role === 'office_admin' && u.active);
    return list.map((u) => u.fullName);
  }, [form.officeId]);

  const effectiveShipping = form.sameAsBilling ? form.billingAddress : form.shippingAddress;
  const packingAmount = Math.round((computeTotals(lines, 0).taxable * form.packingPct) / 100);
  const totals = computeTotals(lines, packingAmount);
  const paymentSum = paymentTotal(form.payment);
  const contact = (so.customerName.split(' ')[0] || 'Sir/Madam').trim();

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.billingAddress.trim()) e.billingAddress = 'Billing address is required';
    if (!form.phone.trim() && !form.email.trim()) e.phone = 'Provide a phone number or email';
    if (!form.gstin.trim()) e.gstin = 'GSTIN is required';
    if (!form.kindAttentionName.trim()) e.kindAttentionName = 'Kind attention name is required';
    if (!form.poNumber.trim()) e.poNumber = 'PO number is required';
    if (!form.poDate) e.poDate = 'PO date is required';
    if (!form.officeId) e.officeId = 'Sales office is required';
    if (!form.owner) e.owner = 'Owner is required';
    if (!form.poProofNotes.trim()) e.poProof = 'Add the PO document reference and details';
    if (!form.expectedDelivery) e.expectedDelivery = 'Expected delivery date is required';
    if (paymentSum !== 100) e.payment = 'Payment terms must total 100%.';
    if (lines.length === 0) e.lines = 'Add at least one line item';
    else if (lines.some((l) => !l.itemId)) e.lines = 'Every line must have an item selected';
    else if (lines.some((l) => l.quantity <= 0)) e.lines = 'Quantities must be greater than 0';
    else if (lines.some((l) => l.unitPrice <= 0)) e.lines = 'Unit price must be greater than 0';
    setErrors(e);
    if (Object.keys(e).length) {
      addToast({ type: 'error', title: 'Please fix the highlighted fields', message: `${Object.keys(e).length} field(s) need attention.` });
    }
    return Object.keys(e).length === 0;
  };

  // The edited SO fields, ready to merge onto the existing record. Never mints a
  // new SO number — the verified record already owns one.
  const buildPatch = (): Partial<SalesOrder> => {
    const paymentTermsText =
      formatPaymentTerms(form.payment) + (form.creditDays > 0 ? `, ${form.creditDays} Credit Days` : '');
    return {
      poNumber: form.poNumber,
      poDate: form.poDate,
      officeId: form.officeId,
      owner: form.owner,
      officeAdmin: form.officeAdmin || undefined,
      billingAddress: form.billingAddress,
      shippingAddress: effectiveShipping,
      customerPhone: form.phone || undefined,
      customerEmail: form.email || undefined,
      pincode: form.pincode || undefined,
      kindAttentionName: form.kindAttentionName || undefined,
      kindAttentionEmail: form.kindAttentionEmail || undefined,
      poProofType: form.poProofType,
      poProofNotes: form.poProofNotes || undefined,
      deliveryDate: form.expectedDelivery,
      items: lines.map(clone),
      paymentTerms: paymentTermsText,
      deliveryTerms: form.deliveryTerms,
      warranty: formatWarranty(form.warrantyYears),
      packingCharges: packingAmount,
      value: totals.grandTotal,
      poValue: totals.grandTotal,
      commercials: { packingPct: form.packingPct, payment: { ...form.payment }, creditDays: form.creditDays },
      // Structured shared-model sections (prefilled from the verified PO / party).
      buyer: {
        name: so.customerName,
        code: so.customerCode,
        address: form.billingAddress,
        pincode: form.pincode || undefined,
        country: 'India',
        phone: form.phone || undefined,
        email: form.email || undefined,
        gstin: form.gstin || undefined,
      },
      consignee: {
        name: so.customerName,
        address: effectiveShipping,
        country: 'India',
        gstin: form.gstin || undefined,
      },
      consigneeSameAsBuyer: form.sameAsBilling || effectiveShipping.trim() === form.billingAddress.trim(),
      kindAttention:
        form.kindAttentionName || form.kindAttentionEmail
          ? { name: form.kindAttentionName || undefined, email: form.kindAttentionEmail || undefined }
          : undefined,
      salesperson: { name: form.owner, officeId: form.officeId, owner: form.owner },
      deliveryTimeline: form.deliveryTimeline || undefined,
      expectedDeliveryDate: form.expectedDelivery || undefined,
      freight: form.freight || undefined,
      inspection: form.inspection || undefined,
      additionalTerms: form.additionalTerms || undefined,
    };
  };

  // Live document preview — resolved from the current (possibly edited) form
  // merged onto the SO record, so the preview matches exactly what Save writes.
  const previewResolved = useMemo(
    () => resolveSalesOrder({ ...so, ...buildPatch() }, { parties, catalog }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [so, form, lines]
  );

  // Generate the Sales Order: persist the (possibly edited) fields, flip it live
  // and, in the SAME update, link a Pending ERP Handoff record. Guarded so a
  // second click never mints another SO or a duplicate handoff. Stays in inbox.
  const doGenerate = () => {
    if (!validate()) return;
    if (so.erpHandoff) return; // already generated — Save is used instead
    const now = `${TODAY_ISO}T12:30:00`;
    updateSalesOrder(so.id, {
      ...buildPatch(),
      soGenerated: true,
      status: 'so_sent',
      verifiedBy: so.verifiedBy ?? currentUser.fullName,
      verifiedAt: so.verifiedAt ?? now,
      erpHandoff: { state: 'pending', source: 'po_verification', submittedAt: now, submittedBy: currentUser.fullName },
      activity: [
        ...so.activity,
        { id: `act-${so.id}-sogen-${Date.now()}`, date: now, actor: currentUser.fullName, action: 'Sales Order generated', detail: `${so.number} generated from verified PO & quotation — added to ERP Handoff (Pending)` },
      ],
    });
    addToast({ type: 'success', title: 'Sales Order generated', message: 'Sales Order generated successfully. Preview it and add it to the email before sending.' });
    setEditing(false);
  };

  // Edit an already-generated SO: save changes to the SAME record — no new SO
  // number and no additional ERP Handoff record.
  const doSave = () => {
    if (!validate()) return;
    const now = `${TODAY_ISO}T12:35:00`;
    updateSalesOrder(so.id, {
      ...buildPatch(),
      activity: [
        ...so.activity,
        { id: `act-${so.id}-soedit-${Date.now()}`, date: now, actor: currentUser.fullName, action: 'Sales Order updated', detail: `${so.number} edited before sending` },
      ],
    });
    addToast({ type: 'success', title: 'Sales Order updated', message: `${so.number} saved. Preview it and add it to the email before sending.` });
    setEditing(false);
  };

  // Repair a broken link: a Sales Order marked generated (seed/legacy) but with
  // no ERP Handoff record. Creates the missing Pending handoff.
  const repairHandoff = () => {
    if (so.erpHandoff) return;
    const now = `${TODAY_ISO}T12:30:00`;
    updateSalesOrder(so.id, {
      erpHandoff: { state: 'pending', source: 'po_verification', submittedAt: now, submittedBy: currentUser.fullName },
      activity: [
        ...so.activity,
        { id: `act-${so.id}-handoffrepair-${Date.now()}`, date: now, actor: currentUser.fullName, action: 'ERP Handoff record created', detail: `Linked ERP Handoff (Pending) created for ${so.number}` },
      ],
    });
    addToast({ type: 'success', title: 'ERP Handoff linked', message: `${so.number} added to ERP Handoff (Pending).` });
  };

  // Attach the generated SO PDF to the middle composer and prefill the customer
  // email. Only the system-generated SO document can be attached — there is no
  // generic file upload. The final send happens from the centre panel.
  const addSoToEmail = () => {
    const attach: SalesOrderAttachment = {
      fileName: `${so.number.replace(/\//g, '-')}.pdf`,
      soNumber: so.number,
      fileType: 'PDF',
      value: so.value,
      addedBy: 'system',
      addedAt: ATTACH_TS,
      sizeLabel: `${140 + so.items.length * 8} KB`,
    };
    updateEmail(email.id, {
      composeIntent: 'so-send',
      attachedQuote: undefined,
      attachedSalesOrder: attach,
      draft: {
        from: email.recipient,
        to: email.senderEmail,
        cc: email.cc.join(', '),
        subject: `Sales Order ${so.number} against PO ${so.poNumber}`,
        body:
          `Dear ${contact},\n\nThank you for Purchase Order ${so.poNumber}.\n\n` +
          `Please find attached our Sales Order ${so.number} raised against your PO, for a total value of ${formatINR(so.value)}. ` +
          `Kindly review and confirm so we may proceed with processing.\n\n` +
          emailSignature(so.owner, officeName(so.officeId)),
        relatedDoc: so.number,
        aiGenerated: true,
      },
    });
    addToast({ type: 'success', title: 'Added to email', message: 'Sales Order attached. Review the email in the centre panel and send it.' });
    onPrepared?.();
  };

  const soAttached = email.attachedSalesOrder?.soNumber === so.number && email.composeIntent === 'so-send';

  // ---- Editable form -------------------------------------------------------
  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
          <ShieldCheck className="h-4 w-4 flex-none" />
          <span>
            PO verified against the accepted quotation
            {so.verifiedBy ? ` by ${so.verifiedBy}` : ''}
            {so.verifiedAt ? ` on ${formatDate(so.verifiedAt.slice(0, 10), { short: true })}` : ''}. Review the prefilled Sales Order and generate it.
          </span>
        </div>

        {/* 1. Client Details */}
        <FormSection icon={<User2 className="h-3.5 w-3.5" />} n={1} label="Client Details">
          <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
            <span className="text-surface-400">Customer / Party:</span>{' '}
            <span className="font-semibold text-surface-800">{so.customerName}</span>
            <span className="text-surface-400"> · {so.customerCode}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Phone" value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} className="py-1.5 text-[13px]" placeholder="+91 …" />
            <TextField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="py-1.5 text-[13px]" placeholder="orders@customer.com" />
            <TextField label="GSTIN" required value={form.gstin} error={errors.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} className="py-1.5 text-[13px]" placeholder="27AAACR…" />
            <TextField label="Pincode" value={form.pincode} onChange={(e) => set('pincode', e.target.value)} className="py-1.5 text-[13px]" placeholder="400001" />
          </div>
          <TextAreaField label="Billing Address" required rows={2} value={form.billingAddress} error={errors.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} className="text-[13px]" />
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="label mb-0">Shipping Address</label>
              <label className="flex items-center gap-1.5 text-[11px] text-surface-500">
                <Toggle checked={form.sameAsBilling} onChange={(v) => set('sameAsBilling', v)} />
                Same as billing
              </label>
            </div>
            <TextAreaField label="" rows={2} value={effectiveShipping} disabled={form.sameAsBilling} onChange={(e) => set('shippingAddress', e.target.value)} className="text-[13px]" placeholder={form.sameAsBilling ? 'Same as billing address' : 'Shipping address'} />
          </div>
          <div className="grid grid-cols-1 gap-2">
            <TextField label="Kind Attention — Name" required value={form.kindAttentionName} error={errors.kindAttentionName} onChange={(e) => set('kindAttentionName', e.target.value)} className="py-1.5 text-[13px]" placeholder="Contact person" />
            <TextField label="Kind Attention — Email" type="email" value={form.kindAttentionEmail} onChange={(e) => set('kindAttentionEmail', e.target.value)} className="py-1.5 text-[13px]" placeholder="contact@customer.com" />
          </div>
        </FormSection>

        {/* 2. Order Details */}
        <FormSection icon={<FileText className="h-3.5 w-3.5" />} n={2} label="Order Details">
          <div className="grid grid-cols-2 gap-2">
            <TextField label="PO Number" required value={form.poNumber} error={errors.poNumber} onChange={(e) => set('poNumber', e.target.value)} className="py-1.5 text-[13px]" />
            <TextField label="PO Date" required type="date" value={form.poDate} error={errors.poDate} onChange={(e) => set('poDate', e.target.value)} className="py-1.5 text-[13px]" />
          </div>
          <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
            <span className="text-surface-400">Linked Quotation:</span>{' '}
            <span className="font-semibold text-surface-800">{so.quotationNumber ?? quote?.number ?? '—'}</span>
          </div>
          <SelectField label="Sales Office" required value={form.officeId} error={errors.officeId} onChange={(e) => set('officeId', e.target.value)} options={(role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === so.officeId)).map((o) => ({ value: o.id, label: o.name }))} className="py-1.5 text-[13px]" />
          <div className="grid grid-cols-1 gap-2">
            <SelectField label="Owner / Sales Person" required value={form.owner} error={errors.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} className="py-1.5 text-[13px]" />
            <SelectField label="Office Admin" value={form.officeAdmin} onChange={(e) => set('officeAdmin', e.target.value)} options={officeAdmins.map((o) => ({ value: o, label: o }))} placeholder="Select office admin" className="py-1.5 text-[13px]" />
          </div>
          <div>
            <label className="label">PO Proof Type</label>
            <div className="grid grid-cols-1 gap-1.5">
              {SO_PO_PROOF_OPTIONS.map((opt) => {
                const OptIcon = opt.icon;
                const active = form.poProofType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('poProofType', opt.value)}
                    className={classNames(
                      'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition',
                      active ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500/30' : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
                    )}
                  >
                    <OptIcon className="h-3.5 w-3.5 flex-none" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <TextAreaField
            label={form.poProofType === 'uploaded' ? 'PO Document Reference & Notes' : 'Proof Notes'}
            required
            rows={2}
            value={form.poProofNotes}
            error={errors.poProof}
            onChange={(e) => set('poProofNotes', e.target.value)}
            className="text-[13px]"
            placeholder="PO document number, reference and key details…"
          />
        </FormSection>

        {/* 3. Catalogue Items */}
        <FormSection
          icon={<Boxes className="h-3.5 w-3.5" />}
          n={3}
          label="Catalogue Items"
          action={<span className="text-[11px] text-surface-400">{lines.length} line(s)</span>}
        >
          <ItemLineEditor items={lines} catalog={catalog} onChange={setLines} />
          {errors.lines && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{errors.lines}</p>}
        </FormSection>

        {/* 4. Commercial Terms */}
        <FormSection icon={<Receipt className="h-3.5 w-3.5" />} n={4} label="Commercial Terms">
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Packing (%)" type="number" min={0} max={100} value={form.packingPct} onChange={(e) => set('packingPct', Math.max(0, Math.min(100, Number(e.target.value))))} className="py-1.5 text-[13px]" hint={`≈ ${formatINR(packingAmount)}`} />
            <TextField label="Warranty (Years)" type="number" min={1} value={form.warrantyYears} onChange={(e) => set('warrantyYears', Math.max(1, Number(e.target.value)))} className="py-1.5 text-[13px]" />
            <SelectField label="Delivery Terms" value={form.deliveryTerms} onChange={(e) => set('deliveryTerms', e.target.value)} options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))} placeholder="Select delivery option" className="py-1.5 text-[13px]" wrapClassName="col-span-2" />
            <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} error={errors.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} className="py-1.5 text-[13px]" wrapClassName="col-span-2" />
          </div>
          <div>
            <label className="label">Payment Terms</label>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_FIELDS.map((f) => (
                <div key={f.key}>
                  <div className="relative">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="input py-1.5 pr-7 text-[13px]"
                      value={form.payment[f.key]}
                      onChange={(e) => set('payment', { ...form.payment, [f.key]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-surface-400">%</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-surface-500">{SO_PAYMENT_LABEL[f.key]}</p>
                </div>
              ))}
            </div>
            <div className={classNames('mt-1.5 text-[11px] font-medium', paymentSum === 100 ? 'text-emerald-600' : 'text-rose-600')}>
              Total: {paymentSum}%{paymentSum !== 100 && ' — must total 100%.'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Credit Days" type="number" min={0} value={form.creditDays} onChange={(e) => set('creditDays', Math.max(0, Number(e.target.value)))} className="py-1.5 text-[13px]" />
            <TextField label="Delivery Timeline" value={form.deliveryTimeline} onChange={(e) => set('deliveryTimeline', e.target.value)} className="py-1.5 text-[13px]" placeholder="e.g. 4–6 weeks" />
            <TextField label="Freight / Transportation" value={form.freight} onChange={(e) => set('freight', e.target.value)} className="py-1.5 text-[13px]" placeholder="e.g. Extra at actuals" />
            <TextField label="Inspection" value={form.inspection} onChange={(e) => set('inspection', e.target.value)} className="py-1.5 text-[13px]" placeholder="e.g. At works" />
          </div>
          <TextAreaField label="Additional Commercial Terms" rows={2} value={form.additionalTerms} onChange={(e) => set('additionalTerms', e.target.value)} className="text-[13px]" placeholder="Any additional terms…" />
        </FormSection>

        {/* 5. Amount Summary */}
        <FormSection icon={<Calculator className="h-3.5 w-3.5" />} n={5} label="Amount Summary">
          <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
          <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
          <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
          <InfoRow label="GST" value={formatINR(totals.tax)} />
          <InfoRow label={`Packing & Forwarding (${form.packingPct}%)`} value={formatINR(packingAmount)} />
          <div className="mt-1.5 flex items-center justify-between border-t border-surface-200 pt-2">
            <span className="text-[13px] font-semibold text-surface-800">Grand Total</span>
            <span className="text-[15px] font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
          </div>
        </FormSection>

        {/* Actions */}
        <div className="space-y-2 pt-1">
          <Button variant="secondary" size="sm" className="w-full" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>
            Preview Sales Order
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            leftIcon={<FileSpreadsheet className="h-4 w-4" />}
            onClick={generated ? doSave : doGenerate}
            disabled={!canGenerate}
            title={!canGenerate ? 'You do not have permission to generate Sales Orders' : undefined}
          >
            {generated ? 'Save Sales Order' : 'Generate Sales Order'}
          </Button>
          {generated && (
            <Button variant="ghost" size="sm" className="w-full" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => setEditing(false)}>
              Cancel — back to generated SO
            </Button>
          )}
          {!canGenerate && <p className="text-center text-[11px] font-medium text-rose-600">Create permission required.</p>}
        </div>

        <SoPreviewModal open={preview} onClose={() => setPreview(false)} resolved={previewResolved} />
      </div>
    );
  }

  // ---- Generated document view (read-only) ---------------------------------
  const paymentTermsText =
    formatPaymentTerms(form.payment) + (form.creditDays > 0 ? `, ${form.creditDays} Credit Days` : '');
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
        <CheckCircle2 className="h-4 w-4 flex-none" />
        <span>
          <span className="font-semibold">{so.number}</span> generated from the verified PO &amp; quotation
          {so.erpHandoff ? ' and added to ERP Handoff (Pending).' : '.'}
          {!soEmailed && ' Preview it and add it to the email before sending.'}
        </span>
      </div>

      {/* Generated SO document summary */}
      <div className="overflow-hidden rounded-xl border border-surface-200">
        <div className="flex items-center justify-between border-b border-surface-100 bg-surface-50/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
            <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> {so.number}
          </span>
          <StatusBadge tone={soEmailed ? 'green' : 'blue'} label={soEmailed ? 'Sent' : 'Generated'} dot />
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
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)} disabled={!canGenerate}>Edit Sales Order</Button>
              <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>Preview</Button>
            </div>
            <Button variant="primary" size="sm" className="w-full" leftIcon={<Mail className="h-4 w-4" />} onClick={addSoToEmail}>
              {soAttached ? 'Update Sales Order in Email' : 'Add Sales Order to Email'}
            </Button>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" leftIcon={<FileSpreadsheet className="h-3.5 w-3.5" />} onClick={() => navigate('/sales-orders')}>View Sales Order</Button>
          {so.erpHandoff && (
            <Button variant="secondary" size="sm" leftIcon={<ArrowLeft className="h-3.5 w-3.5 rotate-180" />} onClick={() => navigate('/erp-handoff', { state: { highlightId: so.id } })}>View in ERP Handoff</Button>
          )}
        </div>
      </div>

      <SoPreviewModal open={preview} onClose={() => setPreview(false)} resolved={previewResolved} />
    </div>
  );
}

// Compact section wrapper for the SO Generation form (narrower than the page's
// full SectionCard, tuned for the inbox right panel).
function FormSection({
  icon,
  n,
  label,
  action,
  children,
}: {
  icon: React.ReactNode;
  n: number;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-surface-200">
      <div className="flex items-center justify-between gap-2 border-b border-surface-100 px-3 py-2">
        <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-50 text-brand-600">{icon}</span>
          <span className="text-surface-400">{n}.</span> {label}
        </h4>
        {action}
      </div>
      <div className="space-y-2.5 p-3">{children}</div>
    </section>
  );
}

// Professional Sales Order document preview — the shared SO Acknowledgement
// renderer, resolved from the current form so it always matches what is saved.
function SoPreviewModal({
  open,
  onClose,
  resolved,
}: {
  open: boolean;
  onClose: () => void;
  resolved: ResolvedSalesOrder;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Sales Order Preview"
      subtitle={`${resolved.soNumber} · ${resolved.buyer.name ?? ''}`}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      <SalesOrderDocument resolved={resolved} showLetterhead />
    </Modal>
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
