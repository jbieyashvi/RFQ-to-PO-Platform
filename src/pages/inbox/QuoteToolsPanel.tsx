import { useEffect, useMemo, useState } from 'react';
import { Eye, Plus, Trash2, CheckCircle2, Save, Paperclip } from 'lucide-react';
import type { InboxEmail, LineItem, OutgoingDraft, Quotation } from '@/types';
import { Button, Modal, StatusBadge } from '@/components/ui';
import { DocumentLetterhead } from '@/components/DocumentLetterhead';
import { useApp } from '@/context/AppContext';
import { ITEMS } from '@/data/masters';
import { classNames, computeTotals, formatINR, lineTotal } from '@/lib/format';
import { APP_NAME, emailSignature } from '@/lib/brand';
import { officeName } from '@/data/offices';
import { quoteSignature } from './helpers';

// Deterministic prototype clock (pinned to 2026-08-13).
const ATTACH_TS = '2026-08-13T12:40:00';

const clone = (it: LineItem): LineItem => ({ ...it });

/**
 * RIGHT panel for "Quotes Pending to be Sent" (quote-send mode). An EDITABLE
 * quotation workspace: adjust quantity, unit price and discount, add/remove
 * items, and watch subtotal, tax and grand total recalculate live. It only
 * PREPARES the quotation — Save Changes persists it (the single data source
 * used by the editor, preview, attachment and email body), then "Add Updated
 * Quote as Attachment" hands the generated PDF to the centre composer. The
 * email itself (recipient, next review date, send) lives in the centre panel.
 */
export function QuoteToolsPanel({
  email,
  quotation,
  onPrepared,
}: {
  email: InboxEmail;
  quotation: Quotation;
  onPrepared?: () => void;
}) {
  const { updateQuotation, updateEmail, addToast, can, currentUser } = useApp();

  const canEdit = can('quotations', 'edit');

  // Editable working copy of the quotation lines.
  const [items, setItems] = useState<LineItem[]>(quotation.items.map(clone));
  const [addId, setAddId] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    // Also re-sync when the email flips to sent, so the read-only view shows
    // the quotation exactly as it was sent — never unsaved scratch edits.
    setItems(quotation.items.map(clone));
    setAddId('');
    setShowPreview(false);
  }, [email.id, quotation.id, email.sent]); // eslint-disable-line react-hooks/exhaustive-deps

  const packing = quotation.packingCharges;
  const totals = useMemo(() => computeTotals(items, packing), [items, packing]);
  const changed = JSON.stringify(items) !== JSON.stringify(quotation.items);

  const alreadySent = email.sent;
  const editable = canEdit && !alreadySent;
  const attached = email.attachedQuote;
  const currentSig = quoteSignature({ value: totals.grandTotal, items });
  // Stale = the attachment no longer matches what the workspace shows.
  const isStale = !!(attached && attached.signature !== currentSig);

  const fileName = `${quotation.number.replace(/\//g, '-')}.pdf`;

  const setLine = (id: string, patch: Partial<Pick<LineItem, 'quantity' | 'unitPrice' | 'discountPct'>>) =>
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

  // Persist the edited lines to THE quotation record — the one data source the
  // editor, preview, attachment and email body all read from.
  const persistQuote = (): number => {
    const value = computeTotals(items, packing).grandTotal;
    // Also persist when only the stored value is out of sync (e.g. seed data
    // where packing charges were not folded into the value).
    if (!changed && quotation.value === value) return value;
    updateQuotation(quotation.id, {
      items: items.map(clone),
      value,
      lastUpdated: '2026-08-13',
      activity: [
        ...quotation.activity,
        {
          id: `act-${quotation.id}-edit-${Date.now()}`,
          date: ATTACH_TS,
          actor: currentUser.fullName,
          action: 'Quotation updated before sending',
          detail: `${quotation.number} · new value ${formatINR(value)}`,
        },
      ],
    });
    return value;
  };

  const saveChanges = () => {
    if (items.length === 0) return;
    persistQuote();
    addToast({ type: 'success', title: 'Changes saved', message: `${quotation.number} updated. Grand total ${formatINR(totals.grandTotal)}.` });
  };

  // Refresh the outgoing draft so the email body's grand-total line always
  // matches the saved quotation. Keeps the user's own wording when a draft
  // already exists; otherwise seeds a full AI draft.
  const syncedDraft = (value: number): OutgoingDraft => {
    const totalLine = `Grand total: ${formatINR(value)} (inclusive of applicable GST).`;
    if (email.draft) {
      const body = /^Grand total:.*$/m.test(email.draft.body)
        ? email.draft.body.replace(/^Grand total:.*$/m, totalLine)
        : email.draft.body;
      return { ...email.draft, body, amount: value };
    }
    const contact = (email.senderName.split(' ')[0] || 'Sir/Madam').trim();
    return {
      from: email.recipient,
      to: email.senderEmail,
      cc: email.cc.join(', '),
      subject: `Quotation ${quotation.number} from ${APP_NAME}`,
      body:
        `Dear ${contact},\n\nPlease find attached our quotation ${quotation.number} for your kind review.\n\n` +
        `${totalLine}\nPayment terms: ${quotation.paymentTerms}.\nDelivery: ${quotation.deliveryTerms}.\n\n` +
        `We remain available for any clarification.\n\n${emailSignature(quotation.owner, officeName(email.officeId))}`,
      relatedDoc: quotation.number,
      amount: value,
      aiGenerated: true,
    };
  };

  const addUpdatedToEmail = () => {
    if (items.length === 0) return;
    const value = persistQuote();
    updateEmail(email.id, {
      attachedQuote: {
        fileName,
        qtnNumber: quotation.number,
        fileType: 'PDF',
        quoteValue: value,
        signature: quoteSignature({ value, items }),
        addedBy: 'system',
        addedAt: ATTACH_TS,
        sizeLabel: `${118 + items.length * 9} KB`,
      },
      draft: syncedDraft(value),
    });
    addToast({ type: 'success', title: 'Added to email', message: 'Updated quotation attached. Set the next review date and send from the centre panel.' });
    onPrepared?.();
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone="blue" label="Quote Pending to be Sent" />
          <span className="text-[11px] font-semibold text-surface-400">Quotation Workspace</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-y-0.5 text-[12px]">
          <p><span className="text-surface-400">Quotation:</span> <span className="font-semibold text-surface-800">{quotation.number}</span></p>
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-700">{quotation.customerName}</span></p>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {alreadySent && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
            <CheckCircle2 className="h-4 w-4 flex-none" /> Quotation sent on {email.sentAt?.slice(0, 10)} — moved to Follow-up Pending.
          </div>
        )}

        {/* Editable quotation lines */}
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">Quotation Items</h3>
            {changed && !alreadySent && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Unsaved edits</span>}
          </div>
          <div className="overflow-hidden rounded-xl border border-surface-200">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                  <th className="px-2.5 py-2 text-left">Item</th>
                  <th className="px-1.5 py-2 text-right">Qty</th>
                  <th className="px-1.5 py-2 text-right">Unit Price</th>
                  <th className="px-1.5 py-2 text-right">Disc%</th>
                  <th className="px-2.5 py-2 text-right">Line Total</th>
                  {editable && <th className="w-8 px-1 py-2" />}
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
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          value={it.quantity}
                          onChange={(e) => setLine(it.id, { quantity: Math.max(0, Number(e.target.value)) })}
                          className="input h-7 w-14 px-1.5 py-0 text-right text-[12px]"
                          aria-label={`Quantity for ${it.description}`}
                        />
                      ) : (
                        <span className="text-surface-700">{it.quantity} {it.unit}</span>
                      )}
                    </td>
                    <td className="px-1.5 py-2 text-right align-top">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          value={it.unitPrice}
                          onChange={(e) => setLine(it.id, { unitPrice: Math.max(0, Number(e.target.value)) })}
                          className="input h-7 w-20 px-1.5 py-0 text-right text-[12px]"
                          aria-label={`Unit price for ${it.description}`}
                        />
                      ) : (
                        <span className="text-surface-700">{formatINR(it.unitPrice)}</span>
                      )}
                    </td>
                    <td className="px-1.5 py-2 text-right align-top">
                      {editable ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={it.discountPct}
                          onChange={(e) => setLine(it.id, { discountPct: Math.min(100, Math.max(0, Number(e.target.value))) })}
                          className="input h-7 w-12 px-1.5 py-0 text-right text-[12px]"
                          aria-label={`Discount % for ${it.description}`}
                        />
                      ) : (
                        <span className="text-surface-700">{it.discountPct}%</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 text-right align-top font-medium text-surface-800">
                      {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                    </td>
                    {editable && (
                      <td className="px-1 py-2 text-center align-top">
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
                    <td colSpan={6} className="px-2.5 py-4 text-center text-[12px] text-surface-400">
                      All lines removed — add at least one item before saving.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Add item */}
            {editable && (
              <div className="flex items-center gap-1.5 border-t border-surface-100 bg-surface-50/60 px-2.5 py-2">
                <select
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                  className="input h-7 flex-1 px-2 py-0 text-[12px]"
                  aria-label="Select catalogue item to add"
                >
                  <option value="">Add catalogue item…</option>
                  {ITEMS.filter((it) => it.active).map((it) => (
                    <option key={it.id} value={it.id}>{it.code} · {it.name}</option>
                  ))}
                </select>
                <Button variant="secondary" size="sm" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={addLine} disabled={!addId}>
                  Add
                </Button>
              </div>
            )}
          </div>

          {/* Live totals */}
          <div className="mt-2 space-y-1 rounded-lg bg-surface-50 px-3 py-2 text-[12px]">
            <div className="flex items-center justify-between"><span className="text-surface-500">Subtotal (after discount)</span><span className="font-medium text-surface-700">{formatINR(totals.taxable)}</span></div>
            <div className="flex items-center justify-between"><span className="text-surface-500">Tax (GST)</span><span className="font-medium text-surface-700">{formatINR(totals.tax)}</span></div>
            <div className="flex items-center justify-between"><span className="text-surface-500">Packing &amp; Forwarding</span><span className="font-medium text-surface-700">{formatINR(totals.packingCharges)}</span></div>
            <div className="flex items-center justify-between border-t border-surface-200 pt-1.5">
              <span className="font-semibold text-surface-700">Grand Total</span>
              <span className="text-[15px] font-bold text-surface-900">{formatINR(totals.grandTotal)}</span>
            </div>
          </div>
        </section>

        {/* Attachment status — mirrors what the centre composer carries */}
        {attached && !alreadySent && (
          <div className={classNames('mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]', isStale ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
            <Paperclip className="h-4 w-4 flex-none" />
            {isStale
              ? 'The quotation changed since it was added. Use “Add Updated Quote as Attachment” again to refresh it.'
              : `${attached.fileName} added to the email — set the next review date and send from the centre panel.`}
          </div>
        )}
      </div>

      {/* Footer — prepare actions only; the email is sent from the centre panel */}
      {!alreadySent && (
        <div className="flex-none space-y-2 border-t border-surface-100 bg-surface-50/60 px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={saveChanges} disabled={!canEdit || items.length === 0}>
              Save Changes
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setShowPreview(true)} disabled={items.length === 0}>
              Preview Quote
            </Button>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            leftIcon={<Paperclip className="h-4 w-4" />}
            onClick={addUpdatedToEmail}
            disabled={!canEdit || items.length === 0 || (!!attached && !isStale && !changed)}
            title="Attach the updated quotation PDF to the email in the centre panel"
          >
            {isStale || changed ? 'Add Updated Quote as Attachment' : attached ? 'Added to Email' : 'Add Updated Quote as Attachment'}
          </Button>
          {attached && !isStale && !changed && (
            <p className="flex items-center justify-center gap-1 text-center text-[11px] font-medium text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Ready in the centre composer.
            </p>
          )}
          <p className="text-center text-[11px] text-surface-400">
            Only the system-generated quotation PDF can be attached. The email is written and sent from the centre panel.
          </p>
        </div>
      )}

      {/* Preview Quote — rendered from the SAME edited lines shown in the editor */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="xl"
        title="Preview — Quotation"
        subtitle={`${quotation.number} · ${quotation.customerName}`}
        footer={<Button variant="primary" onClick={() => setShowPreview(false)}>Close</Button>}
      >
        <DocumentLetterhead
          docTitle="Quotation"
          meta={<p className="font-semibold text-surface-800">{quotation.number}</p>}
        />
        <div className="mt-4 overflow-hidden rounded-xl border border-surface-200">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Rate</th>
                <th className="px-2 py-2 text-right">Disc%</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description}</p><p className="text-[11px] text-surface-400">{it.itemCode} · HSN {it.hsnCode}</p></td>
                  <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                  <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                  <td className="px-2 py-2 text-right text-surface-700">{it.discountPct}%</td>
                  <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-1 border-t border-surface-200 px-3 py-2 text-[12px]">
            <div className="flex items-center justify-between"><span className="text-surface-500">Taxable Value</span><span className="font-medium text-surface-700">{formatINR(totals.taxable)}</span></div>
            <div className="flex items-center justify-between"><span className="text-surface-500">GST</span><span className="font-medium text-surface-700">{formatINR(totals.tax)}</span></div>
            <div className="flex items-center justify-between"><span className="text-surface-500">Packing &amp; Forwarding</span><span className="font-medium text-surface-700">{formatINR(totals.packingCharges)}</span></div>
            <div className="flex items-center justify-between border-t border-surface-100 pt-1.5">
              <span className="font-semibold text-surface-700">Grand Total</span>
              <span className="text-[14px] font-bold text-surface-900">{formatINR(totals.grandTotal)}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-surface-200 px-4 py-3 text-[12px] sm:grid-cols-3">
          <p><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-700">{quotation.paymentTerms}</span></p>
          <p><span className="text-surface-400">Delivery:</span> <span className="font-medium text-surface-700">{quotation.deliveryTerms}</span></p>
          <p><span className="text-surface-400">Warranty:</span> <span className="font-medium text-surface-700">{quotation.warranty}</span></p>
        </div>
      </Modal>
    </div>
  );
}
