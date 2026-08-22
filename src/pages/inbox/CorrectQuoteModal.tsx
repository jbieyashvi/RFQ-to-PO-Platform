import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Eye, Paperclip, Plus, Save, Trash2, Wand2, X } from 'lucide-react';
import type { InboxEmail, LineItem, Quotation, SalesOrder } from '@/types';
import { Button, Modal } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ITEMS } from '@/data/masters';
import { officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { classNames, formatINR, lineTotal } from '@/lib/format';
import { buildVersions, grandTotalOf } from '@/lib/revisionQueue';
import { actionableFields, unresolvedFields } from '@/lib/verification';
import { quoteSignature } from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const TODAY_ISO = '2026-08-13';
const ATTACH_TS = '2026-08-13T12:40:00';

const clone = (it: LineItem): LineItem => ({ ...it });

/**
 * Correct Quote — our own quotation, re-priced to match the customer's PO.
 *
 * This used to be an inline view inside the 320px verification panel, which
 * meant re-pricing a whole quotation in a strip narrower than the comparison
 * that justified it: the mismatched fields scrolled away above the table you
 * were correcting them in, and there was no room for the running delta. It is
 * now a large sheet — the PO's disputed values pinned at the top, the full line
 * table underneath, and the corrected total against the accepted one.
 *
 * Nothing is sent from here. "Add Corrected Quote to Email" saves the
 * correction, attaches the PDF and hands over to the compose window, which is
 * the one surface that sends.
 */
export function CorrectQuoteModal({
  email,
  so,
  quote,
  onAddedToEmail,
  onClose,
}: {
  email: InboxEmail;
  so: SalesOrder;
  quote: Quotation;
  /** The corrected quote is on the email — hand over to the composer. */
  onAddedToEmail: () => void;
  onClose: () => void;
}) {
  const { updateQuotation, updateEmail, addToast, currentUser, can } = useApp();
  const canEdit = can('quotations', 'edit');

  const [items, setItems] = useState<LineItem[]>(() => quote.items.map(clone));
  const [addId, setAddId] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  // The page behind must not scroll while this holds the screen. Escape closes
  // it — unless the preview is up, which owns Escape for itself.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showPreview) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, showPreview]);

  const packing = quote.packingCharges ?? 0;
  const correctedTotal = useMemo(() => grandTotalOf(items, packing), [items, packing]);
  const delta = correctedTotal - quote.value;

  // The PO values this correction is being made to match. Once a correction is
  // already out with the customer nothing reads as "mismatch" any more, so fall
  // back to every field still unreconciled rather than showing an empty list.
  const actionable = useMemo(() => {
    const fields = so.verificationFields ?? [];
    const live = actionableFields(fields);
    return live.length > 0 ? live : unresolvedFields(fields);
  }, [so.verificationFields]);
  const mismatchLines = actionable
    .map((f) => `• ${f.label}: quotation shows "${f.quoteValue}", your PO shows "${f.poValue}"`)
    .join('\n');

  const attachIsCorrected = email.attachedQuote?.kind === 'corrected';
  const contact = (so.customerName.split(' ')[0] || 'Sir/Madam').trim();

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

  // Persist the corrected quote, seeding a baseline version before overwriting
  // so the quotation the customer already holds is preserved, not edited over.
  const persistCorrection = (): number => {
    const value = grandTotalOf(items, packing);
    const { existing } = buildVersions(quote, currentUser.fullName);
    updateQuotation(quote.id, {
      quoteVersions: existing,
      items: items.map(clone),
      value,
      lastUpdated: TODAY_ISO,
      revisions: [
        ...quote.revisions,
        {
          id: `rev-${quote.id}-corr-${quote.revisions.length + 1}`,
          version: existing.length + 1,
          date: TODAY_ISO,
          reason: `Corrected against PO ${so.poNumber}`,
          by: currentUser.fullName,
        },
      ],
      activity: [
        ...quote.activity,
        {
          id: `act-${quote.id}-corr-${Date.now()}`,
          date: ATTACH_TS,
          actor: currentUser.fullName,
          action: 'Quotation corrected',
          detail: `Aligned to PO ${so.poNumber} · new value ${formatINR(value)}`,
        },
      ],
    });
    return value;
  };

  const saveCorrection = () => {
    if (items.length === 0) return;
    const value = persistCorrection();
    addToast({
      type: 'success',
      title: 'Correction saved',
      message: `${quote.number} updated. Totals recalculated to ${formatINR(value)}.`,
    });
  };

  const addCorrectedToEmail = () => {
    if (items.length === 0) return;
    const value = persistCorrection();
    updateEmail(email.id, {
      composeIntent: 'quote-correct',
      attachedQuote: {
        fileName: `${quote.number.replace(/\//g, '-')}-corrected.pdf`,
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
    addToast({
      type: 'success',
      title: 'Added to email',
      message: 'Corrected quotation attached. Set the next review date and send.',
    });
    onAddedToEmail();
  };

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-stretch justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-surface-900/45 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Correct quotation against the customer PO"
        className="relative z-10 flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-surface-100 px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-surface-800">
              <Wand2 className="h-4 w-4 flex-none text-brand-600" />
              Correct Quote
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-surface-500">
              {quote.number} · {so.customerName} · aligning to PO {so.poNumber}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close quote correction"
            className="-mr-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* The disputed fields, pinned so they stay in view while the lines
              below them are re-priced to match. */}
          <section className="sticky -top-3 z-10 -mx-4 mb-3 border-b border-amber-100 bg-amber-50/95 px-4 py-2.5 backdrop-blur-sm">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> Correcting to match the PO
            </h3>
            {actionable.length === 0 ? (
              <p className="mt-1 text-[12px] text-amber-800">No field-level mismatches are recorded on this comparison.</p>
            ) : (
              <ul className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-[12px] text-amber-800 sm:grid-cols-2 lg:grid-cols-3">
                {actionable.map((f) => (
                  <li key={f.key}>
                    <span className="font-medium">{f.label}:</span> quote{' '}
                    <span className="line-through">{f.quoteValue}</span> → PO{' '}
                    <span className="font-semibold">{f.poValue}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <h3 className="mb-1.5 text-[14px] font-semibold text-surface-800">Corrected Quotation Items</h3>
          <div className="overflow-hidden rounded-xl border border-surface-200">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                    <th className="px-2.5 py-1.5 text-left">Item</th>
                    <th className="px-1.5 py-1.5 text-right">Qty</th>
                    <th className="px-1.5 py-1.5 text-right">Unit Price</th>
                    <th className="px-2.5 py-1.5 text-right">Line Total</th>
                    {canEdit && <th className="w-8 px-1 py-1.5" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-2.5 py-1.5 align-top">
                        <p className="font-medium text-surface-800">{it.description}</p>
                        <p className="text-[11px] text-surface-400">
                          {it.itemCode}
                          {it.hsnCode ? ` · HSN ${it.hsnCode}` : ''} · {it.unit}
                        </p>
                      </td>
                      <td className="px-1.5 py-1.5 text-right align-top">
                        {canEdit ? (
                          <input
                            type="number"
                            min={0}
                            value={it.quantity}
                            onChange={(e) => setLine(it.id, { quantity: Math.max(0, Number(e.target.value)) })}
                            className="input h-7 w-16 px-1.5 py-0 text-right text-[12px]"
                            aria-label={`Quantity for ${it.description}`}
                          />
                        ) : (
                          <span className="text-surface-700">
                            {it.quantity} {it.unit}
                          </span>
                        )}
                      </td>
                      <td className="px-1.5 py-1.5 text-right align-top">
                        {canEdit ? (
                          <input
                            type="number"
                            min={0}
                            value={it.unitPrice}
                            onChange={(e) => setLine(it.id, { unitPrice: Math.max(0, Number(e.target.value)) })}
                            className="input h-7 w-24 px-1.5 py-0 text-right text-[12px]"
                            aria-label={`Unit price for ${it.description}`}
                          />
                        ) : (
                          <span className="text-surface-700">{formatINR(it.unitPrice)}</span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5 text-right align-top font-medium text-surface-800">
                        {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                      </td>
                      {canEdit && (
                        <td className="px-1 py-1.5 text-center align-top">
                          <button
                            onClick={() => removeLine(it.id)}
                            aria-label={`Remove ${it.description}`}
                            className="rounded p-1 text-surface-300 hover:bg-rose-50 hover:text-rose-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2.5 py-4 text-center text-[12px] text-surface-400">
                        All lines removed — add at least one item before saving.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {canEdit && (
              <div className="flex items-center gap-1.5 border-t border-surface-100 bg-surface-50/60 px-2.5 py-2">
                <select
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                  className="input h-7 flex-1 px-2 py-0 text-[12px] sm:max-w-md"
                  aria-label="Select catalogue item to add"
                >
                  <option value="">Add catalogue item…</option>
                  {ITEMS.filter((it) => it.active).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.code} · {it.name}
                    </option>
                  ))}
                </select>
                <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addLine} disabled={!addId}>
                  Add
                </Button>
              </div>
            )}
          </div>

          {attachIsCorrected && (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
              <Paperclip className="h-4 w-4 flex-none" /> Corrected quotation added to the email — set the review date and send
              from the compose window.
            </div>
          )}
        </div>

        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-t border-surface-100 bg-surface-50/60 px-4 py-3">
          <div className="text-[12px] text-surface-500">
            Corrected Grand Total:{' '}
            <span className="text-[15px] font-bold text-surface-900">{formatINR(correctedTotal)}</span>
            {delta !== 0 && (
              <span className={classNames('ml-2 text-[11px] font-medium', delta < 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {delta < 0 ? '−' : '+'}
                {formatINR(Math.abs(delta))} vs accepted
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={saveCorrection} disabled={!canEdit || items.length === 0}>
              Save Changes
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setShowPreview(true)} disabled={items.length === 0}>
              Preview
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Paperclip className="h-4 w-4" />}
              onClick={addCorrectedToEmail}
              disabled={!canEdit || items.length === 0}
              title="Attach the corrected quotation to the email and open the compose window"
            >
              Add Corrected Quote to Email
            </Button>
          </div>
        </div>
        {!canEdit && (
          <p className="flex-none border-t border-surface-100 bg-surface-50/60 px-4 pb-2 text-center text-[11px] font-medium text-rose-600">
            Quotation edit permission required.
          </p>
        )}
      </div>

      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="lg"
        title="Preview — Corrected Quotation"
        subtitle={`${quote.number} · ${so.customerName}`}
        footer={
          <Button variant="primary" onClick={() => setShowPreview(false)}>
            Close
          </Button>
        }
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
                  <td className="px-3 py-2">
                    <p className="font-medium text-surface-800">{it.description}</p>
                    <p className="text-[11px] text-surface-400">{it.itemCode}</p>
                  </td>
                  <td className="px-2 py-2 text-right text-surface-700">
                    {it.quantity} {it.unit}
                  </td>
                  <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                  <td className="px-3 py-2 text-right font-medium text-surface-800">
                    {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                  </td>
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
    </div>,
    document.body
  );
}
