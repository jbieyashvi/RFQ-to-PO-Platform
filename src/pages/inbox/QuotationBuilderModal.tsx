import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, FileText, Paperclip, Plus, Save, Trash2, X } from 'lucide-react';
import type { InboxEmail, LineItem, OutgoingDraft, Quotation } from '@/types';
import type { RequirementExtraction } from '@/lib/requirementExtraction';
import { Button, Modal, SelectField, TextField } from '@/components/ui';
import { DocumentLetterhead } from '@/components/DocumentLetterhead';
import { useApp } from '@/context/AppContext';
import { ITEMS } from '@/data/masters';
import { officeName } from '@/data/offices';
import { APP_NAME, emailSignature } from '@/lib/brand';
import { classNames, computeTotals, formatINR, lineTotal } from '@/lib/format';
import { quoteSignature } from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const BUILD_TS = '2026-08-13T12:40:00';
const TODAY = '2026-08-13';

const GST_RATES = [0, 5, 12, 18, 28];

const clone = (it: LineItem): LineItem => ({ ...it });

/**
 * Generate Quote — the editable quotation the sales engineer builds straight
 * out of a confirmed enquiry, without ever leaving the conversation.
 *
 * "Prepare Quotation" used to throw the user at the Quotes Pending list, which
 * loses the thread, the company mail and the extraction they had just
 * confirmed. This modal is opened OVER the inbox instead: the workspace behind
 * it keeps the selected email, the company list and the inquiry context intact,
 * so closing the modal returns to exactly the screen it was opened from.
 *
 * The lines are seeded from the CONFIRMED requirement extraction — one row per
 * distinct item with the tag quantities summed — and priced from the item
 * master, falling back to whatever the quotation already carries. Once the
 * quotation has been built here at least once (its lines carry `ln-req-` ids)
 * the saved quotation becomes the source of truth, so a manual price or
 * quantity is never silently re-seeded away.
 *
 * Nothing is sent from here. "Add Quote to Email" persists the quotation,
 * attaches the generated PDF to the email and hands over to the compose popup,
 * which is the one surface that actually sends.
 */
export function QuotationBuilderModal({
  email,
  quotation,
  extraction,
  onAddedToEmail,
  onClose,
}: {
  email: InboxEmail;
  quotation: Quotation;
  /** The line-level reading of the enquiry — the lines this quote starts from. */
  extraction: RequirementExtraction | null;
  onAddedToEmail: () => void;
  onClose: () => void;
}) {
  const { updateQuotation, updateEmail, addToast, can, currentUser } = useApp();

  const canEdit = can('quotations', 'edit');

  // Seeded ONCE per mount: re-deriving on every render would fight the edits
  // being made in the table above it.
  const [items, setItems] = useState<LineItem[]>(() => seedLines(quotation, extraction));
  const [seededFromExtraction] = useState(() => usesExtraction(quotation, extraction));
  const [addId, setAddId] = useState('');
  const [taxPct, setTaxPct] = useState<number>(() => items[0]?.taxPct ?? 18);
  const [packing, setPacking] = useState<number>(quotation.packingCharges);
  const [payment, setPayment] = useState(quotation.paymentTerms);
  const [delivery, setDelivery] = useState(quotation.deliveryTerms);
  const [warranty, setWarranty] = useState(quotation.warranty);
  const [showPreview, setShowPreview] = useState(false);

  // Every line is quoted at the same GST rate — the rate is a commercial
  // decision for the quotation, not a per-row one.
  const taxed = useMemo(() => items.map((it) => ({ ...it, taxPct })), [items, taxPct]);
  const totals = useMemo(() => computeTotals(taxed, packing), [taxed, packing]);

  const setLine = (id: string, patch: Partial<Pick<LineItem, 'quantity' | 'unitPrice' | 'discountPct'>>) =>
    setItems((rows) => rows.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const removeLine = (id: string) => setItems((rows) => rows.filter((it) => it.id !== id));

  const addLine = () => {
    const src = ITEMS.find((it) => it.id === addId);
    if (!src) return;
    setItems((rows) => [
      ...rows,
      {
        id: `ln-req-add-${src.id}-${rows.length}`,
        itemId: src.id,
        itemCode: src.code,
        description: src.name,
        hsnCode: src.hsnCode,
        quantity: 1,
        unit: src.unit,
        unitPrice: src.unitPrice,
        discountPct: 0,
        taxPct,
      },
    ]);
    setAddId('');
  };

  // The ONE write of this modal: the quotation record. The preview, the
  // attachment and the email body are all rendered from what this saves.
  const persist = (note: string): number => {
    const value = totals.grandTotal;
    updateQuotation(quotation.id, {
      items: taxed.map(clone),
      value,
      packingCharges: packing,
      paymentTerms: payment,
      deliveryTerms: delivery,
      warranty,
      lastUpdated: TODAY,
      activity: [
        ...quotation.activity,
        {
          id: `act-${quotation.id}-build-${Date.now()}`,
          date: BUILD_TS,
          actor: currentUser.fullName,
          action: note,
          detail: `${quotation.number} · ${taxed.length} ${taxed.length === 1 ? 'line' : 'lines'} · ${formatINR(value)}`,
        },
      ],
    });
    return value;
  };

  const saveDraft = () => {
    if (items.length === 0) return;
    const value = persist('Quotation drafted from enquiry');
    addToast({
      type: 'success',
      title: 'Draft saved',
      message: `${quotation.number} saved. Grand total ${formatINR(value)}.`,
    });
  };

  const fileName = `${quotation.number.replace(/\//g, '-')}.pdf`;

  const composedDraft = (value: number): OutgoingDraft => {
    const contact = (email.senderName.split(' ')[0] || 'Sir/Madam').trim();
    return {
      from: email.recipient,
      to: email.senderEmail,
      cc: email.cc.join(', '),
      subject: `Quotation ${quotation.number} from ${APP_NAME}`,
      body:
        `Dear ${contact},\n\nThank you for your enquiry. Please find attached our quotation ${quotation.number} for your kind review.\n\n` +
        `Grand total: ${formatINR(value)} (inclusive of applicable GST).\n` +
        `Payment terms: ${payment}.\nDelivery: ${delivery}.\nWarranty: ${warranty}.\n\n` +
        `We remain available for any clarification.\n\n${emailSignature(quotation.owner, officeName(email.officeId))}`,
      relatedDoc: quotation.number,
      amount: value,
      aiGenerated: true,
    };
  };

  const addToEmail = () => {
    if (items.length === 0) return;
    const value = persist('Quotation generated from enquiry');
    updateEmail(email.id, {
      attachedQuote: {
        fileName,
        qtnNumber: quotation.number,
        fileType: 'PDF',
        quoteValue: value,
        signature: quoteSignature({ value, items: taxed }),
        addedBy: 'system',
        addedAt: BUILD_TS,
        sizeLabel: `${118 + taxed.length * 9} KB`,
        kind: 'quotation',
      },
      draft: composedDraft(value),
    });
    addToast({
      type: 'success',
      title: 'Quote added to email',
      message: `${quotation.number} attached. Set the next review date and send from the compose window.`,
    });
    onAddedToEmail();
  };

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-stretch justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-surface-900/45 backdrop-blur-[1px] animate-fade-in" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generate quotation"
        className="relative z-10 flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-surface-100 px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-surface-800">
              <FileText className="h-4 w-4 flex-none text-brand-600" />
              Generate Quotation
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-surface-500">
              {quotation.number} · {quotation.customerName}
              {seededFromExtraction && ` · built from ${extraction?.items.length ?? 0} confirmed enquiry lines`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close quotation builder"
            className="-mr-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* Line items */}
          <section>
            <h3 className="mb-1.5 text-[14px] font-semibold text-surface-800">Quotation Items</h3>
            <div className="overflow-hidden rounded-xl border border-surface-200">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                      <th className="px-2.5 py-1.5 text-left">Item</th>
                      <th className="px-1.5 py-1.5 text-right">Qty</th>
                      <th className="px-1.5 py-1.5 text-right">Unit Price</th>
                      <th className="px-1.5 py-1.5 text-right">Disc %</th>
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
                          <input
                            type="number"
                            min={0}
                            value={it.quantity}
                            onChange={(e) => setLine(it.id, { quantity: Math.max(0, Number(e.target.value)) })}
                            disabled={!canEdit}
                            className="input h-7 w-16 px-1.5 py-0 text-right text-[12px]"
                            aria-label={`Quantity for ${it.description}`}
                          />
                        </td>
                        <td className="px-1.5 py-1.5 text-right align-top">
                          <input
                            type="number"
                            min={0}
                            value={it.unitPrice}
                            onChange={(e) => setLine(it.id, { unitPrice: Math.max(0, Number(e.target.value)) })}
                            disabled={!canEdit}
                            className="input h-7 w-24 px-1.5 py-0 text-right text-[12px]"
                            aria-label={`Unit price for ${it.description}`}
                          />
                        </td>
                        <td className="px-1.5 py-1.5 text-right align-top">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={it.discountPct}
                            onChange={(e) =>
                              setLine(it.id, { discountPct: Math.min(100, Math.max(0, Number(e.target.value))) })
                            }
                            disabled={!canEdit}
                            className="input h-7 w-14 px-1.5 py-0 text-right text-[12px]"
                            aria-label={`Discount % for ${it.description}`}
                          />
                        </td>
                        <td className="px-2.5 py-1.5 text-right align-top font-medium tabular-nums text-surface-800">
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
                        <td colSpan={6} className="px-2.5 py-3 text-center text-[12px] text-surface-400">
                          All lines removed — add at least one item before saving.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {canEdit && (
                <div className="flex items-center gap-1.5 border-t border-surface-100 bg-surface-50/60 px-2.5 py-1.5">
                  <select
                    value={addId}
                    onChange={(e) => setAddId(e.target.value)}
                    className="input h-7 flex-1 px-2 py-0 text-[12px]"
                    aria-label="Select catalogue item to add"
                  >
                    <option value="">Add catalogue item…</option>
                    {ITEMS.filter((it) => it.active).map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.code} · {it.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<Plus className="h-3.5 w-3.5" />}
                    onClick={addLine}
                    disabled={!addId}
                  >
                    Add Item
                  </Button>
                </div>
              )}
            </div>
          </section>

          {/* Commercials + live totals, side by side so a price change is read
              against the grand total it moves. */}
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section>
              <h3 className="mb-1.5 text-[14px] font-semibold text-surface-800">Commercial Terms</h3>
              <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-surface-200 px-3 py-2.5 sm:grid-cols-2">
                <SelectField
                  label="Tax (GST)"
                  value={String(taxPct)}
                  onChange={(e) => setTaxPct(Number(e.target.value))}
                  disabled={!canEdit}
                  className="py-1.5 text-[13px]"
                  options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
                />
                <TextField
                  label="Packing & Forwarding (₹)"
                  type="number"
                  min={0}
                  value={packing}
                  onChange={(e) => setPacking(Math.max(0, Number(e.target.value)))}
                  disabled={!canEdit}
                  className="py-1.5 text-[13px]"
                />
                <TextField
                  label="Payment Terms"
                  value={payment}
                  onChange={(e) => setPayment(e.target.value)}
                  disabled={!canEdit}
                  className="py-1.5 text-[13px]"
                  wrapClassName="sm:col-span-2"
                />
                <TextField
                  label="Delivery Terms"
                  value={delivery}
                  onChange={(e) => setDelivery(e.target.value)}
                  disabled={!canEdit}
                  className="py-1.5 text-[13px]"
                />
                <TextField
                  label="Warranty"
                  value={warranty}
                  onChange={(e) => setWarranty(e.target.value)}
                  disabled={!canEdit}
                  className="py-1.5 text-[13px]"
                />
              </div>
            </section>

            <section>
              <h3 className="mb-1.5 text-[14px] font-semibold text-surface-800">Totals</h3>
              <div className="space-y-1 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2.5 text-[12px]">
                <Row label="Subtotal (after discount)" value={formatINR(totals.taxable)} />
                <Row label={`Tax (GST ${taxPct}%)`} value={formatINR(totals.tax)} />
                <Row label="Packing & Forwarding" value={formatINR(totals.packingCharges)} />
                <div className="flex items-center justify-between border-t border-surface-200 pt-1.5">
                  <span className="text-[13px] font-semibold text-surface-700">Grand Total</span>
                  <span className="text-[16px] font-bold tabular-nums text-surface-900">
                    {formatINR(totals.grandTotal)}
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-surface-100 bg-surface-50/60 px-4 py-2.5">
          <p className="text-[11px] text-surface-500">
            Saving updates quotation {quotation.number}. Nothing leaves the platform until you send the email.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Save className="h-3.5 w-3.5" />}
              onClick={saveDraft}
              disabled={!canEdit || items.length === 0}
            >
              Save Draft
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Eye className="h-3.5 w-3.5" />}
              onClick={() => setShowPreview(true)}
              disabled={items.length === 0}
            >
              Preview
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Paperclip className="h-3.5 w-3.5" />}
              onClick={addToEmail}
              disabled={!canEdit || items.length === 0}
              title="Attach this quotation to a new email and open the compose window"
            >
              Add Quote to Email
            </Button>
          </div>
        </div>
      </div>

      {/* Preview — the quotation exactly as the edits above leave it. */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="xl"
        title="Preview — Quotation"
        subtitle={`${quotation.number} · ${quotation.customerName}`}
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
                <th className="px-2 py-1.5 text-right">Disc %</th>
                <th className="px-3 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-1.5">
                    <p className="font-medium text-surface-800">{it.description}</p>
                    <p className="text-[11px] text-surface-400">
                      {it.itemCode}
                      {it.hsnCode ? ` · HSN ${it.hsnCode}` : ''}
                    </p>
                  </td>
                  <td className="px-2 py-1.5 text-right text-surface-700">
                    {it.quantity} {it.unit}
                  </td>
                  <td className="px-2 py-1.5 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right text-surface-700">{it.discountPct}%</td>
                  <td className="px-3 py-1.5 text-right font-medium text-surface-800">
                    {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-1 border-t border-surface-200 px-3 py-2 text-[12px]">
            <Row label="Taxable Value" value={formatINR(totals.taxable)} />
            <Row label={`GST ${taxPct}%`} value={formatINR(totals.tax)} />
            <Row label="Packing & Forwarding" value={formatINR(totals.packingCharges)} />
            <div className="flex items-center justify-between border-t border-surface-100 pt-1.5">
              <span className="text-[13px] font-semibold text-surface-700">Grand Total</span>
              <span className="text-[14px] font-bold text-surface-900">{formatINR(totals.grandTotal)}</span>
            </div>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-surface-200 px-3 py-2.5 text-[12px] sm:grid-cols-3">
          <p><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-700">{payment}</span></p>
          <p><span className="text-surface-400">Delivery:</span> <span className="font-medium text-surface-700">{delivery}</span></p>
          <p><span className="text-surface-400">Warranty:</span> <span className="font-medium text-surface-700">{warranty}</span></p>
        </div>
      </Modal>
    </div>,
    document.body
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={classNames('flex items-center justify-between')}>
      <span className="text-surface-500">{label}</span>
      <span className="font-medium tabular-nums text-surface-700">{value}</span>
    </div>
  );
}

/** Lines produced by this builder carry an `ln-req-` id — see seedLines. */
function alreadyBuilt(quotation: Quotation): boolean {
  return quotation.items.some((l) => l.id.startsWith('ln-req-'));
}

function usesExtraction(quotation: Quotation, extraction: RequirementExtraction | null): boolean {
  if (alreadyBuilt(quotation)) return false;
  return !!extraction && extraction.items.some((it) => it.status !== 'error');
}

/**
 * The quotation lines an enquiry starts from.
 *
 * The extraction reads one row per TAG, so a "4 Nos" line arrives as four rows
 * of quantity 1. A quotation is priced per item, not per tag, so the rows are
 * grouped back to one line per catalogue code with the tag quantities summed.
 * Error lines are left out: a line whose stated values cannot be true has to be
 * fixed in the datasheet before it can carry a price.
 *
 * Prices come from the quotation's own matching line first (it may already have
 * been negotiated), then the item master, then zero — a zero rate is visible in
 * the table and in the grand total, which is the honest place for a gap.
 */
function seedLines(quotation: Quotation, extraction: RequirementExtraction | null): LineItem[] {
  if (!usesExtraction(quotation, extraction) || !extraction) return quotation.items.map(clone);

  const groups = new Map<string, { name: string; code: string; qty: number; unit: string }>();
  for (const it of extraction.items) {
    if (it.status === 'error') continue;
    const key = it.code || it.name;
    const qty = it.quantity ?? 1;
    const g = groups.get(key);
    if (g) g.qty += qty;
    else groups.set(key, { name: it.name, code: it.code, qty, unit: it.unit || 'Nos' });
  }
  if (groups.size === 0) return quotation.items.map(clone);

  const used = new Set<string>();
  return Array.from(groups.values()).map((g, i) => {
    const match =
      quotation.items.find((l) => !used.has(l.id) && g.code && l.itemCode === g.code) ??
      quotation.items.find((l) => !used.has(l.id) && l.description === g.name);
    if (match) used.add(match.id);
    const master =
      (g.code ? ITEMS.find((m) => m.code === g.code) : undefined) ??
      (match ? ITEMS.find((m) => m.id === match.itemId) : undefined);
    return {
      id: `ln-req-${quotation.id}-${i}`,
      itemId: master?.id ?? match?.itemId ?? '',
      itemCode: g.code || match?.itemCode || master?.code || '—',
      description: g.name,
      hsnCode: master?.hsnCode ?? match?.hsnCode ?? '',
      quantity: g.qty,
      unit: g.unit || master?.unit || match?.unit || 'Nos',
      unitPrice: match?.unitPrice ?? master?.unitPrice ?? 0,
      discountPct: match?.discountPct ?? 0,
      taxPct: match?.taxPct ?? 18,
    };
  });
}
