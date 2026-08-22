import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  FilePenLine,
  History,
  Paperclip,
} from 'lucide-react';
import type { InboxEmail, LineItem, Quotation, RequestedChange } from '@/types';
import { Button, Modal, StatusBadge } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { classNames, downloadText, formatINR, lineTotal } from '@/lib/format';
import { latestQuoteSnapshot, previousQuoteSnapshot, type QuoteSnapshot } from '@/lib/revisionQueue';
import { RevisionQuoteModal } from './RevisionQuoteModal';

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
 * RIGHT panel for a "Quote Needs Revision" conversation — a SUMMARY, not an
 * editor.
 *
 * This column used to carry the whole editable quote generator: a price table,
 * a catalogue picker and an attach action crammed into ~320px, with no room
 * for discount, tax or a single commercial term. Editing a quotation is
 * full-width work, so it moved into the Edit Quote modal. What stays here is
 * what the column is actually good at: what the customer asked for, what they
 * are currently holding, and the one button that opens the editor.
 */
export function RevisionQuotePanel({
  email,
  quotation,
  onCompose,
}: {
  email: InboxEmail;
  /** The quotation under revision, resolved from the email's revisionSendId. */
  quotation: Quotation | null;
  /** Open the compose window — used once the revised quote is attached. */
  onCompose?: () => void;
}) {
  const { addToast, can } = useApp();

  const canEdit = can('quotations', 'edit');
  const canDownload = can('quotations', 'download');

  const changes = email.requestedChanges ?? [];

  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<QuoteSnapshot | null>(null);

  if (!quotation) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-[12px] text-surface-500">The linked quotation for this revision could not be found.</p>
      </div>
    );
  }

  const latest = latestQuoteSnapshot(quotation);
  const previous = previousQuoteSnapshot(quotation);
  const alreadySent = email.sent;
  const attached = email.attachedQuote;

  const downloadQuote = (snap: QuoteSnapshot, tag: string) => {
    const lines = snap.items
      .map((it) => `${it.itemCode}  ${it.description}  ${it.quantity} ${it.unit} x ${formatINR(it.unitPrice)}`)
      .join('\n');
    downloadText(
      `${quotation.number.replace(/\//g, '-')}-${tag}.txt`,
      `Quotation ${quotation.number} (${snap.label})\nCustomer: ${quotation.customerName}\n\n${lines}\n\n` +
        `Payment: ${snap.paymentTerms}\nDelivery: ${snap.deliveryTerms}\nWarranty: ${snap.warranty}\n\n` +
        `Grand total: ${formatINR(snap.value)}`
    );
    addToast({ type: 'info', title: 'Download started', message: `${quotation.number} · ${snap.label}.` });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Queue header */}
      <div className="flex-none border-b border-surface-100 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge tone="amber" label={email.queueLabel ?? 'Quote Needs Revision'} />
          <span className="text-[11px] font-semibold text-surface-400">{latest.label} issued</span>
        </div>
        <div className="mt-1.5 grid grid-cols-1 gap-y-0.5 text-[12px]">
          <p><span className="text-surface-400">Inquiry:</span> <span className="font-semibold text-surface-800">{email.inquiryNo ?? '—'}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-700">{quotation.number}</span></p>
          <p><span className="text-surface-400">Current value:</span> <span className="font-semibold text-surface-800">{formatINR(latest.value)}</span></p>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
        {alreadySent && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" />
            Revised quote sent on {email.sentAt?.slice(0, 10)} — saved as {latest.label} and moved to Follow-up Pending.
          </div>
        )}

        {/* What the customer asked for */}
        <section className="mb-3">
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-surface-500">Requested Changes</h3>
          <ul className="space-y-1.5">
            {changes.map((c) => (
              <ChangeRow key={c.id} change={c} />
            ))}
            {changes.length === 0 && (
              <li className="text-[12px] text-surface-400">No specific changes were extracted.</li>
            )}
          </ul>
        </section>

        {/* Version history — read-only views of what was actually issued */}
        <section className="mb-3">
          <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-surface-500">Quote Versions</h3>
          <div className="space-y-1.5">
            <VersionRow
              snap={latest}
              caption="Latest issued quote"
              onView={() => setViewing(latest)}
              onDownload={canDownload ? () => downloadQuote(latest, 'latest') : undefined}
            />
            {previous ? (
              <VersionRow
                snap={previous}
                caption="Previous version"
                onView={() => setViewing(previous)}
                onDownload={canDownload ? () => downloadQuote(previous, 'previous') : undefined}
              />
            ) : (
              <p className="px-1 text-[11px] text-surface-400">
                No earlier version yet — {latest.label} is the first quote issued on this inquiry.
              </p>
            )}
          </div>
        </section>

        {/* Attachment status — what the compose window is carrying */}
        {attached && !alreadySent && (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
            <Paperclip className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              {attached.fileName} is attached to the reply.{' '}
              {onCompose && (
                <button onClick={onCompose} className="font-semibold underline underline-offset-2">
                  Open the compose window
                </button>
              )}{' '}
              to set the next review date and send.
            </span>
          </div>
        )}
      </div>

      {/* Footer — one primary way in. The quotation is edited at full width. */}
      {!alreadySent && (
        <div className="flex-none border-t border-surface-100 bg-surface-50/60 px-3.5 py-2.5">
          <Button
            variant="primary"
            size="sm"
            className="w-full"
            leftIcon={<FilePenLine className="h-4 w-4" />}
            onClick={() => setEditing(true)}
            disabled={!canEdit}
            title="Open the revised quotation editor"
          >
            Edit Quote
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-surface-400">
            Opens the full quotation with the requested changes applied.
          </p>
        </div>
      )}

      {/* Edit Quote — the full-width editor, mounted only while open so it
          seeds fresh from whatever the quotation currently holds. */}
      {editing && (
        <RevisionQuoteModal
          email={email}
          quotation={quotation}
          onAddedToEmail={() => {
            setEditing(false);
            onCompose?.();
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {/* View Latest / Previous Quote — read-only. */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        title={viewing ? `Quotation ${viewing.label}` : 'Quotation'}
        subtitle={`${quotation.number} · ${quotation.customerName}`}
        footer={<Button variant="primary" onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing && (
          <>
            <div className="overflow-hidden rounded-xl border border-surface-200">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-2 py-2 text-right">Qty</th>
                    <th className="px-2 py-2 text-right">Unit Price</th>
                    <th className="px-2 py-2 text-right">Disc %</th>
                    <th className="px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {viewing.items.map((it: LineItem) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-surface-800">{it.description}</p>
                        <p className="text-[11px] text-surface-400">{it.itemCode}</p>
                      </td>
                      <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                      <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                      <td className="px-2 py-2 text-right text-surface-700">{it.discountPct}%</td>
                      <td className="px-3 py-2 text-right font-medium text-surface-800">
                        {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-surface-200 px-3 py-2">
                <span className="text-[12px] font-medium text-surface-600">Grand Total</span>
                <span className="text-[14px] font-bold text-surface-900">{formatINR(viewing.value)}</span>
              </div>
            </div>
            <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 rounded-xl border border-surface-200 px-3 py-2.5 text-[12px] sm:grid-cols-3">
              <p><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-700">{viewing.paymentTerms}</span></p>
              <p><span className="text-surface-400">Delivery:</span> <span className="font-medium text-surface-700">{viewing.deliveryTerms}</span></p>
              <p><span className="text-surface-400">Warranty:</span> <span className="font-medium text-surface-700">{viewing.warranty}</span></p>
              {viewing.otherTerms && (
                <p className="sm:col-span-3"><span className="text-surface-400">Other terms:</span> <span className="font-medium text-surface-700">{viewing.otherTerms}</span></p>
              )}
            </div>
            <p className="mt-2 px-1 text-[11px] text-surface-400">
              Versions are immutable — revising the quote adds a new one and never overwrites this.
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}

function VersionRow({
  snap,
  caption,
  onView,
  onDownload,
}: {
  snap: QuoteSnapshot;
  caption: string;
  onView: () => void;
  onDownload?: () => void;
}) {
  return (
    <div className="rounded-lg border border-surface-200 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-800">
            <History className="h-3.5 w-3.5 flex-none text-surface-400" />
            {snap.label}
            <span className="font-normal text-surface-400">· {caption}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-surface-500">
            {formatINR(snap.value)} · {snap.items.length} {snap.items.length === 1 ? 'line' : 'lines'}
            {snap.sentAt ? ` · sent ${snap.sentAt.slice(0, 10)}` : ''}
          </p>
        </div>
        <div className="flex flex-none items-center gap-1">
          <Button variant="secondary" size="sm" leftIcon={<Eye className="h-3.5 w-3.5" />} onClick={onView}>
            View
          </Button>
          {onDownload && (
            <Button variant="ghost" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={onDownload}>
              PDF
            </Button>
          )}
        </div>
      </div>
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
