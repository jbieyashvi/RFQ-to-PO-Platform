import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Building2,
  Save,
  Eye,
  SendHorizonal,
  CheckCircle2,
  Undo2,
  Download,
  AlertTriangle,
  History,
  GitCompare,
  Paperclip,
} from 'lucide-react';
import type {
  Attachment,
  SalesOrder,
  SORevisionSnapshot,
  SORevisionVersion,
} from '@/types';
import {
  Drawer,
  Modal,
  Button,
  StatusBadge,
  TextAreaField,
  FileUpload,
  type UploadedFile,
} from '@/components/ui';
import { REVISION_STATE } from '@/lib/labels';
import { officeName } from '@/data/offices';
import { computeTotals, downloadText, formatDate, formatINR } from '@/lib/format';
import {
  cloneSnapshot,
  completionBlockers,
  diffFields,
  diffItems,
  hasAnyChange,
  originalSnapshot,
  snapshotOf,
  renderRevisedSO,
} from '@/lib/revision';

function toAttachments(files: UploadedFile[]): Attachment[] {
  return files.map((f) => ({ id: f.id, name: f.name, size: f.size, uploadedOn: '2026-08-13' }));
}

export interface RevisionSubmitPayload {
  draft: SORevisionSnapshot;
  notes: string;
  attachments: Attachment[];
  previewed: boolean;
}

export function RevisionWorkspace({
  order,
  canEdit,
  canApprove,
  onClose,
  onSaveDraft,
  onSubmit,
  onApprove,
  onReturnToDraft,
  onSend,
}: {
  order: SalesOrder | null;
  canEdit: boolean;
  canApprove: boolean;
  onClose: () => void;
  onSaveDraft: (so: SalesOrder, p: RevisionSubmitPayload) => void;
  onSubmit: (so: SalesOrder, p: RevisionSubmitPayload) => void;
  onApprove: (so: SalesOrder) => void;
  onReturnToDraft: (so: SalesOrder) => void;
  onSend: (so: SalesOrder) => void;
}) {
  const [draft, setDraft] = useState<SORevisionSnapshot | null>(null);
  const [notes, setNotes] = useState('');
  const [docs, setDocs] = useState<UploadedFile[]>([]);
  const [previewed, setPreviewed] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [compareVer, setCompareVer] = useState<SORevisionVersion | null>(null);

  useEffect(() => {
    if (!order) return;
    setDraft(cloneSnapshot(order.revisionDraft ?? originalSnapshot(order)));
    setNotes(order.revisionNotes ?? '');
    setDocs((order.revisionAttachments ?? []).map((a) => ({ id: a.id, name: a.name, size: a.size })));
    setPreviewed(!!order.revisionPreviewed);
    setShowPreview(false);
    setCompareVer(null);
  }, [order]);

  const state = order?.revisionState ?? 'revision_required';
  const editable = (state === 'revision_required' || state === 'draft_in_progress') && canEdit;

  // Baseline for the active diff = current live SO (correct across successive revisions);
  // trueOriginal = the immutable first version, used for history comparisons.
  const original = order ? snapshotOf(order) : null;
  const trueOriginal = order ? originalSnapshot(order) : null;
  const packing = order?.packingCharges ?? 0;

  const itemDiffs = useMemo(
    () => (original && draft ? diffItems(original.items, draft.items) : []),
    [original, draft]
  );
  const fieldDiffs = useMemo(
    () => (original && draft ? diffFields(original, draft, packing) : []),
    [original, draft, packing]
  );
  const changed = original && draft ? hasAnyChange(original, draft, packing) : false;

  const blockers = useMemo(() => {
    if (!original || !draft) return [];
    return completionBlockers({ original, draft, notes, previewed, packingCharges: packing });
  }, [original, draft, notes, previewed, packing]);

  if (!order || !draft || !original || !trueOriginal) return null;
  const so = order;
  const totals = computeTotals(draft.items, packing);
  const meta = REVISION_STATE[state];

  const updateItem = (id: string, patch: Partial<{ quantity: number; unitPrice: number; taxPct: number }>) => {
    setDraft((d) =>
      d ? { ...d, items: d.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) } : d
    );
  };
  const setField = (patch: Partial<SORevisionSnapshot>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const payload = (): RevisionSubmitPayload => ({ draft, notes, attachments: toAttachments(docs), previewed });

  const doPreview = () => {
    setPreviewed(true);
    setShowPreview(true);
  };

  const attemptSubmit = () => {
    if (blockers.length) return;
    onSubmit(so, payload());
  };

  const downloadVersion = (v: SORevisionVersion) => {
    downloadText(`${so.number.replace(/\//g, '-')}-${v.label.replace(/\s+/g, '')}.txt`, renderRevisedSO(so, v.snapshot, v.label));
  };
  const downloadCurrentRevised = () => {
    const label = so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : `Rev ${so.revisionNumber + 1} (draft)`;
    downloadText(`${so.number.replace(/\//g, '-')}-revised.txt`, renderRevisedSO({ ...so, revisionNotes: notes }, draft, label));
  };

  // ----- Footer actions by state + role -----
  const footer = (() => {
    if (state === 'revision_required' || state === 'draft_in_progress') {
      if (!canEdit) return <Button variant="secondary" onClick={onClose}>Close</Button>;
      return (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={() => onSaveDraft(so, payload())}>Save Draft</Button>
          <Button variant="secondary" leftIcon={<Eye className="h-4 w-4" />} onClick={doPreview}>Preview Revised SO</Button>
          <Button variant="primary" leftIcon={<SendHorizonal className="h-4 w-4" />} onClick={attemptSubmit} disabled={blockers.length > 0} title={blockers.length ? 'Resolve the blocking items first' : undefined}>
            Submit for Approval
          </Button>
        </>
      );
    }
    if (state === 'awaiting_approval') {
      return (
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" leftIcon={<Eye className="h-4 w-4" />} onClick={doPreview}>Preview Revised SO</Button>
          {canApprove ? (
            <>
              <Button variant="secondary" leftIcon={<Undo2 className="h-4 w-4" />} onClick={() => onReturnToDraft(so)}>Return to Draft</Button>
              <Button variant="primary" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onApprove(so)}>Approve Revision</Button>
            </>
          ) : (
            <span className="text-xs text-surface-500">Awaiting approval from an Office Admin or Super Admin.</span>
          )}
        </>
      );
    }
    if (state === 'revision_approved') {
      return (
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={downloadCurrentRevised}>Download Revised SO</Button>
          {canApprove ? (
            <Button variant="primary" leftIcon={<SendHorizonal className="h-4 w-4" />} onClick={() => onSend(so)}>Send Revised SO</Button>
          ) : (
            <span className="text-xs text-surface-500">Approved — an Office Admin or Super Admin can send it.</span>
          )}
        </>
      );
    }
    // revised_sent
    return (
      <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={downloadCurrentRevised}>Download Revised SO</Button>
      </>
    );
  })();

  const readOnlyText = (v: string) => <p className="whitespace-pre-line text-sm text-surface-800">{v || '—'}</p>;

  return (
    <>
      <Drawer
        open={!!order}
        onClose={onClose}
        width="xl"
        title={
          <span className="flex items-center gap-2">
            {so.number}
            <span className="rounded bg-surface-100 px-1.5 py-0.5 text-[11px] font-semibold text-surface-500">
              {so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : 'Original'}
            </span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{so.customerName}</span>
            <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {officeName(so.officeId)}</span>
            <span>PO: {so.poNumber}</span>
          </span>
        }
        headerExtra={<StatusBadge tone={meta.tone} label={meta.label} />}
        footer={footer}
      >
        <div className="space-y-6">
          {/* Requested change */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Requested revision</p>
            <p className="mt-1 text-sm font-medium text-amber-900">{so.revisionReason ?? '—'}</p>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
              <Meta label="Requested by" value={so.revisionRequestedBy ?? '—'} />
              <Meta label="Request date" value={so.revisionRequestedDate ? formatDate(so.revisionRequestedDate) : '—'} />
              <Meta label="Owner" value={so.revisionOwner ?? so.owner} />
            </div>
          </div>

          {/* Original summary */}
          <Section title="Original Sales Order">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Meta label="SO Number" value={so.number} />
              <Meta label="Current Revision" value={so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : 'Original'} />
              <Meta label="Linked PO" value={so.poNumber} />
              <Meta label="Customer" value={`${so.customerName} (${so.customerCode})`} />
              <Meta label="Sales Office" value={officeName(so.officeId)} />
              <Meta label="Current Value" value={formatINR(computeTotals(original.items, packing).grandTotal)} />
            </div>
          </Section>

          {/* Editable / read-only SO fields */}
          <Section title={editable ? 'Revise Sales Order fields' : 'Revised Sales Order fields'}>
            {/* Items */}
            <div className="overflow-x-auto rounded-xl border border-surface-200">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
                    <th className="px-3 py-2.5 text-left">Item</th>
                    <th className="px-2 py-2.5 text-right">Qty</th>
                    <th className="px-2 py-2.5 text-right">Unit Price</th>
                    <th className="px-2 py-2.5 text-right">Tax %</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {draft.items.map((it, idx) => {
                    const d = itemDiffs[idx];
                    return (
                      <tr key={it.id}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-surface-800">{it.description}</p>
                          <p className="text-xs text-surface-400">{it.itemCode} • HSN {it.hsnCode}</p>
                        </td>
                        <td className={cellClass(d?.quantity.changed)}>
                          {editable ? (
                            <input type="number" min={0} value={it.quantity} onChange={(e) => updateItem(it.id, { quantity: Number(e.target.value) })} className="input h-8 w-20 py-1 text-right text-sm" />
                          ) : (
                            <span>{it.quantity} {it.unit}</span>
                          )}
                          {d?.quantity.changed && <PrevHint value={`${d.quantity.prev}`} />}
                        </td>
                        <td className={cellClass(d?.unitPrice.changed)}>
                          {editable ? (
                            <input type="number" min={0} value={it.unitPrice} onChange={(e) => updateItem(it.id, { unitPrice: Number(e.target.value) })} className="input h-8 w-28 py-1 text-right text-sm" />
                          ) : (
                            <span>{formatINR(it.unitPrice)}</span>
                          )}
                          {d?.unitPrice.changed && <PrevHint value={formatINR(d.unitPrice.prev)} />}
                        </td>
                        <td className={cellClass(d?.taxPct.changed)}>
                          {editable ? (
                            <input type="number" min={0} value={it.taxPct} onChange={(e) => updateItem(it.id, { taxPct: Number(e.target.value) })} className="input h-8 w-16 py-1 text-right text-sm" />
                          ) : (
                            <span>{it.taxPct}%</span>
                          )}
                          {d?.taxPct.changed && <PrevHint value={`${d.taxPct.prev}%`} />}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium text-surface-800">{formatINR(computeTotals([it], 0).grandTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-right text-sm">
              <span className="text-surface-500">Revised order value: </span>
              <span className="font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
            </div>

            {/* Commercial fields */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Labeled label="Payment Terms" changed={fieldChanged(fieldDiffs, 'paymentTerms')}>
                {editable ? <textarea className="input" rows={2} value={draft.paymentTerms} onChange={(e) => setField({ paymentTerms: e.target.value })} /> : readOnlyText(draft.paymentTerms)}
              </Labeled>
              <Labeled label="Delivery Terms" changed={fieldChanged(fieldDiffs, 'deliveryTerms')}>
                {editable ? <textarea className="input" rows={2} value={draft.deliveryTerms} onChange={(e) => setField({ deliveryTerms: e.target.value })} /> : readOnlyText(draft.deliveryTerms)}
              </Labeled>
              <Labeled label="Delivery Date" changed={fieldChanged(fieldDiffs, 'deliveryDate')}>
                {editable ? <input type="date" className="input" value={draft.deliveryDate} onChange={(e) => setField({ deliveryDate: e.target.value })} /> : readOnlyText(formatDate(draft.deliveryDate))}
              </Labeled>
              <div />
              <Labeled label="Billing Address" changed={fieldChanged(fieldDiffs, 'billingAddress')}>
                {editable ? <textarea className="input" rows={2} value={draft.billingAddress} onChange={(e) => setField({ billingAddress: e.target.value })} /> : readOnlyText(draft.billingAddress)}
              </Labeled>
              <Labeled label="Shipping Address" changed={fieldChanged(fieldDiffs, 'shippingAddress')}>
                {editable ? <textarea className="input" rows={2} value={draft.shippingAddress} onChange={(e) => setField({ shippingAddress: e.target.value })} /> : readOnlyText(draft.shippingAddress)}
              </Labeled>
            </div>
          </Section>

          {/* Revision notes */}
          <Section title="Revision notes">
            {editable ? (
              <TextAreaField label="" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe the correction being made (required to submit)…" />
            ) : (
              readOnlyText(notes)
            )}
          </Section>

          {/* Supporting documents */}
          <Section title="Supporting documents">
            {editable ? (
              <FileUpload files={docs} onChange={setDocs} label="Attach revised PO / supporting document" />
            ) : docs.length ? (
              <ul className="space-y-2">
                {docs.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 text-brand-500" /> <span className="font-medium text-surface-700">{f.name}</span>
                    <span className="text-xs text-surface-400">{f.size}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-surface-400">No supporting documents attached.</p>
            )}
          </Section>

          {/* Before / After */}
          <Section
            title={
              <span className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-brand-500" /> Before / After comparison
              </span>
            }
          >
            {!changed ? (
              <p className="text-sm text-surface-400">No changes yet — edit a field above to see the comparison.</p>
            ) : (
              <BeforeAfter itemDiffs={itemDiffs} fieldDiffs={fieldDiffs} />
            )}
          </Section>

          {/* Completion validation (req 6) */}
          {editable && (
            blockers.length > 0 ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-rose-700">
                  <AlertTriangle className="h-4 w-4" /> Complete these before you can submit for approval
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-700">
                  {blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> All checks passed — ready to submit for approval.
              </div>
            )
          )}

          {/* History */}
          <Section
            title={
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 text-brand-500" /> Revision history
              </span>
            }
          >
            <ul className="space-y-2">
              {so.versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-surface-200 bg-white px-3 py-2.5">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${v.version === 0 ? 'bg-surface-100 text-surface-600' : 'bg-brand-50 text-brand-700'}`}>{v.label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-surface-700">{v.reason}</p>
                    <p className="text-xs text-surface-400">{formatDate(v.createdAt.slice(0, 10))} • by {v.by}</p>
                  </div>
                  {v.version > 0 && (
                    <Button size="sm" variant="ghost" leftIcon={<GitCompare className="h-3.5 w-3.5" />} onClick={() => setCompareVer(v)}>Compare</Button>
                  )}
                  <Button size="sm" variant="ghost" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadVersion(v)}>Download</Button>
                </li>
              ))}
            </ul>
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
          {renderRevisedSO({ ...so, revisionNotes: notes }, draft, so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : `Rev ${so.revisionNumber + 1} (draft)`)}
        </pre>
      </Modal>

      {/* Compare version modal */}
      <Modal
        open={!!compareVer}
        onClose={() => setCompareVer(null)}
        title={`Compare ${compareVer?.label ?? ''} vs Original`}
        subtitle={so.number}
        size="lg"
        footer={<Button variant="primary" onClick={() => setCompareVer(null)}>Close</Button>}
      >
        {compareVer && (
          <BeforeAfter
            itemDiffs={diffItems(trueOriginal.items, compareVer.snapshot.items)}
            fieldDiffs={diffFields(trueOriginal, compareVer.snapshot, packing)}
            emptyHint="This version matches the original."
          />
        )}
      </Modal>
    </>
  );
}

// ---------- Small presentational helpers ----------
function cellClass(changed?: boolean) {
  return `px-2 py-2.5 text-right align-top ${changed ? 'bg-amber-50' : ''}`;
}
function PrevHint({ value }: { value: string }) {
  return <p className="mt-0.5 text-[11px] text-surface-400 line-through">{value}</p>;
}
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-surface-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-surface-800">{value}</p>
    </div>
  );
}
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-surface-800">{title}</h3>
      {children}
    </section>
  );
}
function Labeled({ label, changed, children }: { label: string; changed?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="label flex items-center gap-2">
        {label}
        {changed && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Changed</span>}
      </label>
      {children}
    </div>
  );
}
function fieldChanged(diffs: { key: string; changed: boolean }[], key: string) {
  return diffs.find((d) => d.key === key)?.changed ?? false;
}

function BeforeAfter({
  itemDiffs,
  fieldDiffs,
  emptyHint,
}: {
  itemDiffs: ReturnType<typeof diffItems>;
  fieldDiffs: ReturnType<typeof diffFields>;
  emptyHint?: string;
}) {
  const changedItems = itemDiffs.filter((d) => d.changed);
  const changedFields = fieldDiffs.filter((d) => d.changed);
  if (changedItems.length === 0 && changedFields.length === 0) {
    return <p className="text-sm text-surface-400">{emptyHint ?? 'No changes.'}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-surface-200">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
            <th className="px-3 py-2.5 text-left">Field</th>
            <th className="px-3 py-2.5 text-left">Previous value</th>
            <th className="px-3 py-2.5 text-left">Revised value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {changedItems.map((d) => (
            <ItemRows key={d.id} d={d} />
          ))}
          {changedFields.map((d) => (
            <tr key={d.key}>
              <td className="px-3 py-2.5 font-medium text-surface-700">{d.label}</td>
              <td className="px-3 py-2.5 text-surface-500 line-through">{d.prev || '—'}</td>
              <td className="px-3 py-2.5 font-medium text-surface-900">{d.next || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemRows({ d }: { d: ReturnType<typeof diffItems>[number] }) {
  const rows: { label: string; prev: string; next: string }[] = [];
  if (d.quantity.changed) rows.push({ label: `${d.itemCode} — Quantity`, prev: `${d.quantity.prev} ${d.unit}`, next: `${d.quantity.next} ${d.unit}` });
  if (d.unitPrice.changed) rows.push({ label: `${d.itemCode} — Unit Price`, prev: formatINR(d.unitPrice.prev), next: formatINR(d.unitPrice.next) });
  if (d.taxPct.changed) rows.push({ label: `${d.itemCode} — Tax %`, prev: `${d.taxPct.prev}%`, next: `${d.taxPct.next}%` });
  return (
    <>
      {rows.map((r) => (
        <tr key={r.label}>
          <td className="px-3 py-2.5 font-medium text-surface-700">{r.label}</td>
          <td className="px-3 py-2.5 text-surface-500 line-through">{r.prev}</td>
          <td className="px-3 py-2.5 font-medium text-surface-900">{r.next}</td>
        </tr>
      ))}
    </>
  );
}
