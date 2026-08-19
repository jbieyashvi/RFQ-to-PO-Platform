import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Building2, Download, Eye, FileText, GitCompare, CheckCircle2, Factory } from 'lucide-react';
import type { SalesOrder, SORevisionSnapshot } from '@/types';
import { Drawer, Modal, Button, TextField, TextAreaField } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { computeTotals, downloadText, formatDate, formatDateTime, formatINR } from '@/lib/format';
import { diffFields, diffItems, originalSnapshot, renderRevisedSO, revisedVersionExists, snapshotOf } from '@/lib/revision';

const CONTACT_ERROR = 'Enter the name of the manufacturing-team contact.';

export function RevisionDetailDrawer({ order, onClose }: { order: SalesOrder | null; onClose: () => void }) {
  const { currentUser, can, updateSalesOrder, addToast } = useApp();
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactNotes, setContactNotes] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setShowPreview(false);
    setShowConfirm(false);
    setContactName('');
    setContactNotes('');
    setTouched(false);
  }, [order?.id]);

  // Original = immutable first version; Revised = the working draft when present,
  // otherwise the current live snapshot (already the applied revision for sent SOs).
  const original = useMemo<SORevisionSnapshot | null>(() => (order ? originalSnapshot(order) : null), [order]);
  const revised = useMemo<SORevisionSnapshot | null>(() => (order ? order.revisionDraft ?? snapshotOf(order) : null), [order]);
  const packing = order?.packingCharges ?? 0;

  const itemDiffs = useMemo(() => (original && revised ? diffItems(original.items, revised.items) : []), [original, revised]);
  const fieldDiffs = useMemo(() => (original && revised ? diffFields(original, revised, packing) : []), [original, revised, packing]);

  if (!order || !original || !revised) return null;
  const so = order;
  const hasChanges = itemDiffs.some((d) => d.changed) || fieldDiffs.some((d) => d.changed);
  const revisedTotals = computeTotals(revised.items, packing);
  const originalTotals = computeTotals(original.items, packing);
  const revLabel = so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : 'Rev 1 (draft)';

  const downloadOriginal = () => {
    downloadText(
      `${so.number.replace(/\//g, '-')}-original.txt`,
      [
        `SALES ORDER ${so.number} (Original)`,
        `Customer: ${so.customerName} (${so.customerCode})`,
        `Linked PO: ${so.poNumber} (${formatDate(so.poDate)})`,
        `Linked Quotation: ${so.quotationNumber ?? '—'}`,
        '',
        'Items:',
        ...original.items.map((it) => `  - ${it.itemCode} ${it.description} | ${it.quantity} ${it.unit} @ ${formatINR(it.unitPrice)} | Tax ${it.taxPct}%`),
        '',
        `Payment Terms: ${original.paymentTerms}`,
        `Delivery Terms: ${original.deliveryTerms}`,
        `Delivery Date: ${formatDate(original.deliveryDate)}`,
        `Order Value: ${formatINR(originalTotals.grandTotal)}`,
      ].join('\n')
    );
    addToast({ type: 'info', title: 'Download started', message: `${so.number} (Original)` });
  };

  const downloadRevised = () => {
    downloadText(`${so.number.replace(/\//g, '-')}-revised.txt`, renderRevisedSO(so, revised, revLabel));
    addToast({ type: 'info', title: 'Download started', message: `${so.number} (${revLabel})` });
  };

  const confirmValid = contactName.trim().length > 0;
  const confirmContact = () => {
    if (!confirmValid) {
      setTouched(true);
      return;
    }
    const confirmedAt = new Date().toISOString();
    updateSalesOrder(so.id, {
      mfgContact: { contactPerson: contactName.trim(), notes: contactNotes.trim() || undefined, confirmedBy: currentUser.fullName, confirmedAt },
      activity: [
        ...so.activity,
        {
          id: `act-${so.id}-mfg-${confirmedAt}`,
          date: confirmedAt,
          actor: currentUser.fullName,
          action: 'Manufacturing team contact confirmed',
          detail: `Contacted ${contactName.trim()}${contactNotes.trim() ? ` — ${contactNotes.trim()}` : ''}`,
        },
      ],
    });
    setShowConfirm(false);
    addToast({ type: 'success', title: 'Confirmed', message: 'Manufacturing team contact confirmed.' });
  };

  const resolved = so.mfgContact;

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>Close</Button>
      <Button variant="secondary" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setShowPreview(true)}>Preview Revised SO</Button>
      {can('sales_orders', 'download') && revisedVersionExists(so) && (
        <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={downloadRevised}>Download Revised SO</Button>
      )}
      {!resolved && can('sales_orders', 'edit') && (
        <Button variant="primary" leftIcon={<Factory className="h-4 w-4" />} onClick={() => { setTouched(false); setShowConfirm(true); }}>
          Confirm Manufacturing Contact
        </Button>
      )}
    </>
  );

  return (
    <>
      <Drawer
        open={!!order}
        onClose={onClose}
        width="xl"
        title={so.number}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{so.customerName}</span>
            <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {officeName(so.officeId)}</span>
            <span>PO: {so.poNumber}</span>
          </span>
        }
        footer={footer}
      >
        <div className="space-y-6">
          {/* Header meta */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Meta label="SO Number" value={so.number} />
            <Meta label="Customer" value={`${so.customerName} (${so.customerCode})`} />
            <Meta label="Sales Office" value={officeName(so.officeId)} />
            <Meta label="Owner" value={so.revisionOwner ?? so.owner} />
            <Meta label="Requested Date" value={so.revisionRequestedDate ? formatDate(so.revisionRequestedDate) : '—'} />
            <Meta label="Current Revision" value={so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : 'Original'} />
          </div>

          {/* Resolved manufacturing-contact confirmation */}
          {resolved && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="h-4 w-4" /> Manufacturing Contacted
              </p>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                <Meta label="Contact Person" value={resolved.contactPerson} />
                <Meta label="Confirmed By" value={resolved.confirmedBy} />
                <Meta label="Confirmed On" value={formatDateTime(resolved.confirmedAt)} />
              </div>
              {resolved.notes && (
                <div className="mt-2">
                  <p className="text-[11px] uppercase tracking-wide text-emerald-700">Notes</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-emerald-900">{resolved.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Original Sales Order */}
          <Section title="Original Sales Order" tag="Original">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Meta label="Linked PO" value={`${so.poNumber} · ${formatDate(so.poDate)}`} />
              <Meta label="Linked Quotation" value={so.quotationNumber ?? '—'} />
              <Meta label="Order Value" value={formatINR(originalTotals.grandTotal)} />
              <Meta label="Payment Terms" value={original.paymentTerms} />
              <Meta label="Delivery Terms" value={original.deliveryTerms} />
              <Meta label="Delivery Date" value={formatDate(original.deliveryDate)} />
            </div>
            <ItemsTable items={original.items} />
            <div className="mt-3">
              <Button size="sm" variant="secondary" leftIcon={<FileText className="h-3.5 w-3.5" />} onClick={downloadOriginal}>Original SO PDF</Button>
            </div>
          </Section>

          {/* Revised Sales Order */}
          <Section title="Revised Sales Order" tag="Updated">
            {!hasChanges ? (
              <p className="text-sm text-surface-400">No changes recorded for this revision yet.</p>
            ) : (
              <>
                <ItemsTable items={revised.items} diffs={itemDiffs} />
                <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <UpdatedField label="Payment Terms" value={revised.paymentTerms} changed={fieldChanged(fieldDiffs, 'paymentTerms')} />
                  <UpdatedField label="Delivery Terms" value={revised.deliveryTerms} changed={fieldChanged(fieldDiffs, 'deliveryTerms')} />
                  <UpdatedField label="Delivery Date" value={formatDate(revised.deliveryDate)} changed={fieldChanged(fieldDiffs, 'deliveryDate')} />
                </div>
                <div className="mt-3 text-right text-sm">
                  <span className="text-surface-500">Revised order value: </span>
                  <span className="font-bold text-brand-700">{formatINR(revisedTotals.grandTotal)}</span>
                </div>
                <div className="mt-4">
                  <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-surface-500">
                    <GitCompare className="h-3.5 w-3.5 text-brand-500" /> Changed values
                  </p>
                  <BeforeAfter itemDiffs={itemDiffs} fieldDiffs={fieldDiffs} />
                </div>
              </>
            )}
          </Section>
        </div>
      </Drawer>

      {/* Preview modal */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Preview — Revised Sales Order"
        subtitle={so.number}
        size="lg"
        footer={<Button variant="primary" onClick={() => setShowPreview(false)}>Close Preview</Button>}
      >
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border border-surface-200 bg-surface-50 p-4 text-xs leading-relaxed text-surface-700">
          {renderRevisedSO(so, revised, revLabel)}
        </pre>
      </Modal>

      {/* Confirm Manufacturing Contact modal */}
      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Confirm Manufacturing Contact"
        subtitle={so.number}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
            <Button variant="primary" leftIcon={<CheckCircle2 className="h-4 w-4" />} disabled={!confirmValid} onClick={confirmContact}>Confirm Resolved</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-surface-600">Confirm that the manufacturing team has been informed about the Sales Order changes.</p>
          <TextField
            label="Contact Person Name"
            required
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Enter name of person contacted"
            error={touched && !confirmValid ? CONTACT_ERROR : undefined}
          />
          <TextAreaField
            label="Notes"
            rows={3}
            value={contactNotes}
            onChange={(e) => setContactNotes(e.target.value)}
            placeholder="Add details about the revision or manufacturing-team discussion…"
          />
        </div>
      </Modal>
    </>
  );
}

// ---------- Presentational helpers ----------
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-surface-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-medium text-surface-800" title={value}>{value}</p>
    </div>
  );
}

function Section({ title, tag, children }: { title: string; tag: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-800">
        {title}
        <span className="rounded bg-surface-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surface-500">{tag}</span>
      </h3>
      {children}
    </section>
  );
}

function UpdatedField({ label, value, changed }: { label: string; value: string; changed: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${changed ? 'border-amber-200 bg-amber-50' : 'border-surface-200 bg-white'}`}>
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-surface-400">
        {label}
        {changed && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">Changed</span>}
      </p>
      <p className="mt-0.5 whitespace-pre-line text-sm text-surface-800">{value || '—'}</p>
    </div>
  );
}

function ItemsTable({ items, diffs }: { items: SORevisionSnapshot['items']; diffs?: ReturnType<typeof diffItems> }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-surface-200">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
            <th className="px-3 py-2 text-left">Item</th>
            <th className="px-2 py-2 text-right">Qty</th>
            <th className="px-2 py-2 text-right">Unit Price</th>
            <th className="px-2 py-2 text-right">Tax %</th>
            <th className="px-3 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {items.map((it, idx) => {
            const d = diffs?.[idx];
            return (
              <tr key={it.id}>
                <td className="px-3 py-2">
                  <p className="font-medium text-surface-800">{it.description}</p>
                  <p className="text-xs text-surface-400">{it.itemCode} • HSN {it.hsnCode}</p>
                </td>
                <td className={cell(d?.quantity.changed)}>
                  {it.quantity} {it.unit}
                  {d?.quantity.changed && <Prev value={`${d.quantity.prev} ${it.unit}`} />}
                </td>
                <td className={cell(d?.unitPrice.changed)}>
                  {formatINR(it.unitPrice)}
                  {d?.unitPrice.changed && <Prev value={formatINR(d.unitPrice.prev)} />}
                </td>
                <td className={cell(d?.taxPct.changed)}>
                  {it.taxPct}%
                  {d?.taxPct.changed && <Prev value={`${d.taxPct.prev}%`} />}
                </td>
                <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(computeTotals([it], 0).grandTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function cell(changed?: boolean) {
  return `px-2 py-2 text-right align-top ${changed ? 'bg-amber-50' : ''}`;
}
function Prev({ value }: { value: string }) {
  return <p className="mt-0.5 text-[11px] text-surface-400 line-through">{value}</p>;
}
function fieldChanged(diffs: { key: string; changed: boolean }[], key: string) {
  return diffs.find((d) => d.key === key)?.changed ?? false;
}

function BeforeAfter({ itemDiffs, fieldDiffs }: { itemDiffs: ReturnType<typeof diffItems>; fieldDiffs: ReturnType<typeof diffFields> }) {
  const rows: { label: string; prev: string; next: string }[] = [];
  itemDiffs.filter((d) => d.changed).forEach((d) => {
    if (d.quantity.changed) rows.push({ label: `${d.itemCode} — Quantity`, prev: `${d.quantity.prev} ${d.unit}`, next: `${d.quantity.next} ${d.unit}` });
    if (d.unitPrice.changed) rows.push({ label: `${d.itemCode} — Unit Price`, prev: formatINR(d.unitPrice.prev), next: formatINR(d.unitPrice.next) });
    if (d.taxPct.changed) rows.push({ label: `${d.itemCode} — Tax %`, prev: `${d.taxPct.prev}%`, next: `${d.taxPct.next}%` });
  });
  fieldDiffs.filter((d) => d.changed).forEach((d) => rows.push({ label: d.label, prev: d.prev || '—', next: d.next || '—' }));
  if (!rows.length) return <p className="text-sm text-surface-400">No changed values.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-surface-200">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
            <th className="px-3 py-2 text-left">Field</th>
            <th className="px-3 py-2 text-left">Original</th>
            <th className="px-3 py-2 text-left">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="px-3 py-2 font-medium text-surface-700">{r.label}</td>
              <td className="px-3 py-2 text-surface-500 line-through">{r.prev}</td>
              <td className="px-3 py-2 font-medium text-surface-900">{r.next}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
