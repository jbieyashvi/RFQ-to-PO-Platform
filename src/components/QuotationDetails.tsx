import { useEffect, useState } from 'react';
import { Download, Building2, Eye } from 'lucide-react';
import type { LineItem, Quotation, QuotationStage, QuotationStatus } from '@/types';
import {
  Drawer,
  Modal,
  Button,
  IconButton,
  StatusBadge,
  Tabs,
  DescList,
  ActivityTimeline,
  SelectField,
  TextField,
  InfoRow,
  ConfirmDialog,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { QUOTATION_STAGE, QUOTATION_STATUS, QUOTATION_DELIVERY } from '@/lib/labels';
import { officeName } from '@/data/offices';
import {
  computeTotals,
  formatDate,
  formatDateTime,
  formatINR,
  lineTotal,
  downloadText,
} from '@/lib/format';
import { latestQuoteSubmittedAt, firstInquiryAt } from '@/lib/quotationDates';
import { TODAY_ISO, buildWorkflowPatch, reviewDateError } from '@/lib/quotationWorkflow';

// A saved quotation version, as far as History can show it. `content` is the
// stored quote body — null when the prototype never captured a snapshot for
// that version (older seeded revisions), in which case History shows the
// recorded metadata instead of inventing line items.
interface VersionContent {
  items: LineItem[];
  paymentTerms: string;
  deliveryTerms: string;
  warranty: string;
  packingCharges: number;
}
interface VersionEntry {
  id: string;
  version: number;
  label: string;
  reason: string;
  date: string;
  by: string;
  content: VersionContent | null;
}

function buildVersionEntries(q: Quotation): VersionEntry[] {
  const latest = q.revisions.reduce((max, r) => Math.max(max, r.version), 0);
  return q.revisions.map((r) => {
    const stored = q.quoteVersions?.find((v) => v.version === r.version);
    const content: VersionContent | null = stored
      ? {
          items: stored.items,
          paymentTerms: stored.paymentTerms ?? q.paymentTerms,
          deliveryTerms: stored.deliveryTerms ?? q.deliveryTerms,
          warranty: stored.warranty ?? q.warranty,
          packingCharges: stored.packingCharges ?? q.packingCharges,
        }
      : r.version === latest
        ? {
            items: q.items,
            paymentTerms: q.paymentTerms,
            deliveryTerms: q.deliveryTerms,
            warranty: q.warranty,
            packingCharges: q.packingCharges,
          }
        : null;
    return {
      id: r.id,
      version: r.version,
      label: stored?.label ?? `V${r.version}`,
      reason: r.reason,
      date: r.date,
      by: r.by,
      content,
    };
  });
}

/** Review date must be a NEW date whenever anything in the workflow changes. */
const REVIEW_DATE_MUST_BE_NEW = 'Set a new review date for this change.';

export function QuotationDetailsDrawer({
  quotation,
  onClose,
  initialTab = 'overview',
}: {
  quotation: Quotation | null;
  onClose: () => void;
  initialTab?: string;
}) {
  const { updateQuotation, can, addToast, currentUser } = useApp();
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState<QuotationStatus>('open');
  const [stage, setStage] = useState<QuotationStage>('no_followup');
  const [reviewDate, setReviewDate] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<'close' | 'cancel' | null>(null);
  const [viewVersion, setViewVersion] = useState<VersionEntry | null>(null);

  useEffect(() => {
    if (quotation) {
      setTab(initialTab);
      setStatus(quotation.status);
      setStage(quotation.stage);
      setReviewDate(quotation.reviewDate);
      setEditing(false);
      setConfirmDiscard(null);
      setViewVersion(null);
    }
  }, [quotation, initialTab]);

  if (!quotation) return null;
  const q = quotation;
  const totals = computeTotals(q.items, q.packingCharges);
  const canEdit = can('quotations', 'edit');
  const submitted = latestQuoteSubmittedAt(q);
  const dirty = status !== q.status || stage !== q.stage || reviewDate !== q.reviewDate;

  // Workflow rules, applied only once the drawer is in edit mode:
  //  • blank or past review dates are rejected (shared list/inline validation);
  //  • every change also needs a NEW review date, not the one already on file.
  const reviewErr = reviewDateError(reviewDate);
  const staleReviewDate = dirty && reviewDate === q.reviewDate;
  const reviewError = editing ? reviewErr ?? (staleReviewDate ? REVIEW_DATE_MUST_BE_NEW : '') : '';
  const saveDisabled = !editing || !dirty || !canEdit || !!reviewError;

  const resetFields = () => {
    setStatus(q.status);
    setStage(q.stage);
    setReviewDate(q.reviewDate);
  };

  const requestClose = () => {
    if (dirty) setConfirmDiscard('close');
    else onClose();
  };

  const cancelEdit = () => {
    if (dirty) setConfirmDiscard('cancel');
    else setEditing(false);
  };

  const saveWorkflow = () => {
    if (saveDisabled) return;
    updateQuotation(q.id, buildWorkflowPatch(q, { status, stage, reviewDate }, currentUser.fullName));
    addToast({ type: 'success', title: 'Quotation workflow updated.' });
    setEditing(false);
  };

  const versions = buildVersionEntries(q);

  const downloadVersion = (v: VersionEntry) => {
    const header =
      `QUOTATION ${q.number} — ${v.label}\nCustomer: ${q.customerName} (${q.customerCode})\n` +
      `Revision: ${v.reason}\nDated ${formatDate(v.date)} • by ${v.by}\n`;
    const body = v.content
      ? `\nItems:\n${v.content.items
          .map(
            (it) =>
              `- ${it.itemCode} ${it.description} x${it.quantity} ${it.unit} @ ${formatINR(it.unitPrice)} = ${formatINR(
                lineTotal(it.quantity, it.unitPrice, it.discountPct)
              )}`
          )
          .join('\n')}\n\nPayment: ${v.content.paymentTerms}\nDelivery: ${v.content.deliveryTerms}\n` +
        `Warranty: ${v.content.warranty}\n\nGrand total: ${formatINR(computeTotals(v.content.items, v.content.packingCharges).grandTotal)}`
      : `\nNo quote snapshot was stored for this version — only the revision record above is on file.`;
    downloadText(`${q.number.replace(/\//g, '-')}-${v.label}.txt`, header + body, 'text/plain');
    addToast({ type: 'success', title: 'Download started', message: `${q.number} · ${v.label}.` });
  };

  const downloadPdf = () => {
    downloadText(
      `${q.number.replace(/\//g, '-')}.txt`,
      `QUOTATION ${q.number}\nCustomer: ${q.customerName} (${q.customerCode})\nSales Office: ${officeName(q.officeId)}\nOwner: ${q.owner}\nValue: ${formatINR(q.value)}\n\nItems:\n${q.items
        .map((it) => `- ${it.itemCode} ${it.description} x${it.quantity} @ ${formatINR(it.unitPrice)}`)
        .join('\n')}`,
      'text/plain'
    );
    addToast({ type: 'success', title: 'Download started', message: `${q.number} exported.` });
  };

  return (
    <>
    <Drawer
      open={!!quotation}
      onClose={requestClose}
      width="xl"
      title={q.number}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{q.customerName}</span>
          <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {officeName(q.officeId)}</span>
        </span>
      }
      headerExtra={
        <div className="hidden items-center gap-2 sm:flex">
          <StatusBadge tone={QUOTATION_STATUS[q.status].tone} label={QUOTATION_STATUS[q.status].label} />
          <StatusBadge tone={QUOTATION_STAGE[q.stage].tone} label={QUOTATION_STAGE[q.stage].label} />
        </div>
      }
      footer={
        <>
          <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={downloadPdf}>
            Download
          </Button>
          {canEdit &&
            (editing ? (
              <Button variant="secondary" onClick={cancelEdit}>
                Cancel
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit Workflow
              </Button>
            ))}
          <Button variant="primary" onClick={saveWorkflow} disabled={saveDisabled}>
            Save Changes
          </Button>
        </>
      }
    >
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'items', label: 'Items & Pricing', count: q.items.length },
          { key: 'terms', label: 'Commercial Terms' },
          { key: 'history', label: 'History', count: q.revisions.length },
          { key: 'activity', label: 'Activity' },
        ]}
      />

      <div className="pt-5">
        {tab === 'overview' && (
          <div className="space-y-5">
            {/* Workflow editors */}
            <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
              <h4 className="mb-3 text-sm font-semibold text-surface-800">Workflow Controls</h4>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <SelectField
                  label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as QuotationStatus)}
                  disabled={!canEdit || !editing}
                  options={Object.entries(QUOTATION_STATUS).map(([k, v]) => ({ value: k, label: v.label }))}
                />
                <SelectField
                  label="Stage"
                  value={stage}
                  onChange={(e) => setStage(e.target.value as QuotationStage)}
                  disabled={!canEdit || !editing}
                  options={Object.entries(QUOTATION_STAGE).map(([k, v]) => ({ value: k, label: v.label }))}
                />
                <TextField
                  label="Review Date"
                  type="date"
                  min={TODAY_ISO}
                  required={editing}
                  error={reviewError || undefined}
                  value={reviewDate}
                  disabled={!canEdit || !editing}
                  onChange={(e) => setReviewDate(e.target.value)}
                />
              </div>
              {canEdit && !editing && (
                <p className="mt-2 text-xs text-surface-500">
                  Status, Stage and Review Date are read-only — click Edit Workflow to change them.
                </p>
              )}
              {editing && !reviewError && (
                <p className="mt-2 text-xs text-brand-600">
                  {dirty
                    ? 'Review date is saved together with this change.'
                    : 'Every change needs a new review date — today or later.'}
                </p>
              )}
              {!canEdit && (
                <p className="mt-2 text-xs text-amber-600">
                  Your role does not have edit permission for quotations.
                </p>
              )}
            </div>

            <DescList
              items={[
                { label: 'Customer', value: `${q.customerName}` },
                { label: 'Customer Code', value: q.customerCode },
                { label: 'Sales Office', value: officeName(q.officeId) },
                { label: 'Owner', value: q.owner },
                { label: 'First Inquiry Date', value: formatDateTime(firstInquiryAt(q)) },
                { label: 'Latest Quote Sent', value: submitted ? formatDateTime(submitted) : '—' },
                { label: 'Last Updated', value: formatDate(q.lastUpdated) },
              ]}
            />

            {/* Delivery / send state — separate from business Status & Stage */}
            <div className="rounded-xl border border-surface-200 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-surface-800">Send / Delivery</h4>
                <StatusBadge tone={QUOTATION_DELIVERY[q.deliveryState].tone} label={QUOTATION_DELIVERY[q.deliveryState].label} />
              </div>
              {q.deliveryState === 'send_failed' && q.sendFailureReason && (
                <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
                  Failure: {q.sendFailureReason}
                </p>
              )}
              <DescList
                items={[
                  { label: 'Sent At', value: q.sentAt ? formatDateTime(q.sentAt) : '—' },
                  { label: 'Sent By', value: q.sentBy ?? '—' },
                  {
                    label: 'Channel',
                    value: q.sendChannel ?? (q.sentAt || q.deliveryState === 'sent' || q.deliveryState === 'sent_externally' ? 'Email' : '—'),
                  },
                  { label: 'Note', value: q.sendNote ?? '—' },
                ]}
              />
            </div>
          </div>
        )}

        {tab === 'items' && (
          <div>
            <div className="overflow-x-auto rounded-xl border border-surface-200">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
                    <th className="px-3 py-2.5 text-left">Item</th>
                    <th className="px-2 py-2.5 text-right">Qty</th>
                    <th className="px-2 py-2.5 text-right">Rate</th>
                    <th className="px-2 py-2.5 text-right">Disc%</th>
                    <th className="px-2 py-2.5 text-right">Tax%</th>
                    <th className="px-3 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {q.items.map((it) => (
                    <tr key={it.id}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-surface-800">{it.description}</p>
                        <p className="text-xs text-surface-400">{it.itemCode} • HSN {it.hsnCode}</p>
                      </td>
                      <td className="px-2 py-2.5 text-right">{it.quantity} {it.unit}</td>
                      <td className="px-2 py-2.5 text-right">{formatINR(it.unitPrice)}</td>
                      <td className="px-2 py-2.5 text-right">{it.discountPct}%</td>
                      <td className="px-2 py-2.5 text-right">{it.taxPct}%</td>
                      <td className="px-3 py-2.5 text-right font-medium text-surface-800">
                        {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 ml-auto max-w-xs space-y-1">
              <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
              <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
              <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
              <InfoRow label="GST" value={formatINR(totals.tax)} />
              {q.packingCharges > 0 && <InfoRow label="Packing & Forwarding" value={formatINR(q.packingCharges)} />}
              <div className="mt-1 border-t border-surface-200 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-surface-800">Grand Total</span>
                  <span className="text-base font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'terms' && (
          <DescList
            items={[
              { label: 'Payment Terms', value: q.paymentTerms },
              { label: 'Delivery Terms', value: q.deliveryTerms },
              { label: 'Warranty', value: q.warranty },
              { label: 'Packing Charges', value: q.packingCharges > 0 ? formatINR(q.packingCharges) : 'Included' },
            ]}
          />
        )}

        {tab === 'history' && (
          <div className="space-y-3">
            {q.revisionReason && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <span className="font-semibold">Revision requested:</span> {q.revisionReason}
              </div>
            )}
            <ul className="space-y-2">
              {versions.map((v) => (
                <li key={v.id} className="flex items-start gap-3 rounded-lg border border-surface-200 p-3">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-600">
                    v{v.version}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-surface-800">{v.reason}</p>
                    <p className="text-xs text-surface-400">{formatDate(v.date)} • by {v.by}</p>
                  </div>
                  <div className="flex flex-none items-center gap-1.5">
                    <IconButton
                      label={`View ${v.label}`}
                      icon={<Eye className="h-3.5 w-3.5" />}
                      onClick={() => setViewVersion(v)}
                    />
                    <IconButton
                      label={`Download ${v.label}`}
                      variant="ghost"
                      icon={<Download className="h-3.5 w-3.5" />}
                      onClick={() => downloadVersion(v)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'activity' && <ActivityTimeline events={q.activity} />}
      </div>
    </Drawer>

    <Modal
      open={!!viewVersion}
      onClose={() => setViewVersion(null)}
      size="lg"
      title={viewVersion ? `Quotation ${viewVersion.label}` : ''}
      subtitle={`${q.number} · ${q.customerName}`}
      footer={
        <>
          {viewVersion && (
            <Button
              variant="secondary"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={() => downloadVersion(viewVersion)}
            >
              Download
            </Button>
          )}
          <Button variant="primary" onClick={() => setViewVersion(null)}>
            Close
          </Button>
        </>
      }
    >
      {viewVersion && (
        <div className="space-y-4">
          <DescList
            items={[
              { label: 'Version', value: viewVersion.label },
              { label: 'Dated', value: formatDate(viewVersion.date) },
              { label: 'By', value: viewVersion.by },
              { label: 'Reason', value: viewVersion.reason },
            ]}
          />
          {viewVersion.content ? (
            <>
              <div className="overflow-x-auto rounded-xl border border-surface-200">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
                      <th className="px-3 py-2.5 text-left">Item</th>
                      <th className="px-2 py-2.5 text-right">Qty</th>
                      <th className="px-2 py-2.5 text-right">Rate</th>
                      <th className="px-2 py-2.5 text-right">Disc%</th>
                      <th className="px-3 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-100">
                    {viewVersion.content.items.map((it) => (
                      <tr key={it.id}>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-surface-800">{it.description}</p>
                          <p className="text-xs text-surface-400">{it.itemCode}</p>
                        </td>
                        <td className="px-2 py-2.5 text-right">{it.quantity} {it.unit}</td>
                        <td className="px-2 py-2.5 text-right">{formatINR(it.unitPrice)}</td>
                        <td className="px-2 py-2.5 text-right">{it.discountPct}%</td>
                        <td className="px-3 py-2.5 text-right font-medium text-surface-800">
                          {formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="ml-auto max-w-xs">
                <div className="flex items-center justify-between border-t border-surface-200 pt-2">
                  <span className="text-sm font-semibold text-surface-800">Grand Total</span>
                  <span className="text-base font-bold text-brand-700">
                    {formatINR(computeTotals(viewVersion.content.items, viewVersion.content.packingCharges).grandTotal)}
                  </span>
                </div>
              </div>
              <DescList
                items={[
                  { label: 'Payment Terms', value: viewVersion.content.paymentTerms },
                  { label: 'Delivery Terms', value: viewVersion.content.deliveryTerms },
                  { label: 'Warranty', value: viewVersion.content.warranty },
                  {
                    label: 'Packing Charges',
                    value: viewVersion.content.packingCharges > 0 ? formatINR(viewVersion.content.packingCharges) : 'Included',
                  },
                ]}
              />
            </>
          ) : (
            <p className="rounded-lg border border-surface-200 bg-surface-50 p-3 text-[12px] text-surface-500">
              No quote snapshot was stored for this version — only the revision record above is on file. Newer
              versions cut through Quotes Needing Revision keep their full quote body.
            </p>
          )}
          <p className="text-[11px] text-surface-400">
            Versions are read-only — full quote revisions go through Quotes Needing Revision / Global Inbox.
          </p>
        </div>
      )}
    </Modal>

    <ConfirmDialog
      open={!!confirmDiscard}
      onClose={() => setConfirmDiscard(null)}
      onConfirm={() => {
        if (confirmDiscard === 'close') onClose();
        else {
          resetFields();
          setEditing(false);
        }
      }}
      title="Discard unsaved changes?"
      message="You have unsaved changes to the status, stage or review date. Discard them?"
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      danger
    />
    </>
  );
}
