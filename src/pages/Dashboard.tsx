import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Filter,
  ArrowRightLeft,
  ListChecks,
  CalendarClock,
  RotateCcw,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { FilterSelect } from '@/components/ui';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES } from '@/data/offices';
import {
  pipelineFunnel,
  conversionFunnel,
  actionRequired,
  overdueTasks,
  scopeRecords,
  isValidRange,
  DEFAULT_SECTION_FILTER,
  type SectionFilter,
  type MetricRow,
  type ConversionRow,
  type ActionRow,
  type OverdueRow,
} from '@/lib/metrics';
import { classNames } from '@/lib/format';

// Funnel-bar fills — muted navy/blue/slate/amber/violet/pink/green, in keeping
// with the white/indigo design system (no bright gradients).
const PIPELINE_COLORS = [
  'bg-brand-700',
  'bg-brand-500',
  'bg-slate-600',
  'bg-amber-600',
  'bg-violet-600',
  'bg-rose-600',
  'bg-emerald-600',
];
const CONVERSION_COLORS = ['bg-brand-700', 'bg-brand-500', 'bg-violet-600', 'bg-emerald-600'];

// ---------------------------------------------------------------------------
// Per-section independent Branch + From/To date filter.
// Each dashboard section owns its own instance so changing one never affects
// another. Default Branch = All Branches, default range = full dataset (open).
// ---------------------------------------------------------------------------
function useSectionFilter() {
  const [branch, setBranch] = useState(DEFAULT_SECTION_FILTER.branch);
  const [from, setFrom] = useState(DEFAULT_SECTION_FILTER.from);
  const [to, setTo] = useState(DEFAULT_SECTION_FILTER.to);
  const filter: SectionFilter = { branch, from, to };
  const error = isValidRange(filter) ? '' : 'From date must be on or before To date.';
  const dirty = branch !== 'all' || from !== '' || to !== '';
  const reset = () => {
    setBranch('all');
    setFrom('');
    setTo('');
  };
  return { filter, branch, setBranch, from, setFrom, to, setTo, error, dirty, reset };
}

type SectionFilterState = ReturnType<typeof useSectionFilter>;

function SectionFilters({
  state,
  branchOptions,
}: {
  state: SectionFilterState;
  branchOptions: { value: string; label: string }[];
}) {
  const { branch, setBranch, from, setFrom, to, setTo, error, dirty, reset } = state;
  const dateCls =
    'h-9 rounded-lg border border-surface-200 bg-white px-2.5 text-[13px] text-surface-700 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={branch === 'all' ? '' : branch}
          onChange={(v) => setBranch(v || 'all')}
          placeholder="All Branches"
          options={branchOptions}
        />
        <input
          type="date"
          aria-label="From date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className={classNames(dateCls, error && 'border-rose-400')}
        />
        <span className="text-xs text-surface-400">to</span>
        <input
          type="date"
          aria-label="To date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className={classNames(dateCls, error && 'border-rose-400')}
        />
        {dirty && (
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 text-xs font-semibold text-surface-500 hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        )}
      </div>
      {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
    </div>
  );
}

function DashSection({
  title,
  icon,
  filters,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  filters: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={classNames('card overflow-hidden', className)}>
      <div className="flex flex-col gap-3 border-b border-surface-100 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-2 pt-1.5">
          {icon}
          <h3 className="text-sm font-semibold text-surface-800">{title}</h3>
        </div>
        {filters}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

function FunnelBar({
  row,
  width,
  color,
  onOpen,
}: {
  row: MetricRow;
  width: number;
  color: string;
  onOpen: (to: string) => void;
}) {
  const inner = (
    <>
      <span className="truncate text-sm font-medium">{row.label}</span>
      <span className="ml-3 flex-none text-xl font-bold tabular-nums">{row.count}</span>
    </>
  );
  const base = classNames(
    'flex items-center justify-between rounded-lg px-4 py-3 text-white shadow-sm',
    color
  );
  if (row.to) {
    const to = row.to;
    return (
      <button
        type="button"
        onClick={() => onOpen(to)}
        style={{ width: `${width}%` }}
        aria-label={`${row.label}: ${row.count}${row.hint ? '. ' + row.hint : ''}. Open list`}
        className={classNames(
          base,
          'transition hover:brightness-110 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 focus-visible:ring-offset-1'
        )}
      >
        {inner}
      </button>
    );
  }
  return (
    <div style={{ width: `${width}%` }} className={base} aria-label={`${row.label}: ${row.count}`}>
      {inner}
    </div>
  );
}

function ActionCard({ row, onOpen }: { row: ActionRow; onOpen: (to: string) => void }) {
  const edge =
    row.severity === 'high'
      ? 'border-l-rose-500'
      : row.severity === 'medium'
      ? 'border-l-amber-500'
      : 'border-l-brand-400';
  return (
    <button
      type="button"
      onClick={() => onOpen(row.to)}
      aria-label={`${row.label}: ${row.count}. ${row.description}`}
      className={classNames(
        'flex w-full items-center gap-4 rounded-lg border border-surface-200 border-l-4 bg-white px-4 py-3 text-left shadow-sm transition hover:border-surface-300 hover:bg-surface-50 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
        edge
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-surface-800">{row.label}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-surface-500">
          {row.description}
        </span>
        {row.sub && (
          <span className="mt-1 inline-block text-[13px] font-medium text-surface-600">
            {row.sub.label}: <span className="text-surface-800">{row.sub.count}</span>
          </span>
        )}
      </span>
      <span className="flex-none text-2xl font-bold tabular-nums text-surface-900">{row.count}</span>
    </button>
  );
}

function OverdueItem({ row, onOpen }: { row: OverdueRow; onOpen: (to: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.to)}
      aria-label={`${row.label}: ${row.count}. ${row.note}`}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-surface-800">{row.label}</span>
        <span className="block text-[13px] text-surface-400">{row.note}</span>
      </span>
      <span
        className={classNames(
          'flex-none rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums',
          row.count > 0 ? 'bg-rose-50 text-rose-600' : 'bg-surface-100 text-surface-500'
        )}
      >
        {row.count}
      </span>
    </button>
  );
}

export default function Dashboard() {
  const { quotations, salesOrders, role, visibleOffices } = useApp();
  const inScope = useOfficeScope();
  const navigate = useNavigate();
  const onOpen = (to: string) => navigate(to);

  // Branch options mirror the Sales Office Master; office-scoped roles only see
  // their own office. (The header office selector was removed — each section
  // filters independently.)
  const branchOptions = useMemo(
    () =>
      (role === 'super_admin' ? OFFICES : visibleOffices).map((o) => ({
        value: o.id,
        label: o.name,
      })),
    [role, visibleOffices]
  );

  // Role-scoped base lists — every section filters on top of these.
  const baseQuotations = useMemo(
    () => quotations.filter((q) => inScope(q.officeId)),
    [quotations, inScope]
  );
  const baseSalesOrders = useMemo(
    () => salesOrders.filter((s) => inScope(s.officeId)),
    [salesOrders, inScope]
  );

  // One independent filter per section.
  const pipelineF = useSectionFilter();
  const conversionF = useSectionFilter();
  const actionF = useSectionFilter();
  const overdueF = useSectionFilter();

  const qBy = (q: (typeof baseQuotations)[number]) => ({ officeId: q.officeId, date: q.createdDate });
  const soBy = (s: (typeof baseSalesOrders)[number]) => ({ officeId: s.officeId, date: s.createdDate });

  const pipeline = useMemo(() => {
    const q = scopeRecords(baseQuotations, pipelineF.filter, qBy);
    const so = scopeRecords(baseSalesOrders, pipelineF.filter, soBy);
    return pipelineFunnel(q, so);
  }, [baseQuotations, baseSalesOrders, pipelineF.filter]);

  const conversion = useMemo(() => {
    const q = scopeRecords(baseQuotations, conversionF.filter, qBy);
    const so = scopeRecords(baseSalesOrders, conversionF.filter, soBy);
    return conversionFunnel(q, so);
  }, [baseQuotations, baseSalesOrders, conversionF.filter]);

  const actions = useMemo(() => {
    const q = scopeRecords(baseQuotations, actionF.filter, qBy);
    const so = scopeRecords(baseSalesOrders, actionF.filter, soBy);
    return actionRequired(q, so);
  }, [baseQuotations, baseSalesOrders, actionF.filter]);

  const overdue = useMemo(() => {
    const q = scopeRecords(baseQuotations, overdueF.filter, qBy);
    const so = scopeRecords(baseSalesOrders, overdueF.filter, soBy);
    return overdueTasks(q, so);
  }, [baseQuotations, baseSalesOrders, overdueF.filter]);

  return (
    <>
      <PageHeader
        title="Operations Dashboard"
        description="Pipeline, conversion and the tasks that need attention across your sales offices."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* LEFT COLUMN — Pipeline + Conversion funnels */}
        <div className="flex flex-col gap-5 lg:col-span-2">
          <DashSection
            title="Pipeline Funnel"
            icon={<Filter className="h-4 w-4 text-brand-500" />}
            filters={<SectionFilters state={pipelineF} branchOptions={branchOptions} />}
          >
            <div className="space-y-2">
              {pipeline.map((row, i) => (
                <FunnelBar
                  key={row.key}
                  row={row}
                  width={100 - i * 9}
                  color={PIPELINE_COLORS[i]}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </DashSection>

          <DashSection
            title="Conversion Funnel"
            icon={<ArrowRightLeft className="h-4 w-4 text-brand-500" />}
            filters={<SectionFilters state={conversionF} branchOptions={branchOptions} />}
          >
            <div className="space-y-2">
              {conversion.map((row: ConversionRow, i) => (
                <div key={row.key}>
                  <FunnelBar row={row} width={100 - i * 13} color={CONVERSION_COLORS[i]} onOpen={onOpen} />
                  {row.breakdown && (
                    <div
                      className="mt-1.5 flex flex-wrap gap-2"
                      style={{ width: `${100 - i * 13}%` }}
                    >
                      {row.breakdown.map((b) =>
                        b.to ? (
                          <button
                            key={b.label}
                            type="button"
                            onClick={() => onOpen(b.to!)}
                            className="chip transition hover:border-brand-300 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                          >
                            {b.label}: <span className="font-semibold text-surface-800">{b.count}</span>
                          </button>
                        ) : (
                          <span key={b.label} className="chip">
                            {b.label}: <span className="font-semibold text-surface-800">{b.count}</span>
                          </span>
                        )
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </DashSection>
        </div>

        {/* RIGHT COLUMN — Action Required */}
        <DashSection
          title="Action Required"
          icon={<ListChecks className="h-4 w-4 text-amber-500" />}
          filters={<SectionFilters state={actionF} branchOptions={branchOptions} />}
          className="lg:col-span-1"
        >
          <div className="space-y-2.5">
            {actions.map((row) => (
              <ActionCard key={row.key} row={row} onOpen={onOpen} />
            ))}
          </div>
        </DashSection>
      </div>

      {/* LOWER — Overdue Tasks (full width) */}
      <div className="mt-5">
        <DashSection
          title="Overdue Tasks"
          icon={<CalendarClock className="h-4 w-4 text-rose-500" />}
          filters={<SectionFilters state={overdueF} branchOptions={branchOptions} />}
        >
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="chip">
              Internal Ops: <span className="font-semibold text-surface-800">{overdue.internalTotal}</span>
            </span>
            <span className="chip">
              Sales Team: <span className="font-semibold text-surface-800">{overdue.salesTotal}</span>
            </span>
            <span
              className={classNames(
                'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold',
                overdue.total > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
              )}
            >
              Total overdue: {overdue.total}
            </span>
          </div>

          {overdue.total === 0 ? (
            <p className="rounded-lg border border-dashed border-surface-200 py-8 text-center text-sm text-surface-400">
              Nothing is overdue for the selected branch and date range. 🎉
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between border-b border-surface-100 pb-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">
                    Internal Ops
                  </h4>
                  <span className="text-xs font-semibold text-surface-600">{overdue.internalTotal}</span>
                </div>
                <div className="space-y-1">
                  {overdue.internalOps.map((row) => (
                    <OverdueItem key={row.key} row={row} onOpen={onOpen} />
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between border-b border-surface-100 pb-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-surface-500">
                    Sales Team
                  </h4>
                  <span className="text-xs font-semibold text-surface-600">{overdue.salesTotal}</span>
                </div>
                <div className="space-y-1">
                  {overdue.salesTeam.map((row) => (
                    <OverdueItem key={row.key} row={row} onOpen={onOpen} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </DashSection>
      </div>
    </>
  );
}
