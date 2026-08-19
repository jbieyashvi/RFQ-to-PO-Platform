import { useState } from 'react';
import {
  FileText,
  Eye,
  Paperclip,
  CheckCircle2,
  X,
  AlertTriangle,
  ClipboardList,
} from 'lucide-react';
import type { InboxEmail, Quotation } from '@/types';
import { Button, Modal, StatusBadge } from '@/components/ui';
import { QuotationDetailsDrawer } from '@/components/QuotationDetails';
import { useApp } from '@/context/AppContext';
import { QUOTATION_DELIVERY } from '@/lib/labels';
import { computeTotals, formatINR, lineTotal } from '@/lib/format';
import { quoteSignature } from './helpers';

const ATTACH_TS = '2026-08-13T12:40:00';

/**
 * The RIGHT panel in quote-send mode. Deliberately narrow in scope: it exposes
 * ONLY the three quote tools the PM confirmed —
 *   1. Quote   — open the editable quotation / quote builder (scoped to this customer)
 *   2. Preview — read-only "exactly as sent" formatted quotation
 *   3. Add as Attachment in Email — attach the system-generated PDF to the composer
 * No reassign, no generic business action, no second composer, no manual uploads.
 */
export function QuoteToolsPanel({ email, quotation }: { email: InboxEmail; quotation: Quotation }) {
  const { updateEmail, addToast, canInbox } = useApp();
  const [showQuote, setShowQuote] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const canDraft = canInbox('draft_reply');
  const totals = computeTotals(quotation.items, quotation.packingCharges);
  const fileName = `${quotation.number.replace(/\//g, '-')}.pdf`;

  const currentSig = quoteSignature(quotation);
  const attached = email.attachedQuote;
  const isAttached = !!attached;
  const isStale = !!(attached && attached.signature !== currentSig);

  const addAttachment = () => {
    if (email.sent) return;
    updateEmail(email.id, {
      attachedQuote: {
        fileName,
        qtnNumber: quotation.number,
        fileType: 'PDF',
        quoteValue: quotation.value,
        signature: currentSig,
        addedBy: 'system',
        addedAt: ATTACH_TS,
      },
    });
    addToast({
      type: 'success',
      title: isStale ? 'Latest quotation attached' : 'Quotation attached',
      message: `${fileName} added to the email.`,
    });
  };

  const removeAttachment = () => {
    updateEmail(email.id, { attachedQuote: undefined });
    addToast({ type: 'info', title: 'Attachment removed', message: 'The quotation PDF was removed from the email.' });
  };

  // Button 3 state: fresh attach vs. already-added (duplicate-proof) vs. stale re-attach.
  const attachDisabled = email.sent || !canDraft || (isAttached && !isStale);
  const attachLabel = isStale ? 'Add Latest Version' : isAttached ? 'Added to Email' : 'Add as Attachment in Email';

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
          <ClipboardList className="h-3.5 w-3.5" /> Quote Tools
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {/* Quotation summary card */}
        <div className="rounded-xl border border-surface-200 bg-surface-50/60 px-3.5 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-surface-900">{quotation.number}</p>
              <p className="truncate text-[12px] text-surface-500">
                {quotation.customerName}
                {quotation.customerCode ? ` · ${quotation.customerCode}` : ''}
              </p>
            </div>
            <StatusBadge
              tone={QUOTATION_DELIVERY[quotation.deliveryState].tone}
              label={QUOTATION_DELIVERY[quotation.deliveryState].label}
              dot={false}
              className="!text-[10px]"
            />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-surface-200 pt-2 text-[12px]">
            <span className="text-surface-500">{quotation.items.length} line item{quotation.items.length === 1 ? '' : 's'}</span>
            <span className="font-semibold text-surface-900">{formatINR(totals.grandTotal)}</span>
          </div>
        </div>

        {/* The three (and only three) quote actions */}
        <div className="mt-4 space-y-2">
          <Button variant="secondary" size="sm" className="w-full justify-start" leftIcon={<FileText className="h-4 w-4" />} onClick={() => setShowQuote(true)}>
            Quote
          </Button>
          <Button variant="secondary" size="sm" className="w-full justify-start" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setShowPreview(true)}>
            Preview
          </Button>
          <Button
            variant={isAttached && !isStale ? 'secondary' : 'primary'}
            size="sm"
            className="w-full justify-start"
            leftIcon={isAttached && !isStale ? <CheckCircle2 className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
            onClick={addAttachment}
            disabled={attachDisabled}
            title={isAttached && !isStale ? 'The latest quotation is already attached' : 'Attach the system-generated quotation PDF'}
          >
            {attachLabel}
          </Button>
        </div>

        {/* Attachment status chip */}
        {isAttached && (
          <div className="mt-3">
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
              <FileText className="h-4 w-4 flex-none text-brand-600" />
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-surface-800">{attached!.fileName}</p>
                <p className="truncate text-[11px] text-surface-500">{attached!.qtnNumber} · {attached!.fileType}</p>
              </div>
              {!email.sent && (
                <button onClick={removeAttachment} className="ml-auto flex-none rounded p-1 text-surface-400 transition-colors hover:bg-white hover:text-rose-600" title="Remove attachment">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {isStale && !email.sent && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                The quotation has changed. Add the latest version before sending.
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-surface-400">
          Only the system-generated quotation PDF can be attached. The email is written and sent from the centre panel.
        </p>
      </div>

      {/* Quote action → editable quotation drawer, scoped to this quotation.
          onEdit is intentionally omitted (the drawer stays inline in the inbox). */}
      {showQuote && <QuotationDetailsDrawer quotation={quotation} onClose={() => setShowQuote(false)} initialTab="items" />}

      {/* Preview action → read-only "exactly as sent" formatted quotation.
          Preview never sends or attaches anything. */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        size="xl"
        title="Quotation Preview"
        subtitle="Formatted quotation exactly as it will be sent to the customer."
        footer={<Button variant="secondary" onClick={() => setShowPreview(false)}>Close Preview</Button>}
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-surface-200 px-4 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-surface-400">Quotation No.</p>
              <p className="text-[15px] font-semibold text-surface-900">{quotation.number}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-surface-400">Customer</p>
              <p className="text-[14px] font-medium text-surface-800">{quotation.customerName}</p>
              {quotation.customerCode && <p className="text-[12px] text-surface-500">{quotation.customerCode}</p>}
            </div>
          </div>

          {/* Items & pricing */}
          <div className="overflow-hidden rounded-xl border border-surface-200">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-50 text-surface-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Disc%</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {quotation.items.map((it) => (
                  <tr key={it.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-surface-800">{it.itemCode}</p>
                      <p className="text-[11px] text-surface-500">{it.description}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                    <td className="px-3 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                    <td className="px-3 py-2 text-right text-surface-700">{it.discountPct}%</td>
                    <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="ml-auto w-full max-w-xs space-y-1 text-[13px] sm:w-64">
            <div className="flex justify-between text-surface-600"><span>Taxable value</span><span>{formatINR(totals.taxable)}</span></div>
            <div className="flex justify-between text-surface-600"><span>Tax</span><span>{formatINR(totals.tax)}</span></div>
            {totals.packingCharges > 0 && <div className="flex justify-between text-surface-600"><span>Packing</span><span>{formatINR(totals.packingCharges)}</span></div>}
            <div className="flex justify-between border-t border-surface-200 pt-1 text-[15px] font-semibold text-surface-900"><span>Total</span><span>{formatINR(totals.grandTotal)}</span></div>
          </div>

          {/* Commercial terms */}
          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-xl border border-surface-200 px-4 py-3 text-[12px] sm:grid-cols-2">
            <p><span className="text-surface-400">Payment terms:</span> <span className="text-surface-700">{quotation.paymentTerms}</span></p>
            <p><span className="text-surface-400">Delivery terms:</span> <span className="text-surface-700">{quotation.deliveryTerms}</span></p>
            <p><span className="text-surface-400">Warranty:</span> <span className="text-surface-700">{quotation.warranty}</span></p>
            <p><span className="text-surface-400">Quote date:</span> <span className="text-surface-700">{quotation.quoteDate}</span></p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
