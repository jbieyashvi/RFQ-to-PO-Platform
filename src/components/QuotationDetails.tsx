import { useEffect, useState } from 'react';
import { Paperclip, Download, Building2, FileText } from 'lucide-react';
import type { Quotation, QuotationStage, QuotationStatus } from '@/types';
import {
  Drawer,
  Button,
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
import { latestQuoteSubmittedAt, queryReceivedAt } from '@/lib/quotationDates';
import { TODAY_ISO, buildWorkflowPatch, reviewDateError } from '@/lib/quotationWorkflow';

export function QuotationDetailsDrawer({
  quotation,
  onClose,
  onEdit,
  initialTab = 'overview',
}: {
  quotation: Quotation | null;
  onClose: () => void;
  onEdit?: (q: Quotation) => void;
  initialTab?: string;
}) {
  const { updateQuotation, can, addToast, currentUser } = useApp();
  const [tab, setTab] = useState('overview');
  const [status, setStatus] = useState<QuotationStatus>('open');
  const [stage, setStage] = useState<QuotationStage>('no_followup');
  const [reviewDate, setReviewDate] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (quotation) {
      setTab(initialTab);
      setStatus(quotation.status);
      setStage(quotation.stage);
      setReviewDate(quotation.reviewDate);
      setConfirmDiscard(false);
    }
  }, [quotation, initialTab]);

  if (!quotation) return null;
  const q = quotation;
  const totals = computeTotals(q.items, q.packingCharges);
  const canEdit = can('quotations', 'edit');
  const submitted = latestQuoteSubmittedAt(q);
  const dirty = status !== q.status || stage !== q.stage || reviewDate !== q.reviewDate;

  // Shared rule (same logic as the inline list dropdowns): a Status OR Stage
  // change makes the review date mandatory, and it must be today or later.
  const statusChanged = status !== q.status;
  const stageChanged = stage !== q.stage;
  const workflowChanged = statusChanged || stageChanged;
  const reviewErr = reviewDateError(reviewDate);
  const reviewError = workflowChanged ? reviewErr ?? '' : '';
  const saveDisabled = !dirty || !canEdit || (workflowChanged && !!reviewErr);

  const requestClose = () => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };

  const saveWorkflow = () => {
    if (saveDisabled) return;
    updateQuotation(q.id, buildWorkflowPatch(q, { status, stage, reviewDate }, currentUser.fullName));
    addToast({ type: 'success', title: 'Quotation workflow updated.' });
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
          {onEdit && canEdit && (
            <Button variant="secondary" onClick={() => onEdit(q)}>
              Edit Quotation
            </Button>
          )}
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
                  disabled={!canEdit}
                  options={Object.entries(QUOTATION_STATUS).map(([k, v]) => ({ value: k, label: v.label }))}
                />
                <SelectField
                  label="Stage"
                  value={stage}
                  onChange={(e) => setStage(e.target.value as QuotationStage)}
                  disabled={!canEdit}
                  options={Object.entries(QUOTATION_STAGE).map(([k, v]) => ({ value: k, label: v.label }))}
                />
                <TextField
                  label="Review Date"
                  type="date"
                  min={TODAY_ISO}
                  required={workflowChanged}
                  error={reviewError || undefined}
                  value={reviewDate}
                  disabled={!canEdit}
                  onChange={(e) => setReviewDate(e.target.value)}
                />
              </div>
              {workflowChanged && !reviewError && (
                <p className="mt-2 text-xs text-brand-600">
                  Status/Stage change — review date is saved together with the change.
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
                { label: 'Query Received', value: formatDateTime(queryReceivedAt(q)) },
                { label: 'Latest Quote Submitted', value: submitted ? formatDateTime(submitted) : 'Not submitted' },
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
                  { label: 'Channel', value: q.sendChannel ?? '—' },
                  { label: 'Note', value: q.sendNote ?? '—' },
                ]}
              />
            </div>

            {/* Attachments */}
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-surface-800">
                <Paperclip className="h-4 w-4 text-surface-400" /> Attachments
              </h4>
              {q.attachments.length === 0 ? (
                <p className="text-sm text-surface-400">No attachments.</p>
              ) : (
                <ul className="space-y-2">
                  {q.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-lg border border-surface-200 px-3 py-2">
                      <FileText className="h-4 w-4 text-brand-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-surface-700">{a.name}</p>
                        <p className="text-xs text-surface-400">{a.size} • {formatDate(a.uploadedOn)}</p>
                      </div>
                      <button
                        onClick={() => {
                          downloadText(a.name.replace(/\.\w+$/, '.txt'), `Attachment: ${a.name}\nQuotation: ${q.number}`);
                          addToast({ type: 'info', title: 'Download started', message: a.name });
                        }}
                        className="rounded p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
              {q.revisions.map((r) => (
                <li key={r.id} className="flex items-start gap-3 rounded-lg border border-surface-200 p-3">
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-600">
                    v{r.version}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-surface-800">{r.reason}</p>
                    <p className="text-xs text-surface-400">{formatDate(r.date)} • by {r.by}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'activity' && <ActivityTimeline events={q.activity} />}
      </div>
    </Drawer>

    <ConfirmDialog
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      onConfirm={onClose}
      title="Discard unsaved changes?"
      message="You have unsaved changes to the status, stage or review date. Close without saving?"
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      danger
    />
    </>
  );
}
