import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  FolderOpen,
  CheckCircle2,
  Inbox,
  Send,
  Clock,
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarX2,
  ListChecks,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { KpiCard, StatusBadge, FilterSelect, SectionCard } from '@/components/ui';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES } from '@/data/offices';
import {
  QUOTATION_STAGE,
  QUOTATION_STATUS,
  SO_STATUS,
} from '@/lib/labels';
import type { QuotationStage } from '@/types';
import {
  formatINR,
  formatDate,
  daysBetween,
  isOverdue,
  classNames,
} from '@/lib/format';

const DATE_RANGES = [
  { value: 'all', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export default function Dashboard() {
  const { quotations, salesOrders, role, selectedOfficeId, setSelectedOfficeId } = useApp();
  const inScope = useOfficeScope();
  const navigate = useNavigate();

  const [dateRange, setDateRange] = useState('all');
  const [statusFilter, setStatusFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');

  const filtered = useMemo(() => {
    return quotations.filter((q) => {
      if (!inScope(q.officeId)) return false;
      if (statusFilter && q.status !== statusFilter) return false;
      if (stageFilter && q.stage !== stageFilter) return false;
      if (dateRange !== 'all') {
        const days = daysBetween(q.quoteDate);
        if (days > Number(dateRange)) return false;
      }
      return true;
    });
  }, [quotations, inScope, statusFilter, stageFilter, dateRange]);

  const scopedSO = useMemo(
    () => salesOrders.filter((s) => inScope(s.officeId)),
    [salesOrders, inScope]
  );

  const m = useMemo(() => {
    const total = filtered.length;
    const open = filtered.filter((q) => q.status === 'open').length;
    const closed = filtered.filter((q) => q.status === 'closed').length;
    const received = filtered.filter((q) => q.status === 'received').length;
    const pendingSend = filtered.filter((q) => q.workState === 'pending_send').length;
    const needsRevision = filtered.filter((q) => q.workState === 'needs_revision').length;
    const soSent = scopedSO.filter((s) => s.status === 'so_sent' || s.status === 'finalised').length;
    const mismatches = scopedSO.filter(
      (s) => s.verificationStatus === 'mismatch' || s.verificationStatus === 'corrected_awaited'
    ).length;
    const value = filtered.reduce((sum, q) => sum + q.value, 0);
    return { total, open, closed, received, pendingSend, needsRevision, soSent, mismatches, value };
  }, [filtered, scopedSO]);

  const funnel = useMemo(() => {
    const stages: QuotationStage[] = ['no_followup', 'budgetary', 'negotiation', 'finalised'];
    const max = Math.max(1, ...stages.map((s) => filtered.filter((q) => q.stage === s).length));
    return stages.map((s) => ({
      stage: s,
      count: filtered.filter((q) => q.stage === s).length,
      pct: (filtered.filter((q) => q.stage === s).length / max) * 100,
    }));
  }, [filtered]);

  const officePerf = useMemo(() => {
    const offices = role === 'super_admin' ? OFFICES : OFFICES.filter((o) => inScope(o.id));
    return offices
      .map((o) => {
        const qs = filtered.filter((q) => q.officeId === o.id);
        return {
          office: o,
          count: qs.length,
          value: qs.reduce((s, q) => s + q.value, 0),
          received: qs.filter((q) => q.status === 'received').length,
        };
      })
      .filter((r) => r.count > 0)
      .sort((a, b) => b.value - a.value);
  }, [filtered, role, inScope]);

  const recentlyUpdated = useMemo(
    () => [...filtered].sort((a, b) => (a.lastUpdated < b.lastUpdated ? 1 : -1)).slice(0, 6),
    [filtered]
  );

  const upcomingReviews = useMemo(
    () =>
      filtered
        .filter((q) => q.status === 'open' && daysBetween(q.reviewDate) <= 0)
        .sort((a, b) => (a.reviewDate < b.reviewDate ? -1 : 1))
        .slice(0, 5),
    [filtered]
  );

  const overdueReviews = useMemo(
    () =>
      filtered
        .filter((q) => q.status === 'open' && isOverdue(q.reviewDate))
        .sort((a, b) => daysBetween(b.reviewDate) - daysBetween(a.reviewDate))
        .slice(0, 5),
    [filtered]
  );

  const actionRequired = useMemo(() => {
    const list: { id: string; label: string; sub: string; tone: string; to: string }[] = [];
    filtered
      .filter((q) => q.workState === 'pending_send' && daysBetween(q.createdDate) > 1)
      .slice(0, 3)
      .forEach((q) =>
        list.push({
          id: `p-${q.id}`,
          label: `${q.number} pending to be sent`,
          sub: `${q.customerName} • ${daysBetween(q.createdDate)} days old`,
          tone: 'amber',
          to: '/quotations/pending',
        })
      );
    scopedSO
      .filter((s) => s.verificationStatus === 'mismatch')
      .slice(0, 3)
      .forEach((s) =>
        list.push({
          id: `m-${s.id}`,
          label: `${s.number} — PO vs Quote mismatch`,
          sub: `${s.customerName} • flagged for correction`,
          tone: 'rose',
          to: '/sales-orders/verification',
        })
      );
    filtered
      .filter((q) => q.workState === 'needs_revision')
      .slice(0, 2)
      .forEach((q) =>
        list.push({
          id: `r-${q.id}`,
          label: `${q.number} needs revision`,
          sub: `${q.customerName} • ${q.revisionReason ?? 'Revision requested'}`,
          tone: 'blue',
          to: '/quotations/revisions',
        })
      );
    return list.slice(0, 6);
  }, [filtered, scopedSO]);

  const recentSO = useMemo(
    () => [...scopedSO].sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1)).slice(0, 5),
    [scopedSO]
  );

  const goto = (path: string) => navigate(path);

  return (
    <>
      <PageHeader
        title="Operations Dashboard"
        description="Live view of the quotation-to-purchase-order pipeline across your sales offices."
      />

      {/* Filters */}
      <div className="card mb-5 flex flex-wrap items-center gap-2 p-3">
        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-surface-400">
          Filters
        </span>
        {role === 'super_admin' && (
          <FilterSelect
            value={selectedOfficeId === 'all' ? '' : selectedOfficeId}
            onChange={(v) => setSelectedOfficeId(v || 'all')}
            placeholder="All Sales Offices"
            options={OFFICES.map((o) => ({ value: o.id, label: o.name }))}
          />
        )}
        <FilterSelect
          value={dateRange === 'all' ? '' : dateRange}
          onChange={(v) => setDateRange(v || 'all')}
          placeholder="All time"
          options={DATE_RANGES.filter((d) => d.value !== 'all')}
        />
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
          options={Object.entries(QUOTATION_STATUS).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        <FilterSelect
          value={stageFilter}
          onChange={setStageFilter}
          placeholder="All stages"
          options={Object.entries(QUOTATION_STAGE).map(([k, v]) => ({ value: k, label: v.label }))}
        />
        {(statusFilter || stageFilter || dateRange !== 'all') && (
          <button
            onClick={() => {
              setStatusFilter('');
              setStageFilter('');
              setDateRange('all');
            }}
            className="text-xs font-semibold text-surface-500 hover:text-brand-600 hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="ml-auto px-1 text-sm text-surface-500">
          Pipeline value:{' '}
          <span className="font-semibold text-surface-800">{formatINR(m.value, { compact: true })}</span>
        </span>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Total Quotations" value={m.total} icon={<FileText className="h-4 w-4" />} accent="brand" onClick={() => goto('/quotations')} />
        <KpiCard label="Open Quotations" value={m.open} icon={<FolderOpen className="h-4 w-4" />} accent="blue" sub="Status: Open" onClick={() => goto('/quotations?status=open')} />
        <KpiCard label="Close Quotations" value={m.closed} icon={<CheckCircle2 className="h-4 w-4" />} accent="slate" sub="Status: Close" onClick={() => goto('/quotations?status=closed')} />
        <KpiCard label="PO Received" value={m.received} icon={<Inbox className="h-4 w-4" />} accent="emerald" sub="Customer PO received" onClick={() => goto('/quotations?status=received')} />
        <KpiCard label="SO Sent" value={m.soSent} icon={<Send className="h-4 w-4" />} accent="violet" sub="Sales-order state" onClick={() => goto('/sales-orders?status=so_sent')} />
        <KpiCard label="Quotes Pending to be Sent" value={m.pendingSend} icon={<Clock className="h-4 w-4" />} accent="amber" onClick={() => goto('/quotations/pending')} />
        <KpiCard label="Quotes Needing Revision" value={m.needsRevision} icon={<RefreshCw className="h-4 w-4" />} accent="blue" onClick={() => goto('/quotations/revisions')} />
        <KpiCard label="PO vs Quote Mismatches" value={m.mismatches} icon={<AlertTriangle className="h-4 w-4" />} accent="rose" onClick={() => goto('/sales-orders/verification')} />
      </div>

      {/* Funnel + Office performance */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Quotation Stage Funnel" description="Distribution of quotations by current stage">
          <div className="space-y-4">
            {funnel.map((f) => (
              <button
                key={f.stage}
                onClick={() => {
                  setStageFilter(f.stage);
                }}
                className="block w-full text-left"
              >
                <div className="mb-1 flex items-center justify-between text-sm">
                  <StatusBadge tone={QUOTATION_STAGE[f.stage].tone} label={QUOTATION_STAGE[f.stage].label} />
                  <span className="font-semibold text-surface-800">{f.count}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600 transition-all"
                    style={{ width: `${f.pct}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Sales-Office-wise Performance"
          description="Quotation count and value by office"
        >
          {officePerf.length === 0 ? (
            <p className="py-6 text-center text-sm text-surface-400">No data for the current filters.</p>
          ) : (
            <div className="space-y-3">
              {officePerf.map((r) => (
                <div key={r.office.id} className="flex items-center gap-3">
                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600">
                    {r.office.code.slice(0, 3)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-surface-800">{r.office.name}</p>
                    <p className="text-xs text-surface-400">
                      {r.count} quotations • {r.received} PO received
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-surface-800">
                    {formatINR(r.value, { compact: true })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Reviews + Action required */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-blue-500" /> Upcoming Review Dates
            </span>
          }
        >
          <ReviewList items={upcomingReviews} emptyText="No upcoming reviews." onClick={() => goto('/quotations')} />
        </SectionCard>
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <CalendarX2 className="h-4 w-4 text-rose-500" /> Overdue Reviews
            </span>
          }
        >
          <ReviewList items={overdueReviews} overdue emptyText="No overdue reviews. 🎉" onClick={() => goto('/quotations')} />
        </SectionCard>
        <SectionCard
          title={
            <span className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-amber-500" /> Action Required
            </span>
          }
        >
          {actionRequired.length === 0 ? (
            <p className="py-6 text-center text-sm text-surface-400">Nothing needs attention.</p>
          ) : (
            <ul className="space-y-2">
              {actionRequired.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => goto(a.to)}
                    className="flex w-full items-start gap-2.5 rounded-lg border border-surface-100 px-3 py-2 text-left hover:border-surface-200 hover:bg-surface-50"
                  >
                    <span
                      className={classNames(
                        'mt-1 h-2 w-2 flex-none rounded-full',
                        a.tone === 'amber' ? 'bg-amber-500' : a.tone === 'rose' ? 'bg-rose-500' : 'bg-blue-500'
                      )}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-surface-800">{a.label}</span>
                      <span className="block truncate text-xs text-surface-400">{a.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* Recently updated quotations + Recent SO */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title="Recently Updated Quotations"
          action={
            <button onClick={() => goto('/quotations')} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
          bodyClassName="divide-y divide-surface-100"
        >
          {recentlyUpdated.map((q) => (
            <button
              key={q.id}
              onClick={() => goto(`/quotations?q=${encodeURIComponent(q.number)}`)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-surface-800">
                  {q.number} · {q.customerName}
                </p>
                <p className="text-xs text-surface-400">Updated {formatDate(q.lastUpdated)} • {q.owner}</p>
              </div>
              <StatusBadge tone={QUOTATION_STATUS[q.status].tone} label={QUOTATION_STATUS[q.status].label} />
              <span className="w-24 text-right text-sm font-semibold text-surface-800">
                {formatINR(q.value, { compact: true })}
              </span>
            </button>
          ))}
        </SectionCard>

        <SectionCard
          title="Recent Sales Orders"
          action={
            <button onClick={() => goto('/sales-orders')} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          }
          bodyClassName="divide-y divide-surface-100"
        >
          {recentSO.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-surface-400">No sales orders yet.</p>
          ) : (
            recentSO.map((s) => (
              <button
                key={s.id}
                onClick={() => goto('/sales-orders')}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-surface-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-surface-800">
                    {s.number} · {s.customerName}
                  </p>
                  <p className="text-xs text-surface-400">
                    PO {s.poNumber} • {formatDate(s.createdDate)}
                  </p>
                </div>
                <StatusBadge tone={SO_STATUS[s.status].tone} label={SO_STATUS[s.status].label} />
                <span className="w-24 text-right text-sm font-semibold text-surface-800">
                  {formatINR(s.value, { compact: true })}
                </span>
              </button>
            ))
          )}
        </SectionCard>
      </div>
    </>
  );
}

function ReviewList({
  items,
  overdue,
  emptyText,
  onClick,
}: {
  items: { id: string; number: string; customerName: string; reviewDate: string }[];
  overdue?: boolean;
  emptyText: string;
  onClick: () => void;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-surface-400">{emptyText}</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((q) => {
        const days = daysBetween(q.reviewDate);
        return (
          <li key={q.id}>
            <button onClick={onClick} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-surface-800">{q.number}</span>
                <span className="block truncate text-xs text-surface-400">{q.customerName}</span>
              </span>
              <span
                className={classNames(
                  'flex-none rounded-md px-2 py-0.5 text-xs font-medium',
                  overdue ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'
                )}
              >
                {overdue ? `${days}d overdue` : formatDate(q.reviewDate)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
