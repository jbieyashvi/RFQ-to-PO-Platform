import type { Quotation, SalesOrder } from '@/types';
import { TODAY } from '@/lib/format';
import { isQuoteSent, isSOSent } from '@/lib/metrics';

// ---------------------------------------------------------------------------
// MIS Reports — single source of truth for the management report calculations.
//
// Metric definitions are deliberately identical to the operations Dashboard
// (see lib/metrics) so every MIS count equals the in-scope operational list:
//   - Inquiries Received : each Quotation record == one received RFQ / inquiry.
//   - Quotes Sent        : quotation dispatched -> workState 'sent' (isQuoteSent).
//   - POs Received       : each Sales Order carries a received customer PO, so
//                          one SalesOrder == one PO Received.
//   - No Follow-ups /
//     Budgetary /
//     Negotiation /
//     Finalised          : the four quotation Stages (Quotation.stage), counted
//                          over the same inquiry set. Every quotation sits in
//                          exactly one stage, so the four always sum to
//                          Inquiries Received.
//   - SOs Sent           : sales order dispatched -> status 'so_sent' (isSOSent,
//                          exact; 'finalised' is deliberately NOT folded in).
//
// A single event date per record scopes the Date Range filter, mirroring the
// Dashboard's scopeRecords model:
//   - Quotation  -> createdDate  (when the inquiry was received)
//   - SalesOrder -> receivedDate (when the customer PO was received)
// ---------------------------------------------------------------------------

export const QUOTATION_DATE = (q: Quotation) => q.createdDate;
export const SALES_ORDER_DATE = (s: SalesOrder) => s.receivedDate;

/** Inclusive yyyy-mm-dd range test; empty bound = open on that side. */
export function inRange(iso: string, from: string, to: string): boolean {
  const d = (iso || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

// Field order mirrors the reported column order: the funnel first, then the
// stage split of that funnel, then the dispatched SOs.
export interface Metrics {
  inquiries: number;
  quotesSent: number;
  posReceived: number;
  noFollowup: number;
  budgetary: number;
  negotiation: number;
  finalised: number;
  sosSent: number;
}

export const EMPTY_METRICS: Metrics = {
  inquiries: 0,
  quotesSent: 0,
  posReceived: 0,
  noFollowup: 0,
  budgetary: 0,
  negotiation: 0,
  finalised: 0,
  sosSent: 0,
};

/** The reported counts for an already-scoped quotation + sales-order slice. */
export function computeMetrics(quotations: Quotation[], salesOrders: SalesOrder[]): Metrics {
  const atStage = (stage: Quotation['stage']) => quotations.filter((q) => q.stage === stage).length;
  return {
    inquiries: quotations.length,
    quotesSent: quotations.filter(isQuoteSent).length,
    posReceived: salesOrders.length,
    noFollowup: atStage('no_followup'),
    budgetary: atStage('budgetary'),
    negotiation: atStage('negotiation'),
    finalised: atStage('finalised'),
    sosSent: salesOrders.filter(isSOSent).length,
  };
}

export interface OfficeMetrics extends Metrics {
  officeId: string;
  officeName: string;
}

/**
 * Per-office metrics for a set of offices. Callers pass quotations / sales
 * orders already limited to the visible offices + Date Range; this only groups
 * them by office so an office with zero activity in the range still shows a row.
 */
export function officeBreakdown(
  offices: { id: string; name: string }[],
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): OfficeMetrics[] {
  return offices.map((o) => {
    const q = quotations.filter((x) => x.officeId === o.id);
    const so = salesOrders.filter((x) => x.officeId === o.id);
    return { officeId: o.id, officeName: o.name, ...computeMetrics(q, so) };
  });
}

// ---------- Top performer per office ----------

/**
 * Sales performance weights. The three things a salesperson personally drives —
 * inquiries handled, quotes sent, POs converted — with the hardest-won counting
 * most. SOs are the back-office dispatch of a PO that is already won, so they
 * are reported but deliberately score nothing: ranking on SOs credited the
 * person who typed the order, not the person who sold it.
 */
export const PERFORMANCE_WEIGHTS = { inquiries: 1, quotesSent: 2, posReceived: 3 } as const;

export function performanceScore(m: Pick<Metrics, 'inquiries' | 'quotesSent' | 'posReceived'>): number {
  return (
    m.inquiries * PERFORMANCE_WEIGHTS.inquiries +
    m.quotesSent * PERFORMANCE_WEIGHTS.quotesSent +
    m.posReceived * PERFORMANCE_WEIGHTS.posReceived
  );
}

export interface PerformerMetrics extends Metrics {
  owner: string;
  officeId: string;
  officeName: string;
  score: number;
}

/**
 * The single top-performing employee per office, ranked by the sales
 * performance score above and then by its parts, hardest-won first. Offices
 * with no owner activity in scope are omitted. `owner` is the employee's
 * display name (the field carried on both quotations and sales orders).
 */
export function topPerformers(
  offices: { id: string; name: string }[],
  quotations: Quotation[],
  salesOrders: SalesOrder[]
): PerformerMetrics[] {
  const out: PerformerMetrics[] = [];
  for (const o of offices) {
    const q = quotations.filter((x) => x.officeId === o.id);
    const so = salesOrders.filter((x) => x.officeId === o.id);
    const owners = new Set<string>();
    q.forEach((x) => x.owner && owners.add(x.owner));
    so.forEach((x) => x.owner && owners.add(x.owner));
    if (owners.size === 0) continue;

    const ranked = Array.from(owners)
      .map((owner) => {
        const metrics = computeMetrics(
          q.filter((x) => x.owner === owner),
          so.filter((x) => x.owner === owner)
        );
        return { owner, officeId: o.id, officeName: o.name, ...metrics, score: performanceScore(metrics) };
      })
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.posReceived - a.posReceived ||
          b.quotesSent - a.quotesSent ||
          b.inquiries - a.inquiries ||
          a.owner.localeCompare(b.owner)
      );

    out.push(ranked[0]);
  }
  return out;
}

// ---------- Weekly / Monthly reporting period ----------
export interface Period {
  key: string;
  label: string;
  from: string; // yyyy-mm-dd inclusive
  to: string; // yyyy-mm-dd inclusive
}

export type PeriodMode = 'weekly' | 'monthly';

/** Local-time yyyy-mm-dd (never use toISOString: it shifts to UTC). */
export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(d: Date, days: number): Date {
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  n.setDate(n.getDate() + days);
  return n;
}

/**
 * The Weekly / Monthly reporting window, anchored on the prototype's fixed
 * "today". Weekly = the last 7 days; Monthly = the current calendar month to
 * date. The MIS page offers these as the two one-click presets behind its
 * Date Range filter, so the toggle and the range always agree.
 */
export function reportPeriod(mode: PeriodMode, today: Date = TODAY): Period {
  if (mode === 'weekly') {
    return { key: 'this_week', label: 'This Week', from: toISO(shiftDays(today, -6)), to: toISO(today) };
  }
  const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
  return { key: 'this_month', label: 'This Month', from: toISO(firstThis), to: toISO(today) };
}

// Reported column order, used verbatim by the office table and both exports.
export const METRIC_LABELS: { key: keyof Metrics; label: string }[] = [
  { key: 'inquiries', label: 'Inquiries Received' },
  { key: 'quotesSent', label: 'Quotes Sent' },
  { key: 'posReceived', label: 'POs Received' },
  { key: 'noFollowup', label: 'No Follow-ups' },
  { key: 'budgetary', label: 'Budgetary' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'finalised', label: 'Finalised' },
  { key: 'sosSent', label: 'SOs Sent' },
];
