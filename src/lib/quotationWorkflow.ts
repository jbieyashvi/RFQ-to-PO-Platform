import type { ActivityEvent, Quotation, QuotationStage, QuotationStatus } from '@/types';
import { QUOTATION_STAGE, QUOTATION_STATUS } from '@/lib/labels';

// Prototype "today" — a workflow review date must be today or later. Shared by
// the inline table dropdowns AND the detail drawer so both enforce the same rule.
export const TODAY_ISO = '2026-08-13';

export const REVIEW_DATE_REQUIRED = 'Select a review date before updating the quotation.';
export const REVIEW_DATE_PAST = 'Review date must be today or a future date.';

/**
 * Single shared validation for every quotation workflow change (Status OR
 * Stage). Returns the message to show, or null when the date is acceptable.
 * A review date is always mandatory — including when moving to Close/Finalised.
 */
export function reviewDateError(reviewDate: string): string | null {
  if (!reviewDate) return REVIEW_DATE_REQUIRED;
  if (reviewDate < TODAY_ISO) return REVIEW_DATE_PAST;
  return null;
}

export function isReviewDateValid(reviewDate: string): boolean {
  return reviewDateError(reviewDate) === null;
}

export interface WorkflowChange {
  status?: QuotationStatus;
  stage?: QuotationStage;
  reviewDate: string;
}

/**
 * Build the updateQuotation patch for a workflow change: applies the new
 * Status/Stage, saves the Review Date in the same action, records who changed
 * it and when, and appends a History/Activity entry describing the change.
 */
export function buildWorkflowPatch(
  q: Quotation,
  change: WorkflowChange,
  actor: string
): Partial<Quotation> {
  const nextStatus = change.status ?? q.status;
  const nextStage = change.stage ?? q.stage;
  const at = new Date().toISOString();

  const parts: string[] = [];
  if (change.status && change.status !== q.status) {
    parts.push(`Status ${QUOTATION_STATUS[q.status].label} → ${QUOTATION_STATUS[nextStatus].label}`);
  }
  if (change.stage && change.stage !== q.stage) {
    parts.push(`Stage ${QUOTATION_STAGE[q.stage].label} → ${QUOTATION_STAGE[nextStage].label}`);
  }
  const detail = `${parts.join(' · ') || 'Workflow reviewed'} · Next review ${change.reviewDate}`;

  const event: ActivityEvent = {
    id: `act-wf-${q.id}-${at}`,
    date: at,
    actor,
    action: 'Quotation workflow updated',
    detail,
  };

  return {
    status: nextStatus,
    stage: nextStage,
    reviewDate: change.reviewDate,
    lastUpdated: at.slice(0, 10),
    activity: [...q.activity, event],
  };
}
