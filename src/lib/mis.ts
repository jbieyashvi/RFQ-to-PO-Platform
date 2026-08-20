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

export interface Metrics {
  inquiries: number;
  quotesSent: number;
  posReceived: number;
  sosSent: number;
}

export const EMPTY_METRICS: Metrics = { inquiries: 0, quotesSent: 0, posReceived: 0, sosSent: 0 };

/** The four core counts for an already-scoped quotation + sales-order slice. */
export function computeMetrics(quotations: Quotation[], salesOrders: SalesOrder[]): Metrics {
  return {
    inquiries: quotations.length,
    quotesSent: quotations.filter(isQuoteSent).length,
    posReceived: salesOrders.length,
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
export interface PerformerMetrics extends Metrics {
  owner: string;
  officeId: string;
  officeName: string;
}

/**
 * The single top-performing employee per office, ranked by SOs generated, then
 * Quotes Sent, then Inquiries handled. Offices with no owner activity in scope
 * are omitted. `owner` is the employee's display name (the field carried on both
 * quotations and sales orders).
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
        const oq = q.filter((x) => x.owner === owner);
        const oso = so.filter((x) => x.owner === owner);
        return { owner, officeId: o.id, officeName: o.name, ...computeMetrics(oq, oso) };
      })
      .sort(
        (a, b) =>
          b.sosSent - a.sosSent ||
          b.quotesSent - a.quotesSent ||
          b.inquiries - a.inquiries ||
          a.owner.localeCompare(b.owner)
      );

    out.push(ranked[0]);
  }
  return out;
}

// ---------- Weekly / Monthly comparison periods ----------
export interface Period {
  key: string;
  label: string;
  from: string; // yyyy-mm-dd inclusive
  to: string; // yyyy-mm-dd inclusive
}

export type ComparisonMode = 'weekly' | 'monthly';

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
 * Current vs previous comparison windows anchored on the prototype's fixed
 * "today". Weekly = the last 7 days vs the 7 days before that. Monthly = the
 * current calendar month (to date) vs the whole previous calendar month.
 */
export function comparisonPeriods(mode: ComparisonMode, today: Date = TODAY): {
  current: Period;
  previous: Period;
} {
  if (mode === 'weekly') {
    return {
      current: { key: 'this_week', label: 'This Week', from: toISO(shiftDays(today, -6)), to: toISO(today) },
      previous: { key: 'last_week', label: 'Last Week', from: toISO(shiftDays(today, -13)), to: toISO(shiftDays(today, -7)) },
    };
  }
  const firstThis = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstPrev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastPrev = new Date(today.getFullYear(), today.getMonth(), 0); // day 0 => last day of previous month
  return {
    current: { key: 'this_month', label: 'This Month', from: toISO(firstThis), to: toISO(today) },
    previous: { key: 'last_month', label: 'Last Month', from: toISO(firstPrev), to: toISO(lastPrev) },
  };
}

/** Percentage change current vs previous, rounded; null when there is no base. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export const METRIC_LABELS: { key: keyof Metrics; label: string; short: string }[] = [
  { key: 'inquiries', label: 'Inquiries Received', short: 'Inquiries' },
  { key: 'quotesSent', label: 'Quotes Sent', short: 'Quotes' },
  { key: 'posReceived', label: 'POs Received', short: 'POs' },
  { key: 'sosSent', label: 'SOs Sent', short: 'SOs' },
];
