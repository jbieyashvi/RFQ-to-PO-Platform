import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Quotation, QuotationStage, QuotationStatus } from '@/types';
import { QUOTATION_STAGE, QUOTATION_STATUS } from '@/lib/labels';
import { useApp } from '@/context/AppContext';
import { Button, Modal, StatusBadge, TextField } from '@/components/ui';
import {
  TODAY_ISO,
  buildWorkflowPatch,
  reviewDateError,
  type WorkflowChange,
} from '@/lib/quotationWorkflow';

export interface WorkflowRequest {
  quotation: Quotation;
  field: 'status' | 'stage';
  value: QuotationStatus | QuotationStage;
}

/**
 * Shared "Update Quotation Workflow" prompt used by BOTH the inline list
 * dropdowns and the detail drawer. A Review Date is mandatory for every Status
 * or Stage change (including Close / Finalised) — Status/Stage and the Review
 * Date are saved together in a single action, or not at all.
 */
export function WorkflowUpdateModal({
  request,
  onClose,
}: {
  request: WorkflowRequest | null;
  onClose: () => void;
}) {
  const { updateQuotation, addToast, currentUser } = useApp();
  const [reviewDate, setReviewDate] = useState('');
  const [touched, setTouched] = useState(false);

  // Always start from an empty date so a fresh today/future review is chosen.
  useEffect(() => {
    setReviewDate('');
    setTouched(false);
  }, [request?.quotation.id, request?.field, request?.value]);

  if (!request) return null;

  const q = request.quotation;
  const isStatus = request.field === 'status';

  const currentLabel = isStatus
    ? QUOTATION_STATUS[q.status]
    : QUOTATION_STAGE[q.stage];
  const nextLabel = isStatus
    ? QUOTATION_STATUS[request.value as QuotationStatus]
    : QUOTATION_STAGE[request.value as QuotationStage];

  const error = reviewDateError(reviewDate);

  const handleSave = () => {
    setTouched(true);
    if (error) return;
    const change: WorkflowChange = isStatus
      ? { status: request.value as QuotationStatus, reviewDate }
      : { stage: request.value as QuotationStage, reviewDate };
    updateQuotation(q.id, buildWorkflowPatch(q, change, currentUser.fullName));
    addToast({ type: 'success', title: 'Quotation workflow updated.' });
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Update Quotation Workflow"
      subtitle={q.number}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Update</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-surface-100 bg-surface-50/60 px-3.5 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
            {isStatus ? 'Status' : 'Stage'}
          </p>
          <div className="flex items-center gap-2.5">
            <StatusBadge tone={currentLabel.tone} label={currentLabel.label} dot={!isStatus ? false : true} />
            <ArrowRight className="h-4 w-4 shrink-0 text-surface-400" />
            <StatusBadge tone={nextLabel.tone} label={nextLabel.label} dot={!isStatus ? false : true} />
          </div>
        </div>

        <TextField
          type="date"
          label="Review Date"
          required
          min={TODAY_ISO}
          value={reviewDate}
          onChange={(e) => setReviewDate(e.target.value)}
          error={touched ? error ?? undefined : undefined}
          hint="Set the next review date to save this change."
        />
      </div>
    </Modal>
  );
}
