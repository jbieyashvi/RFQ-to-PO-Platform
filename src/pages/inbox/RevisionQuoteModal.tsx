import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Eye, FilePenLine, Paperclip, Plus, Save, Trash2, X } from 'lucide-react';
import type { InboxEmail, LineItem, Quotation, RequestedChange } from '@/types';
import { Button, Modal, SelectField, TextAreaField, TextField } from '@/components/ui';
import { DocumentLetterhead } from '@/components/DocumentLetterhead';
import { useApp } from '@/context/AppContext';
import { ITEMS } from '@/data/masters';
import { officeName } from '@/data/offices';
import { emailSignature } from '@/lib/brand';
import { classNames, computeTotals, formatINR, lineTotal } from '@/lib/format';
import {
  applyProposed,
  buildVersions,
  latestQuoteSnapshot,
  proposedTerms,
  type QuoteSnapshot,
} from '@/lib/revisionQueue';
import { quoteSignature } from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const ATTACH_TS = '2026-08-13T12:40:00';
const TODAY = '2026-08-13';

const GST_RATES = [0, 5, 12, 18, 28];

const clone = (it: LineItem): LineItem => ({ ...it });

const CHANGE_TONE: Record<string, string> = {
  unit_price: 'text-emerald-700',
  quantity: 'text-emerald-700',
  delivery: 'text-brand-700',
  payment: 'text-brand-700',
  warranty: 'text-brand-700',
  catalogue_item: 'text-violet-700',
  add_item: 'text-violet-700',
  remove_item: 'text-rose-700',
};

/**
 * Edit Quote — the revised quotation, edited at full width.
 *
 * The right column used to hold this entire editor, which meant negotiating a
 * price list inside a 320px strip: no discount, no tax, no commercial terms,
 * and the requested changes scrolled away above the table you were meant to be
 * applying them to. The right panel is now a summary, and the editing happens
 * here — the customer's asks pinned at the top of a large scrollable sheet with
 * the whole quotation, lines and commercials alike, underneath them.
 *
 * Every field is measured against the LAST VERSION THE CUSTOMER RECEIVED (the
 * newest QuoteVersion, or the quotation itself before one is cut), so an edit
 * reads as old → new against what they are actually holding — not against a
 * draft that was already saved once.
 *
 * Nothing is sent from here. "Add Revised Quote to Email" saves the revision,
 * attaches the generated PDF and hands over to the compose popup, which is the
 * one surface that sends and the one that cuts the next version.
 */
export function RevisionQuoteModal({
  email,
  quotation,
  onAddedToEmail,
  onClose,
}: {
  email: InboxEmail;
  quotation: Quotation;
  onAddedToEmail: () => void;
  onClose: () => void;
}) {
  const { updateQuotation, updateEmail, addToast, can, currentUser } = useApp();

  const canEdit = can('quotations', 'edit');
  const changes = email.requestedChanges ?? [];

  // What the customer is holding right now — the comparison baseline for every
  // old → new marker below.
  const baseline = useMemo<QuoteSnapshot>(() => latestQuoteSnapshot(quotation), [quotation]);

  // A revision that has been saved once already lives on the quotation record
  // (its lines were overwritten and V1 was preserved). Only the FIRST open
  // seeds the customer's proposed values — after that the saved draft wins, so
  // a hand-corrected price is never re-seeded away.
  const [items, setItems] = useState<LineItem[]>(() =>
    hasSavedDraft(quotation) ? quotation.items.map(clone) : applyProposed(quotation.items, changes)
  );
  const [addId, setAddId] = useState('');
  const [taxPct, setTaxPct] = useState<number>(() => quotation.items[0]?.taxPct ?? 18);
  const [packing, setPacking] = useState<number>(quotation.packingCharges);

  const asked = useMemo(() => proposedTerms(changes), [changes]);
  const seedTerm = (saved: string, proposed?: string) =>
    hasSavedDraft(quotation) ? saved : proposed ?? saved;

  const [payment, setPayment] = useState(() => seedTerm(quotation.paymentTerms, asked.paymentTerms));
  const [delivery, setDelivery] = useState(() => seedTerm(quotation.deliveryTerms, asked.deliveryTerms));
  const [warranty, setWarranty] = useState(() => seedTerm(quotation.warranty, asked.warranty));
  const [otherTerms, setOtherTerms] = useState(quotation.otherTerms ?? '');
  const [showPreview, setShowPreview] = useState(false);

  // One GST rate for the whole quotation — the rate is a commercial decision,
  // not a per-row one.
  const taxed = useMemo(() => items.map((it) => ({ ...it, taxPct })), [items, taxPct]);
  const totals = useMemo(() => computeTotals(taxed, packing), [taxed, packing]);
  const delta = totals.grandTotal - baseline.value;

  const baseLine = (id: string) => baseline.items.find((it) => it.id === id) ?? null;
  const dropped = baseline.items.filter((b) => !items.some((it) => it.id === b.id));

  const setLine = (id: string, patch: Partial<Pick<LineItem, 'quantity' | 'unitPrice' | 'discountPct'>>) =>
    setItems((rows) => rows.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const removeLine = (id: string) => setItems((rows) => rows.filter((it) => it.id !== id));

  const addLine = () => {
    const src = ITEMS.find((it) => it.id === addId);
    if (!src) return;
    setItems((rows) => [
      ...rows,
      {
        id: `ln-rev-${src.id}-${rows.length}`,
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

  /**
   * The ONE write of this modal: the quotation record, revised. buildVersions
   * seeds V1 from the quotation as it stands BEFORE the first overwrite, so the
   * quote the customer already has is preserved rather than edited over. The
   * quotation stays in `needs_revision` — it only leaves the queue when the
   * revised mail is actually sent.
   */
  const persist = (note: string): number => {
    const value = totals.grandTotal;
    const { existing } = buildVersions(quotation, currentUser.fullName);
    updateQuotation(quotation.id, {
      quoteVersions: existing,
      items: taxed.map(clone),
      value,
      packingCharges: packing,
      paymentTerms: payment,
      deliveryTerms: delivery,
      warranty,
      otherTerms: otherTerms.trim() || undefined,
      workState: 'needs_revision',
      lastUpdated: TODAY,
      revisions: [
        ...quotation.revisions,
        {
          id: `rev-${quotation.id}-edit-${quotation.revisions.length + 1}`,
          version: existing.length + 1,
          date: TODAY,
          reason: 'Quotation revised per customer request',
          by: currentUser.fullName,
        },
      ],
      activity: [
        ...quotation.activity,
        {
          id: `act-${quotation.id}-revise-${Date.now()}`,
          date: ATTACH_TS,
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
    const value = persist('Revised quotation drafted');
    addToast({
      type: 'success',
      title: 'Draft saved',
      message: `${quotation.number} revised to ${formatINR(value)}. The previous version is preserved.`,
    });
  };

  const addToEmail = () => {
    if (items.length === 0) return;
    const value = persist('Revised quotation prepared for sending');
    const contact = (email.senderName.split(' ')[0] || 'Sir/Madam').trim();
    updateEmail(email.id, {
      composeIntent: 'revision',
      attachedQuote: {
        fileName: `${quotation.number.replace(/\//g, '-')}-revised.pdf`,
        qtnNumber: quotation.number,
        fileType: 'PDF',
        quoteValue: value,
        signature: quoteSignature({ value, items: taxed }),
        addedBy: 'system',
        addedAt: ATTACH_TS,
        version: 'Revised',
        sizeLabel: `${118 + taxed.length * 9} KB`,
        kind: 'revised',
      },
      draft: {
        from: email.recipient,
        to: email.senderEmail,
        cc: email.cc.join(', '),
        subject: `Revised quotation ${quotation.number} — ${quotation.customerName}`,
        body:
          `Dear ${contact},\n\nThank you for your feedback on quotation ${quotation.number}. ` +
          `Please find attached our revised quotation reflecting the requested changes.\n\n` +
          `Revised value: ${formatINR(value)} (inclusive of applicable GST).\n` +
          `Payment terms: ${payment}.\nDelivery: ${delivery}.\nWarranty: ${warranty}.\n` +
          (otherTerms.trim() ? `Other terms: ${otherTerms.trim()}.\n` : '') +
          `\nKindly review and confirm. We remain available for any clarification.\n\n` +
          emailSignature(quotation.owner, officeName(email.officeId)),
        relatedDoc: quotation.number,
        amount: value,
        aiGenerated: true,
      },
    });
    addToast({
      type: 'success',
      title: 'Revised quote added to email',
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
        aria-label="Edit revised quotation"
        className="relative z-10 flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up"
      >
        <div className="flex flex-none items-start justify-between gap-4 border-b border-surface-100 px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold text-surface-800">
              <FilePenLine className="h-4 w-4 flex-none text-brand-600" />
              Edit Quote — Revision
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-surface-500">
              {quotation.number} · {quotation.customerName} · revising {baseline.label}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close revised quotation editor"
            className="-mr-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* Requested changes — pinned so the asks stay in view while the
              quotation below them is edited to match. */}
          <section className="sticky -top-3 z-10 -mx-4 mb-3 border-b border-amber-100 bg-amber-50/95 px-4 py-2.5 backdrop-blur-sm">
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Requested Changes — {email.customerName}
            </h3>
            {changes.length === 0 ? (
              <p className="text-[12px] text-amber-800">No specific changes were extracted from the customer's email.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {changes.map((c) => (
                  <ChangeChip key={c.id} change={c} />
                ))}
              </ul>
            )}
          </section>

          {/* Line items */}
          <section>
            <h3 className="mb-1.5 text-[14px] font-semibold text-surface-800">Revised Quotation Items</h3>
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
                    {items.map((it) => {
                      const was = baseLine(it.id);
                      return (
                        <tr key={it.id}>
                          <td className="px-2.5 py-1.5 align-top">
                            <p className="font-medium text-surface-800">{it.description}</p>
                            <p className="text-[11px] text-surface-400">
                              {it.itemCode}
                              {it.hsnCode ? ` · HSN ${it.hsnCode}` : ''} · {it.unit}
                            </p>
                            {!was && (
                              <span className="mt-0.5 inline-block rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                                Added in this revision
                              </span>
                            )}
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
                            <Delta old={was ? `${was.quantity}` : null} next={`${it.quantity}`} />
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
                            <Delta old={was ? formatINR(was.unitPrice) : null} next={formatINR(it.unitPrice)} />
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
                            <Delta old={was ? `${was.discountPct}%` : null} next={`${it.discountPct}%`} />
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
                      );
                    })}
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

            {/* Lines the revision drops are still part of the change set — they
                have to be visible somewhere, or the removal is silent. */}
            {dropped.length > 0 && (
              <p className="mt-1.5 text-[11px] text-rose-600">
                Removed from {baseline.label}:{' '}
                <span className="font-medium">{dropped.map((d) => d.description).join(', ')}</span>
              </p>
            )}
          </section>

          {/* Commercials + live totals, side by side so a price change is read
              against the grand total it moves. */}
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section>
              <h3 className="mb-1.5 text-[14px] font-semibold text-surface-800">Commercial Terms</h3>
              <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-surface-200 px-3 py-2.5 sm:grid-cols-2">
                <div>
                  <SelectField
                    label="Tax (GST)"
                    value={String(taxPct)}
                    onChange={(e) => setTaxPct(Number(e.target.value))}
                    disabled={!canEdit}
                    className="py-1.5 text-[13px]"
                    options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
                  />
                  <Delta old={`${baseline.items[0]?.taxPct ?? taxPct}%`} next={`${taxPct}%`} />
                </div>
                <div>
                  <TextField
                    label="Packing & Forwarding (₹)"
                    type="number"
                    min={0}
                    value={packing}
                    onChange={(e) => setPacking(Math.max(0, Number(e.target.value)))}
                    disabled={!canEdit}
                    className="py-1.5 text-[13px]"
                  />
                  <Delta old={formatINR(baseline.packingCharges)} next={formatINR(packing)} />
                </div>
                <div className="sm:col-span-2">
                  <TextField
                    label="Payment Terms"
                    value={payment}
                    onChange={(e) => setPayment(e.target.value)}
                    disabled={!canEdit}
                    className="py-1.5 text-[13px]"
                  />
                  <Delta old={baseline.paymentTerms} next={payment} />
                </div>
                <div>
                  <TextField
                    label="Delivery Terms"
                    value={delivery}
                    onChange={(e) => setDelivery(e.target.value)}
                    disabled={!canEdit}
                    className="py-1.5 text-[13px]"
                  />
                  <Delta old={baseline.deliveryTerms} next={delivery} />
                </div>
                <div>
                  <TextField
                    label="Warranty"
                    value={warranty}
                    onChange={(e) => setWarranty(e.target.value)}
                    disabled={!canEdit}
                    className="py-1.5 text-[13px]"
                  />
                  <Delta old={baseline.warranty} next={warranty} />
                </div>
                <div className="sm:col-span-2">
                  <TextAreaField
                    label="Other Commercial Terms"
                    rows={2}
                    value={otherTerms}
                    onChange={(e) => setOtherTerms(e.target.value)}
                    disabled={!canEdit}
                    placeholder="Validity, freight, inspection, price basis…"
                    className="py-1.5 text-[13px]"
                  />
                  <Delta old={baseline.otherTerms || '—'} next={otherTerms || '—'} />
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-1.5 text-[14px] font-semibold text-surface-800">Totals</h3>
              <div className="space-y-1 rounded-xl border border-surface-200 bg-surface-50 px-3 py-2.5 text-[12px]">
                <Row label="Subtotal (after discount)" value={formatINR(totals.taxable)} />
                <Row label={`Tax (GST ${taxPct}%)`} value={formatINR(totals.tax)} />
                <Row label="Packing & Forwarding" value={formatINR(totals.packingCharges)} />
                <div className="flex items-center justify-between border-t border-surface-200 pt-1.5">
                  <span className="text-[13px] font-semibold text-surface-700">Revised Grand Total</span>
                  <span className="text-[16px] font-bold tabular-nums text-surface-900">
                    {formatINR(totals.grandTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-surface-500">{baseline.label} value</span>
                  <span className="tabular-nums text-surface-500">{formatINR(baseline.value)}</span>
                </div>
                {delta !== 0 && (
                  <p
                    className={classNames(
                      'text-right text-[11px] font-semibold',
                      delta < 0 ? 'text-emerald-600' : 'text-rose-600'
                    )}
                  >
                    {delta < 0 ? '−' : '+'}
                    {formatINR(Math.abs(delta))} vs {baseline.label}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-surface-100 bg-surface-50/60 px-4 py-2.5">
          <p className="text-[11px] text-surface-500">
            Saving keeps {baseline.label} intact. Nothing leaves the platform until you send the email.
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
              Preview Revised Quote
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Paperclip className="h-3.5 w-3.5" />}
              onClick={addToEmail}
              disabled={!canEdit || items.length === 0}
              title="Attach the revised quotation to a reply and open the compose window"
            >
              Add Revised Quote to Email
            </Button>
          </div>
        </div>
      </div>

      {/* Preview — the revised quotation exactly as the edits above leave it. */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="xl"
        title="Preview — Revised Quotation"
        subtitle={`${quotation.number} · ${quotation.customerName}`}
        footer={
          <Button variant="primary" onClick={() => setShowPreview(false)}>
            Close
          </Button>
        }
      >
        <DocumentLetterhead
          docTitle="Revised Quotation"
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
              <span className="text-[13px] font-semibold text-surface-700">Revised Grand Total</span>
              <span className="text-[14px] font-bold text-surface-900">{formatINR(totals.grandTotal)}</span>
            </div>
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-surface-200 px-3 py-2.5 text-[12px] sm:grid-cols-3">
          <p><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-700">{payment}</span></p>
          <p><span className="text-surface-400">Delivery:</span> <span className="font-medium text-surface-700">{delivery}</span></p>
          <p><span className="text-surface-400">Warranty:</span> <span className="font-medium text-surface-700">{warranty}</span></p>
          {otherTerms.trim() && (
            <p className="sm:col-span-3"><span className="text-surface-400">Other terms:</span> <span className="font-medium text-surface-700">{otherTerms}</span></p>
          )}
        </div>
      </Modal>
    </div>,
    document.body
  );
}

/** A revision saved once already lives on the quotation, with V1 preserved. */
function hasSavedDraft(quotation: Quotation): boolean {
  return (quotation.quoteVersions?.length ?? 0) > 0;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-surface-500">{label}</span>
      <span className="font-medium tabular-nums text-surface-700">{value}</span>
    </div>
  );
}

/**
 * old → new for one field, rendered only when the value actually moved. `old`
 * of null means the field has no counterpart in the previous version (a line
 * added by this revision) — there is nothing to compare it against.
 */
function Delta({ old, next }: { old: string | null; next: string }) {
  if (old === null || old === next) return null;
  return (
    <p className="mt-0.5 flex items-center justify-start gap-1 text-[10px] leading-tight">
      <span className="text-surface-400 line-through">{old}</span>
      <ArrowRight className="h-2.5 w-2.5 flex-none text-surface-300" />
      <span className="font-semibold text-emerald-700">{next}</span>
    </p>
  );
}

function ChangeChip({ change }: { change: RequestedChange }) {
  const tone = CHANGE_TONE[change.type] ?? 'text-surface-700';
  return (
    <li className="rounded-lg border border-amber-200 bg-white px-2.5 py-1.5">
      <p className="truncate text-[11px] font-medium text-surface-500" title={change.label}>
        {change.label}
      </p>
      <div className="mt-0.5 flex items-center gap-1.5 text-[12px]">
        <span className="truncate text-surface-400 line-through">{change.oldValue}</span>
        <ArrowRight className="h-3 w-3 flex-none text-surface-300" />
        <span className={classNames('truncate font-semibold', tone)}>{change.newValue}</span>
      </div>
    </li>
  );
}
