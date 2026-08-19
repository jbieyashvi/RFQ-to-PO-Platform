import { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Sparkles,
  Eye,
  Plus,
  Trash2,
  ArrowRight,
  CheckCircle2,
  Download,
  Save,
  Paperclip,
} from 'lucide-react';
import type { InboxEmail, LineItem, RequestedChange } from '@/types';
import { Button, Modal, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ITEMS } from '@/data/masters';
import { classNames, downloadText, formatINR, lineTotal } from '@/lib/format';
import { buildVersions, fmtDate, grandTotalOf } from '@/lib/revisionQueue';
import { officeName } from '@/data/offices';
import { quoteSignature } from './helpers';

const ATTACH_TS = '2026-08-13T12:40:00';

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
 * RIGHT panel for a "Quote Needs Revision" conversation. It only PREPARES the
 * revised quotation — edit the lines, save the revision as a new version, then
 * hand the generated PDF to the centre composer via "Add Revised Quote to
 * Email". The email itself (recipient, review date, send) lives in the centre
 * panel; there is no direct send here.
 */
export function RevisionQuotePanel({
  email,
  onPrepared,
}: {
  email: InboxEmail;
  onPrepared?: () => void;
}) {
  const { quotations, updateQuotation, updateEmail, addToast, currentUser, can } = useApp();

  const q = quotations.find((x) => x.id === email.revisionSendId) ?? null;

  const canEdit = can('quotations', 'edit');
  const canDownload = can('quotations', 'download');

  const changes = email.requestedChanges ?? [];

  // Editable working copy of the revised quote — the latest quote with the
  // AI-proposed values applied; the user can still correct every value.
  const [items, setItems] = useState<LineItem[]>([]);
  const [addId, setAddId] = useState('');
  const [showLatest, setShowLatest] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [savedRevision, setSavedRevision] = useState(false);

  useEffect(() => {
    if (!q) return;
    const proposed = q.items.map((it) => {
      const patch = changes.find((c) => c.itemId === it.id && c.field && typeof c.itemProposed === 'number');
      return patch ? { ...it, [patch.field as 'unitPrice' | 'quantity']: patch.itemProposed as number } : { ...it };
    });
    setItems(proposed);
    setAddId('');
    setShowLatest(false);
    setShowPreview(false);
    setSavedRevision(false);
  }, [email.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const packing = q?.packingCharges ?? 0;
  const grandTotal = useMemo(() => grandTotalOf(items, packing), [items, packing]);
  const baselineTotal = q?.value ?? 0;
  const delta = grandTotal - baselineTotal;
  const changed = q ? JSON.stringify(items) !== JSON.stringify(q.items) : false;

  if (!q) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-[12px] text-surface-500">The linked quotation for this revision could not be found.</p>
      </div>
    );
  }

  const alreadySent = email.sent;
  const attached = email.attachedQuote;
  const attachStale = !!(attached && attached.signature !== quoteSignature({ value: grandTotal, items }));

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

  // Persist the edited lines as the current revised quotation, seeding a
  // baseline version (V1 = the original) BEFORE overwriting so the previous
  // quote is never lost. Returns the revised grand total.
  const persistRevision = (): number => {
    const revisedValue = grandTotalOf(items, packing);
    // buildVersions seeds V1 from the CURRENT q (still the original here) only
    // when no versions exist yet; on a re-save it returns the existing history.
    const { existing } = buildVersions(q, currentUser.fullName);
    updateQuotation(q.id, {
      quoteVersions: existing,
      items: items.map(clone),
      value: revisedValue,
      workState: 'needs_revision',
      reviewDate: q.reviewDate,
      lastUpdated: '2026-08-13',
      revisions: [
        ...q.revisions,
        {
          id: `rev-${q.id}-edit-${q.revisions.length + 1}`,
          version: existing.length + 1,
          date: '2026-08-13',
          reason: 'Quotation revised per customer request',
          by: currentUser.fullName,
        },
      ],
      activity: [
        ...q.activity,
        {
          id: `act-${q.id}-revise-${Date.now()}`,
          date: ATTACH_TS,
          actor: currentUser.fullName,
          action: 'Quotation revised',
          detail: `${email.inquiryNo ?? q.number} · new value ${formatINR(revisedValue)}`,
        },
      ],
    });
    return revisedValue;
  };

  const saveChanges = () => {
    if (items.length === 0) return;
    persistRevision();
    setSavedRevision(true);
    addToast({ type: 'success', title: 'Revision saved', message: `${q.number} updated. Totals recalculated to ${formatINR(grandTotal)}.` });
  };

  const addRevisedToEmail = () => {
    if (items.length === 0) return;
    const revisedValue = persistRevision();
    const fileName = `${q.number.replace(/\//g, '-')}-revised.pdf`;
    const contact = (q.customerName.split(' ')[0] || 'Sir/Madam').trim();
    updateEmail(email.id, {
      composeIntent: 'revision',
      attachedQuote: {
        fileName,
        qtnNumber: q.number,
        fileType: 'PDF',
        quoteValue: revisedValue,
        signature: quoteSignature({ value: revisedValue, items }),
        addedBy: 'system',
        addedAt: ATTACH_TS,
        version: 'Revised',
        sizeLabel: `${118 + items.length * 9} KB`,
        kind: 'revised',
      },
      draft: {
        from: email.recipient,
        to: email.senderEmail,
        cc: email.cc.join(', '),
        subject: `Revised quotation ${q.number} — ${q.customerName}`,
        body:
          `Dear ${contact},\n\nThank you for your feedback on quotation ${q.number}. ` +
          `Please find attached our revised quotation reflecting the requested changes.\n\n` +
          `Revised value: ${formatINR(revisedValue)}.\n\n` +
          `Kindly review and confirm. We remain available for any clarification.\n\n` +
          `Warm regards,\n${q.owner}\nNexus RFQ — ${officeName(email.officeId)}`,
        relatedDoc: q.number,
        aiGenerated: true,
      },
    });
    setSavedRevision(true);
    addToast({ type: 'success', title: 'Added to email', message: 'Revised quotation attached. Set the next review date and send from the centre panel.' });
    onPrepared?.();
  };

  const downloadLatest = () => {
    const lines = q.items.map((it) => `${it.itemCode}  ${it.description}  ${it.quantity} ${it.unit} x ${formatINR(it.unitPrice)}`).join('\n');
    downloadText(`${q.number.replace(/\//g, '-')}-latest.txt`, `Latest quotation ${q.number}\nCustomer: ${q.customerName}\n\n${lines}\n\nGrand total: ${formatINR(q.value)}`);
    addToast({ type: 'info', title: 'Download started', message: `${q.number} (latest version).` });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Queue header */}
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone="amber" label={email.queueLabel ?? 'Quote Needs Revision'} />
          <span className="text-[11px] font-semibold text-surface-400">Revised Quote</span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-y-0.5 text-[12px]">
          <p><span className="text-surface-400">Inquiry:</span> <span className="font-semibold text-surface-800">{email.inquiryNo ?? '—'}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-700">{q.number}</span></p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={() => setShowLatest(true)}>
            View Latest Quote
          </Button>
          {canDownload && (
            <Button variant="secondary" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={downloadLatest}>
              Download
            </Button>
          )}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {alreadySent && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
            <CheckCircle2 className="h-4 w-4 flex-none" /> Revised quote sent on {email.sentAt?.slice(0, 10)} — saved as a new version.
          </div>
        )}

        {/* AI Extraction — Changes Requested */}
        <section className="mb-4">
          <div className="mb-2 flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-50 text-brand-600"><Sparkles className="h-3 w-3" /></span>
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">Requested Changes</h3>
          </div>
          <ul className="space-y-1.5">
            {changes.map((c) => (
              <ChangeRow key={c.id} change={c} />
            ))}
            {changes.length === 0 && <li className="text-[12px] text-surface-400">No specific changes were extracted.</li>}
          </ul>
        </section>

        {/* Quote Generator */}
        <section className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">Editable Quote Generator</h3>
            {changed && !alreadySent && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Unsaved edits</span>}
          </div>
          <div className="overflow-hidden rounded-xl border border-surface-200">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-[10.5px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                  <th className="px-2.5 py-2 text-left">Item</th>
                  <th className="px-1.5 py-2 text-right">Qty</th>
                  <th className="px-1.5 py-2 text-right">Unit Price</th>
                  <th className="px-2.5 py-2 text-right">Line Total</th>
                  {canEdit && !alreadySent && <th className="w-8 px-1 py-2" />}
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
                      {canEdit && !alreadySent ? (
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
                      {canEdit && !alreadySent ? (
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
                    <td className="px-2.5 py-2 text-right align-top font-medium text-surface-800">
                      {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                    </td>
                    {canEdit && !alreadySent && (
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
                    <td colSpan={5} className="px-2.5 py-4 text-center text-[12px] text-surface-400">
                      All lines removed — add at least one item before saving.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* Add item */}
            {canEdit && !alreadySent && (
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

          {/* Grand total */}
          <div className="mt-2 flex items-center justify-between rounded-lg bg-surface-50 px-3 py-2">
            <span className="text-[12px] font-medium text-surface-600">Grand Total</span>
            <div className="text-right">
              <span className="text-[15px] font-bold text-surface-900">{formatINR(grandTotal)}</span>
              {delta !== 0 && (
                <span className={classNames('ml-2 text-[11px] font-medium', delta < 0 ? 'text-emerald-600' : 'text-rose-600')}>
                  {delta < 0 ? '−' : '+'}{formatINR(Math.abs(delta))} vs latest
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Attachment status — mirrors what the centre composer will carry */}
        {attached && !alreadySent && (
          <div className={classNames('mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px]', attachStale ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
            <Paperclip className="h-4 w-4 flex-none" />
            {attachStale
              ? 'The quote changed since it was added. Use “Add Revised Quote to Email” again to refresh the attachment.'
              : 'Revised quotation added to the email — set the next review date and send from the centre panel.'}
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
              Preview
            </Button>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            leftIcon={<Paperclip className="h-4 w-4" />}
            onClick={addRevisedToEmail}
            disabled={!canEdit || items.length === 0}
            title="Attach the revised quotation to the email in the centre panel"
          >
            Add Revised Quote to Email
          </Button>
          {savedRevision && !attachStale && attached && (
            <p className="flex items-center justify-center gap-1 text-center text-[11px] font-medium text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Ready in the centre composer.
            </p>
          )}
        </div>
      )}

      {/* Preview Revised Quote */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="lg"
        title="Preview — Revised Quotation"
        subtitle={`${q.number} · ${q.customerName}`}
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
            <span className="text-[12px] font-medium text-surface-600">Revised Grand Total</span>
            <span className="text-[14px] font-bold text-surface-900">{formatINR(grandTotal)}</span>
          </div>
        </div>
      </Modal>

      {/* View Latest Quote modal */}
      <Modal
        open={showLatest}
        onClose={() => setShowLatest(false)}
        size="lg"
        title="Latest Submitted Quote"
        subtitle={`${q.number} · ${q.customerName}`}
        footer={<Button variant="primary" onClick={() => setShowLatest(false)}>Close</Button>}
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
              {q.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description}</p><p className="text-[10.5px] text-surface-400">{it.itemCode}</p></td>
                  <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                  <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                  <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <span className="text-[11px] text-surface-400">This is the previous version — it is preserved when you send the revision.</span>
          <span className="text-[13px] font-bold text-surface-900">{formatINR(q.value)}</span>
        </div>
      </Modal>
    </div>
  );
}

function ChangeRow({ change }: { change: RequestedChange }) {
  const tone = CHANGE_TONE[change.type] ?? 'text-surface-700';
  return (
    <li className="rounded-lg border border-surface-200 px-3 py-2">
      <p className="text-[11px] font-medium text-surface-500">{change.label}</p>
      <div className="mt-0.5 flex items-center gap-2 text-[12px]">
        <span className="text-surface-400 line-through">{change.oldValue}</span>
        <ArrowRight className="h-3 w-3 flex-none text-surface-300" />
        <span className={classNames('font-semibold', tone)}>{change.newValue}</span>
      </div>
    </li>
  );
}
