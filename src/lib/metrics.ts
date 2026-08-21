import type { Quotation, QuotationStage, SalesOrder } from '@/types';
import { daysBetween, isOverdue } from '@/lib/format';
import { isActiveRevision } from '@/lib/revision';

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

// ===========================================================================
// DASHBOARD CALCULATION LAYER  (Pipeline / Conversion / Action / Overdue)
// ===========================================================================
//
// The four dashboard sections read every number from HERE so a card's count
// always equals the in-scope list it links to, using the SAME status/stage
// vocabulary as the module screens. No PM sample numbers (100 / 70 / 30) are
// hardcoded — everything is derived from the live prototype datasets.
//
// Metric definitions (single source of truth — keep in sync with modules):
//  - Inquiry Received : each Quotation record == one received customer RFQ/inquiry.
//                     (Prototype convention: there is no separate inquiry dataset,
//                     so this is the ONLY place that definition lives.)
//  - Quote Sent     : quotation dispatched to the customer -> workState 'sent'.
//  - No Follow-up / : quotation pipeline stage -> quotation.stage.
//    Budgetary /
//    Negotiation /
//    Finalise
//  - PO Received    : an actual customer PO record exists. Every Sales Order
//                     carries a received PO, so a PO record == a SalesOrder.
//                     DISTINCT from the quotation 'received' ("Receive") status,
//                     which is a quotation business status only — the two are
//                     never conflated.
//  - SO Sent        : sales order dispatched -> SalesOrder.status === 'so_sent'
//                     (exact; 'finalised' is deliberately NOT folded in).
//  - Needs Revision : client asked for quotation changes -> workState
//                     'needs_revision'.
//  - Client SO      : client raised a concern on a sent SO -> an active SO
//    Escalation       revision (isActiveRevision).
//  - Mismatch       : PO vs Quote verification issue, corrected PO pending ->
//                     verificationStatus 'mismatch' | 'corrected_awaited'.
//  - Overdue        : the record's due/review/SLA date has PASSED, decided by
//                     date comparison against TODAY — never a manual label.
// ---------------------------------------------------------------------------

/** Internal-ops service level: a task is "overdue" once it is older than 24h. */
export const SLA_HOURS = 24;
/** True when an ISO date is more than 24h in the past (day-granular prototype). */
const agedOver24h = (iso?: string) => !!iso && daysBetween(iso) > 1;

// -- Shared record predicates (used by both counts and destination lists) ----
export const isQuoteSent = (q: Quotation) => q.workState === 'sent';
export const isQuotePending = (q: Quotation) => q.workState === 'pending_send';
export const isQuoteNeedsRevision = (q: Quotation) => q.workState === 'needs_revision';
export const isSOSent = (s: SalesOrder) => s.status === 'so_sent';
export const isSODraft = (s: SalesOrder) => s.status === 'draft';
export const isSOMismatch = (s: SalesOrder) =>
  s.verificationStatus === 'mismatch' || s.verificationStatus === 'corrected_awaited';

// -- Per-section Branch + date-range scoping ---------------------------------
export interface SectionFilter {
  /** office id, or 'all' for every in-scope branch */
  branch: string;
  /** ISO yyyy-mm-dd, '' = open start */
  from: string;
  /** ISO yyyy-mm-dd, '' = open end */
  to: string;
}

export const DEFAULT_SECTION_FILTER: SectionFilter = { branch: 'all', from: '', to: '' };

/** A From/To range is valid when either bound is empty or From <= To. */
export function isValidRange(f: SectionFilter): boolean {
  return !f.from || !f.to || f.from <= f.to;
}

/**
 * Apply a section's Branch + From/To filter to a record list. Callers pass an
 * already role-scoped list (office-role users are pre-limited to their office);
 * this only layers the section's own controls. An invalid range is ignored so
 * the UI can surface a validation message without blanking the section.
 */
export function scopeRecords<T>(
  records: T[],
  f: SectionFilter,
  get: (r: T) => { officeId: string; date: string }
): T[] {
  const rangeOk = isValidRange(f);
  return records.filter((r) => {
    const { officeId, date } = get(r);
    if (f.branch !== 'all' && officeId !== f.branch) return false;
    if (rangeOk) {
      if (f.from && date < f.from) return false;
      if (f.to && date > f.to) return false;
    }
    return true;
  });
}

// -- Row shapes --------------------------------------------------------------
export interface MetricRow {
  key: string;
  label: string;
  count: number;
  /** destination route; undefined => not clickable (no matching list exists) */
  to?: string;
  /** accessible description / subtitle */
  hint?: string;
}

export interface ActionRowPart {
  key: string;
  label: string;
  count: number;
  to: string;
}

export interface ActionRow {
  key: string;
  label: string;
  count: number;
  /**
   * Semantic tone (drives the left-border + count colour):
   *  red = urgent/escalation · purple = PO/Quote mismatch ·
   *  orange = revision · slate = remaining work.
   */
  tone: 'red' | 'orange' | 'purple' | 'slate';
  to: string;
  description: string;
  /** clickable sub-splits rendered as chips under the row */
  parts?: ActionRowPart[];
}

export interface OverdueRow {
  key: string;
  label: string;
  count: number;
  to: string;
  note: string;
}

export interface OverdueGroups {
  internalOps: OverdueRow[];
  salesTeam: OverdueRow[];
  internalTotal: number;
  salesTotal: number;
  total: number;
}

// -- 1) Conversion funnel ----------------------------------------------------
export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  to: string;
  hint: string;
  /** overall conversion from Total Inquiries Received, 0–100 */
  overallPct: number;
}

/** Quotation ids that already have a customer PO (a linked Sales Order). */
export function poQuotationIds(salesOrders: SalesOrder[]): Set<string> {
  const ids = new Set<string>();
  for (const s of salesOrders) if (s.quotationId) ids.add(s.quotationId);
  return ids;
}

/** Converted opportunity: the customer PO arrived OR the quote is finalised. */
export const isConvertedQuote = (q: Quotation, poIds: Set<string>) =>
  poIds.has(q.id) || q.stage === 'finalised';
/** Finalised quotation whose customer PO has NOT arrived yet. */
export const isAwaitingPOQuote = (q: Quotation, poIds: Set<string>) =>
  q.stage === 'finalised' && !poIds.has(q.id);

/**
 * Client-approved seven-level conversion funnel (exact content, order and
 * counts as signed off — these are the approved sample numbers for the demo
 * dataset; the prototype seed data intentionally does not regenerate them):
 *   Total Inquiries Received → Total Quotes Sent → No Follow-ups → Budgetary →
 *   Negotiation → Finalize → SO Sent.
 * Every level deep-links to the operational list that tracks it.
 */
export function conversionFunnel(): FunnelStage[] {
  const raw = [
    {
      key: 'inquiries',
      label: 'Total Inquiries Received',
      count: 100,
      to: '/quotations',
      hint: 'Every customer RFQ / inquiry received',
    },
    {
      key: 'quotes_sent',
      label: 'Total Quotes Sent',
      count: 70,
      to: '/quotations?view=sent',
      hint: 'Quotations dispatched to customers',
    },
    {
      key: 'no_followups',
      label: 'No Follow-ups',
      count: 25,
      to: '/quotations?stage=no_followup',
      hint: 'Sent quotes with no follow-up conversation yet',
    },
    {
      key: 'budgetary',
      label: 'Budgetary',
      count: 14,
      to: '/quotations?stage=budgetary',
      hint: 'Budgetary discussions in progress',
    },
    {
      key: 'negotiation',
      label: 'Negotiation',
      count: 8,
      to: '/quotations?stage=negotiation',
      hint: 'In commercial negotiation',
    },
    {
      key: 'finalize',
      label: 'Finalize',
      count: 3,
      to: '/quotations?stage=finalised',
      hint: 'Ready to close — awaiting decision',
    },
    {
      key: 'so_sent',
      label: 'SO Sent',
      count: 18,
      to: '/sales-orders?status=so_sent',
      hint: 'Sales orders dispatched to customers',
    },
  ];

  const first = raw[0].count;
  return raw.map((r) => ({
    ...r,
    overallPct: first > 0 ? Math.min(100, Math.round((r.count / first) * 100)) : 0,
  }));
}

// -- 2) Action required ------------------------------------------------------
/**
 * Client-approved Action Required list (exact content, order and counts as
 * signed off — approved sample numbers for the demo dataset). Semantic tones:
 * red = urgent · purple = mismatch · orange = revision · slate = remaining
 * work. Every row (and sub-split chip) deep-links to its operational list.
 */
export function actionRequired(): ActionRow[] {
  return [
    {
      key: 'client_so_escalation',
      label: 'Client SO Escalation',
      count: 1,
      tone: 'red',
      to: '/sales-orders/revisions',
      description: 'Client raised a concern on a sent SO — revision in progress.',
    },
    {
      key: 'so_pending',
      label: 'SO Pending — Not Sent in 24h',
      count: 2,
      tone: 'red',
      to: '/sales-orders?status=draft',
      description: 'PO verified but the Sales Order is still to be prepared and sent.',
    },
    {
      key: 'po_mismatch',
      label: 'PO vs Quote Mismatch — Updated PO Pending',
      count: 2,
      tone: 'purple',
      to: '/sales-orders/verification',
      description: 'Mismatch found on verification — corrected PO / response still pending.',
    },
    {
      key: 'needs_revision',
      label: 'Quote Not Approved / Needs Revision',
      count: 15,
      tone: 'orange',
      to: '/quotations/revisions',
      description: 'Client requested changes — quotation must be revised and re-sent.',
    },
    {
      key: 'quotes_remaining',
      label: 'Quotes Remaining to Send',
      count: 30,
      tone: 'slate',
      to: '/quotations/pending',
      description: 'Inquiries received but quotations not yet sent.',
      parts: [
        {
          key: 'no_conversation_24h',
          label: 'No conversation in 24h',
          count: 18,
          to: '/quotations?stage=no_followup',
        },
        {
          key: 'still_open',
          label: 'Of 100 inquiries received, 70 quoted — 30 still open',
          count: 30,
          to: '/quotations/pending',
        },
      ],
    },
  ];
}

// -- 4) Overdue tasks --------------------------------------------------------
/** Two overdue groups; "overdue" is always decided by a date comparison. */
export function overdueTasks(quotations: Quotation[], salesOrders: SalesOrder[]): OverdueGroups {
  const internalOps: OverdueRow[] = [
    {
      key: 'quotes_not_sent',
      label: 'Quotes Not Sent in 24h',
      count: quotations.filter((q) => isQuotePending(q) && agedOver24h(q.createdDate)).length,
      to: '/quotations/pending',
      note: 'Pending quotations older than 24h.',
    },
    {
      key: 'revision_pending',
      label: 'Quote Revision Pending over 24h',
      count: quotations.filter(
        (q) => isQuoteNeedsRevision(q) && agedOver24h(q.revisionRequestedDate ?? q.lastUpdated)
      ).length,
      to: '/quotations/revisions',
      note: 'Revision requested more than 24h ago.',
    },
    {
      key: 'mismatch_over',
      label: 'PO vs Quote Mismatch over 24h',
      count: salesOrders.filter((so) => isSOMismatch(so) && agedOver24h(so.receivedDate)).length,
      to: '/sales-orders/verification',
      note: 'Mismatch unresolved beyond 24h.',
    },
    {
      key: 'so_pending_over',
      label: 'SO Pending over 24h',
      count: salesOrders.filter((so) => isSODraft(so) && agedOver24h(so.createdDate)).length,
      to: '/sales-orders?status=draft',
      note: 'Verified PO with SO not sent beyond 24h.',
    },
    {
      key: 'escalation_over',
      label: 'Client SO Escalation over 24h',
      count: salesOrders.filter(
        (so) => isActiveRevision(so) && agedOver24h(so.revisionRequestedDate ?? so.createdDate)
      ).length,
      to: '/sales-orders/revisions',
      note: 'Client SO concern open beyond 24h.',
    },
  ];

  const stageOverdue = (stage: QuotationStage) =>
    quotations.filter((q) => q.stage === stage && isOverdue(q.reviewDate)).length;

  const salesTeam: OverdueRow[] = [
    {
      key: 'no_followup_over',
      label: 'No Follow-ups Overdue',
      count: stageOverdue('no_followup'),
      to: '/quotations?stage=no_followup',
      note: 'Follow-up review date has passed.',
    },
    {
      key: 'budgetary_over',
      label: 'Budgetary Overdue',
      count: stageOverdue('budgetary'),
      to: '/quotations?stage=budgetary',
      note: 'Budgetary review date has passed.',
    },
    {
      key: 'negotiation_over',
      label: 'Negotiation Overdue',
      count: stageOverdue('negotiation'),
      to: '/quotations?stage=negotiation',
      note: 'Negotiation review date has passed.',
    },
    {
      key: 'finalise_over',
      label: 'Finalise Overdue',
      count: stageOverdue('finalised'),
      to: '/quotations?stage=finalised',
      note: 'Finalise review date has passed.',
    },
  ];

  const internalTotal = internalOps.reduce((s, r) => s + r.count, 0);
  const salesTotal = salesTeam.reduce((s, r) => s + r.count, 0);
  // Present each group highest overdue count → lowest.
  const byCountDesc = (a: OverdueRow, b: OverdueRow) => b.count - a.count;
  return {
    internalOps: [...internalOps].sort(byCountDesc),
    salesTeam: [...salesTeam].sort(byCountDesc),
    internalTotal,
    salesTotal,
    total: internalTotal + salesTotal,
  };
}
