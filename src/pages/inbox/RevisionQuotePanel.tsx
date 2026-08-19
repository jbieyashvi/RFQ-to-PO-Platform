import { useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Sparkles,
  Eye,
  Send,
  Plus,
  Trash2,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Download,
  RotateCcw,
  Ban,
} from 'lucide-react';
import type { InboxEmail, LineItem, QuoteVersion, RequestedChange } from '@/types';
import { Button, Modal, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ITEMS } from '@/data/masters';
import { classNames, compactINR, computeTotals, downloadText, formatINR, lineTotal } from '@/lib/format';
import { buildVersions, fmtDate, grandTotalOf } from '@/lib/revisionQueue';

const SENT_TS = '2026-08-13T12:45:00';
const REVIEW_DATE_REQUIRED = 'Select the next review date before completing this action.';

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

export function RevisionQuotePanel({ email }: { email: InboxEmail }) {
  const { quotations, updateQuotation, updateEmail, addToast, currentUser, can, canInbox } = useApp();

  const q = quotations.find((x) => x.id === email.revisionSendId) ?? null;

  const canEdit = can('quotations', 'edit');
  const canReview = can('quotations', 'edit');
  const canSend = canInbox('send');
  const canDownload = can('quotations', 'download');

  const changes = email.requestedChanges ?? [];

  // Editable working copy of the revised quote — baseline latest quote with the
  // AI-proposed values applied; the user can still correct every value.
  const [items, setItems] = useState<LineItem[]>([]);
  const [reviewDate, setReviewDate] = useState('');
  const [note, setNote] = useState('');
  const [addId, setAddId] = useState('');
  const [showLatest, setShowLatest] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!q) return;
    const proposed = q.items.map((it) => {
      const patch = changes.find((c) => c.itemId === it.id && c.field && typeof c.itemProposed === 'number');
      return patch ? { ...it, [patch.field as 'unitPrice' | 'quantity']: patch.itemProposed as number } : { ...it };
    });
    setItems(proposed);
    setReviewDate(email.reviewDate ?? q.reviewDate ?? '');
    setNote('');
    setAddId('');
    setShowLatest(false);
    setConfirmOpen(false);
    setSendError(null);
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
  const versionLabel = `V${(q.quoteVersions?.length ?? 1) + (alreadySent ? 0 : 1)}`;

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

  const saveReviewDate = () => {
    updateQuotation(q.id, { reviewDate });
    updateEmail(email.id, { reviewDate });
    addToast({ type: 'success', title: 'Review date updated', message: `Next review set to ${reviewDate ? fmtDate(reviewDate) : '—'}.` });
  };

  const downloadLatest = () => {
    const lines = q.items.map((it) => `${it.itemCode}  ${it.description}  ${it.quantity} ${it.unit} x ${formatINR(it.unitPrice)}`).join('\n');
    downloadText(`${q.number.replace(/\//g, '-')}-latest.txt`, `Latest quotation ${q.number}\nCustomer: ${q.customerName}\n\n${lines}\n\nGrand total: ${formatINR(q.value)}`);
    addToast({ type: 'info', title: 'Download started', message: `${q.number} (latest version).` });
  };

  const sendRevised = () => {
    // Follow-up workflow email: the next review date is mandatory before the
    // send can complete. Exact validation copy is required by the workflow spec.
    if (!reviewDate) {
      setSendError(REVIEW_DATE_REQUIRED);
      setConfirmOpen(false);
      return;
    }
    try {
      const revisedValue = grandTotalOf(items, packing);
      const { existing } = buildVersions(q, currentUser.fullName);
      const nextVersion = existing.length + 1;
      const newVersion: QuoteVersion = {
        id: `qv-${q.id}-${nextVersion}`,
        label: `V${nextVersion}`,
        version: nextVersion,
        createdAt: SENT_TS,
        by: currentUser.fullName,
        value: revisedValue,
        items: items.map(clone),
        note: note.trim() || 'Revised quotation sent to customer',
        sent: true,
        sentAt: SENT_TS,
      };

      updateQuotation(q.id, {
        quoteVersions: [...existing, newVersion],
        items: items.map(clone),
        value: revisedValue,
        workState: 'sent',
        deliveryState: 'sent',
        sentAt: SENT_TS,
        sentBy: currentUser.fullName,
        sendChannel: 'Email (via Global Inbox)',
        reviewDate,
        lastUpdated: '2026-08-13',
        revisions: [
          ...q.revisions,
          { id: `rev-${q.id}-${nextVersion}`, version: nextVersion, date: '2026-08-13', reason: 'Revised quotation sent to customer', by: currentUser.fullName },
        ],
        activity: [
          ...q.activity,
          { id: `act-${q.id}-send-${nextVersion}`, date: SENT_TS, actor: currentUser.fullName, action: 'Revised quotation sent to customer', detail: `${email.inquiryNo ?? q.number} · ${compactINR(revisedValue)}` },
        ],
      });
      updateEmail(email.id, {
        sent: true,
        sentAt: SENT_TS,
        needsReview: false,
        reviewDate,
        draftSaved: true,
      });
      setConfirmOpen(false);
      setSendError(null);
      addToast({ type: 'success', title: 'Revised quote sent', message: `${email.inquiryNo ?? q.number} sent to ${q.customerName}. Saved as ${newVersion.label}.` });
    } catch {
      setConfirmOpen(false);
      setSendError('Send failed — the record stays in Quotes Needing Revision. Retry when ready.');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Queue header */}
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone="amber" label={email.queueLabel ?? 'Quote Needs Revision'} />
          <span className="text-[11px] font-semibold text-surface-400">{versionLabel}</span>
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
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">AI Extraction — Changes Requested</h3>
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
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">Quote Generator</h3>
            {changed && !alreadySent && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Edited</span>}
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
                      All lines removed — add at least one item before sending.
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

        {/* Manual review date */}
        <section className="mb-3">
          <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-surface-500">
            <CalendarClock className="h-3.5 w-3.5" /> Next Review Date
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={reviewDate}
              onChange={(e) => setReviewDate(e.target.value)}
              disabled={!canReview || alreadySent}
              className="input h-8 flex-1 px-2.5 py-0 text-[12px]"
              aria-label="Next review date"
            />
            {canReview && !alreadySent && (
              <Button variant="secondary" size="sm" onClick={saveReviewDate}>Save</Button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-surface-400">Manually set — never auto-overwritten. Saving updates the linked quotation record.</p>
        </section>

        {/* Cover note */}
        {!alreadySent && (
          <section>
            <label className="mb-1 block text-[11px] font-medium text-surface-500">Cover note to customer (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              disabled={!canEdit}
              placeholder="Add a short note to accompany the revised quote…"
              className="input w-full px-2.5 py-1.5 text-[12px]"
            />
          </section>
        )}

        {sendError && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-rose-700"><AlertTriangle className="h-3.5 w-3.5" /> {sendError}</p>
            <Button variant="secondary" size="sm" className="mt-2" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setSendError(null); setConfirmOpen(true); }}>
              Retry send
            </Button>
          </div>
        )}
      </div>

      {/* Footer — Send Revised Quote */}
      {!alreadySent && (
        <div className="flex-none border-t border-surface-100 bg-surface-50/60 px-4 py-3">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            leftIcon={canSend && items.length > 0 ? <Send className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
            onClick={() => setConfirmOpen(true)}
            disabled={!canSend || items.length === 0}
            title={!canSend ? 'You do not have permission to send' : items.length === 0 ? 'Add at least one item' : 'Review and send the revised quote'}
          >
            Send Revised Quote
          </Button>
          {!canSend && (
            <p className="mt-1.5 text-center text-[11px] font-medium text-rose-600">Send permission required.</p>
          )}
        </div>
      )}

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

      {/* Confirm / preview before send */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        size="lg"
        title="Send Revised Quote"
        subtitle={`${email.inquiryNo ?? q.number} · ${q.customerName}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Back to Edit</Button>
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={sendRevised} disabled={items.length === 0 || !reviewDate}>
              Confirm &amp; Send
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
            <RefreshCw className="h-4 w-4 flex-none" /> The revised quote is saved as a new quotation version. The previous version is preserved.
          </div>
          {!reviewDate && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800">
              <CalendarClock className="h-4 w-4 flex-none" /> {REVIEW_DATE_REQUIRED}
            </div>
          )}
          <div className="rounded-xl border border-surface-200">
            <ul className="divide-y divide-surface-100">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
                  <span className="min-w-0 truncate text-surface-700">{it.description} <span className="text-surface-400">× {it.quantity}</span></span>
                  <span className="flex-none font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
              <span className="text-[12px] font-medium text-surface-600">Grand Total</span>
              <span className="text-[14px] font-bold text-surface-900">{formatINR(grandTotal)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-surface-200 px-3 py-2 text-[12px] text-surface-600">
            <FileText className="h-3.5 w-3.5 flex-none text-brand-500" />
            <span>To: <span className="font-medium text-surface-800">{q.customerName}</span> · Next review {reviewDate ? fmtDate(reviewDate) : '—'}</span>
          </div>
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
