import type { Quotation, QuotationStage, SalesOrder } from '@/types';

/**
 * Single source of truth for dashboard metric definitions.
 *
 * Every KPI card, office breakdown, funnel bar and destination-list filter
 * derives from the functions below so a card's number always equals the count
 * of the list it links to. Callers pass an already office-/filter-scoped list;
 * these helpers never re-scope.
 *
 * Status vocabulary (do not conflate):
 *  - Quotation business status: 'open' | 'closed' | 'received' (label "Receive")
 *  - Sales-order state: 'so_sent' is exact and excludes 'finalised'
 */

export const DASHBOARD_STAGES: QuotationStage[] = [
  'no_followup',
  'budgetary',
  'negotiation',
  'finalised',
];

export interface QuotationMetrics {
  total: number;
  open: number;
  closed: number;
  /** Quotations whose business status is "Receive" (status === 'received'). */
  received: number;
  pendingSend: number;
  needsRevision: number;
  value: number;
}

/** Quotation KPIs for a pre-scoped quotation list. */
export function quotationMetrics(quotations: Quotation[]): QuotationMetrics {
  return {
    total: quotations.length,
    open: quotations.filter((q) => q.status === 'open').length,
    closed: quotations.filter((q) => q.status === 'closed').length,
    received: quotations.filter((q) => q.status === 'received').length,
    pendingSend: quotations.filter((q) => q.workState === 'pending_send').length,
    needsRevision: quotations.filter((q) => q.workState === 'needs_revision').length,
    value: quotations.reduce((sum, q) => sum + q.value, 0),
  };
}

export function stageCount(quotations: Quotation[], stage: QuotationStage): number {
  return quotations.filter((q) => q.stage === stage).length;
}

export function stageCounts(quotations: Quotation[]): { stage: QuotationStage; count: number }[] {
  return DASHBOARD_STAGES.map((stage) => ({ stage, count: stageCount(quotations, stage) }));
}

export interface SalesOrderMetrics {
  /** Exact 'so_sent' records only — 'finalised' is deliberately excluded. */
  soSent: number;
  /** PO vs Quote verification issues. */
  mismatches: number;
}

/** Sales-order KPIs for a pre-scoped sales-order list. */
export function salesOrderMetrics(salesOrders: SalesOrder[]): SalesOrderMetrics {
  return {
    soSent: salesOrders.filter((s) => s.status === 'so_sent').length,
    mismatches: salesOrders.filter(
      (s) => s.verificationStatus === 'mismatch' || s.verificationStatus === 'corrected_awaited'
    ).length,
  };
}
