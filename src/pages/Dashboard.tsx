import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Filter,
  ListChecks,
  CalendarClock,
  RotateCcw,
  Inbox,
  FileText,
  Send,
  ChevronRight,
  ArrowUpRight,
  AlertTriangle,
  LayoutGrid,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { FilterSelect } from '@/components/ui';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES } from '@/data/offices';
import {
  pipelineFunnel,
  actionRequired,
  overdueTasks,
  scopeRecords,
  isValidRange,
  DEFAULT_SECTION_FILTER,
  type SectionFilter,
  type MetricRow,
  type ActionRow,
  type OverdueRow,
} from '@/lib/metrics';
import { classNames } from '@/lib/format';

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

// Consistent 36px control height across every section's filters.
const DATE_INPUT =
  'h-full w-[128px] bg-transparent px-2.5 text-[13px] text-surface-700 focus:outline-none';

function SectionFilters({
  state,
  branchOptions,
}: {
  state: SectionFilterState;
  branchOptions: { value: string; label: string }[];
}) {
  const { branch, setBranch, from, setFrom, to, setTo, error, dirty, reset } = state;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <FilterSelect
          value={branch === 'all' ? '' : branch}
          onChange={(v) => setBranch(v || 'all')}
          placeholder="All Branches"
          options={branchOptions}
          className="!h-9 min-w-[148px] flex-none !text-[13px]"
        />
        {/* From/To grouped into a single date-range control. */}
        <div
          className={classNames(
            'flex h-9 flex-none items-center rounded-lg border bg-white shadow-sm transition',
            error
              ? 'border-rose-400'
              : 'border-surface-200 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20'
          )}
        >
          <input
            type="date"
            aria-label="From date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
            className={classNames(DATE_INPUT, 'rounded-l-lg')}
          />
          <span className="flex-none text-xs text-surface-300">–</span>
          <input
            type="date"
            aria-label="To date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
            className={classNames(DATE_INPUT, 'rounded-r-lg')}
          />
        </div>
        {dirty && (
          <button
            onClick={reset}
            className="inline-flex flex-none items-center gap-1 rounded text-xs font-semibold text-surface-500 transition hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
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
}: {
  title: string;
  icon: ReactNode;
  filters: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-col gap-2.5 border-b border-surface-100 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-[15px] font-semibold leading-5 text-surface-800">{title}</h2>
        </div>
        {filters}
      </div>
      <div className="p-3.5 sm:p-4">{children}</div>
    </section>
  );
}

// -- Pipeline Overview ------------------------------------------------------
const KPI_ICON: Record<string, ReactNode> = {
  queries: <Inbox className="h-4 w-4" />,
  quotes_sent: <FileText className="h-4 w-4" />,
  so_sent: <Send className="h-4 w-4" />,
};

/** Compact, clickable KPI card — one consistent brand accent for all metrics. */
function KpiCard({ row, onOpen }: { row: MetricRow; onOpen: (to: string) => void }) {
  const clickable = !!row.to;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => row.to && onOpen(row.to)}
      aria-label={`${row.label}: ${row.count}${row.hint ? '. ' + row.hint : ''}${
        clickable ? '. Open list' : ''
      }`}
      className={classNames(
        'group flex flex-col rounded-xl border border-surface-200 bg-white p-3.5 text-left shadow-sm transition',
        clickable &&
          'cursor-pointer hover:border-brand-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          {KPI_ICON[row.key]}
        </span>
        {clickable && (
          <ArrowUpRight className="h-4 w-4 text-surface-300 transition group-hover:text-brand-500" />
        )}
      </div>
      <span className="mt-2.5 text-[26px] font-bold leading-8 tracking-tight tabular-nums text-surface-900">
        {row.count}
      </span>
      <span className="mt-0.5 text-[13px] font-semibold leading-[18px] text-surface-700">
        {row.label}
      </span>
      {row.hint && <span className="mt-0.5 text-[11px] leading-4 text-surface-400">{row.hint}</span>}
    </button>
  );
}

const STAGE_META: Record<string, { name: string; bar: string; track: string }> = {
  no_followup: { name: 'No Follow-up', bar: 'bg-slate-400', track: 'bg-slate-100' },
  budgetary: { name: 'Budgetary', bar: 'bg-teal-500', track: 'bg-teal-100' },
  negotiation: { name: 'Negotiation', bar: 'bg-amber-500', track: 'bg-amber-100' },
  finalise: { name: 'Finalise', bar: 'bg-violet-500', track: 'bg-violet-100' },
};

/** Quotation-stage card with a compact proportional progress bar. */
function StageCard({
  row,
  max,
  onOpen,
}: {
  row: MetricRow;
  max: number;
  onOpen: (to: string) => void;
}) {
  const meta = STAGE_META[row.key];
  const pct = max > 0 && row.count > 0 ? Math.max(6, Math.round((row.count / max) * 100)) : 0;
  const clickable = !!row.to;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => row.to && onOpen(row.to)}
      aria-label={`Quotation stage ${meta.name}: ${row.count}. Open filtered quotations`}
      className={classNames(
        'group flex flex-col rounded-xl border border-surface-200 bg-white p-3.5 text-left shadow-sm transition',
        clickable &&
          'cursor-pointer hover:border-surface-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-surface-700">{meta.name}</span>
        <span className="text-lg font-bold leading-6 tabular-nums text-surface-900">{row.count}</span>
      </div>
      <div className={classNames('mt-2 h-1.5 w-full overflow-hidden rounded-full', meta.track)}>
        <div
          className={classNames('h-full rounded-full transition-all', meta.bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="mt-1.5 text-[11px] text-surface-400">Quotation stage</span>
    </button>
  );
}

// -- Action Required --------------------------------------------------------
const ACTION_EDGE: Record<ActionRow['severity'], string> = {
  high: 'border-l-rose-500',
  medium: 'border-l-amber-500',
  low: 'border-l-brand-400',
};

function ActionCard({ row, onOpen }: { row: ActionRow; onOpen: (to: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.to)}
      aria-label={`${row.label}: ${row.count}. ${row.description}`}
      className={classNames(
        'group flex h-full items-start gap-3 rounded-xl border border-surface-200 border-l-4 bg-white p-3.5 text-left shadow-sm transition hover:border-surface-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
        ACTION_EDGE[row.severity]
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-[18px] text-surface-800">
          {row.label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-4 text-surface-500">{row.description}</span>
        {row.sub && (
          <span className="mt-1 inline-block text-[11px] font-medium text-surface-500">
            {row.sub.label}: <span className="text-surface-700">{row.sub.count}</span>
          </span>
        )}
      </span>
      <span className="flex-none text-xl font-bold leading-7 tabular-nums text-surface-900">
        {row.count}
      </span>
    </button>
  );
}

// -- Overdue Tasks ----------------------------------------------------------
function OverdueItem({ row, onOpen }: { row: OverdueRow; onOpen: (to: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.to)}
      aria-label={`${row.label}: ${row.count}. ${row.note}`}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-[18px] text-surface-800">
          {row.label}
        </span>
        <span className="block text-[11px] leading-4 text-surface-400">{row.note}</span>
      </span>
      <span
        className={classNames(
          'flex-none rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums',
          row.count > 0 ? 'bg-rose-50 text-rose-600' : 'bg-surface-100 text-surface-500'
        )}
      >
        {row.count}
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-surface-300 transition group-hover:text-surface-500" />
    </button>
  );
}

function OverdueColumn({
  title,
  total,
  rows,
  onOpen,
}: {
  title: string;
  total: number;
  rows: OverdueRow[];
  onOpen: (to: string) => void;
}) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-2.5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between border-b border-surface-100 px-1 pb-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-surface-500">{title}</h3>
        <span className="text-xs font-semibold text-surface-600 tabular-nums">{total}</span>
      </div>
      <div className="space-y-0.5">
        {rows.map((row) => (
          <OverdueItem key={row.key} row={row} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { quotations, salesOrders, role, visibleOffices } = useApp();
  const inScope = useOfficeScope();
  const navigate = useNavigate();
  const onOpen = (to: string) => navigate(to);

  // Branch options mirror the Sales Office Master; office-scoped roles only see
  // their own office. Each section filters independently.
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
  const actionF = useSectionFilter();
  const overdueF = useSectionFilter();

  const qBy = (q: (typeof baseQuotations)[number]) => ({ officeId: q.officeId, date: q.createdDate });
  const soBy = (s: (typeof baseSalesOrders)[number]) => ({ officeId: s.officeId, date: s.createdDate });

  const pipeline = useMemo(() => {
    const q = scopeRecords(baseQuotations, pipelineF.filter, qBy);
    const so = scopeRecords(baseSalesOrders, pipelineF.filter, soBy);
    return pipelineFunnel(q, so);
  }, [baseQuotations, baseSalesOrders, pipelineF.filter]);

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

  // Split the pipeline rows into the summary KPIs and the quotation-stage cards.
  const byKey = useMemo(
    () => Object.fromEntries(pipeline.map((r) => [r.key, r] as const)),
    [pipeline]
  );
  const summary = ['queries', 'quotes_sent', 'so_sent']
    .map((k) => byKey[k])
    .filter(Boolean) as MetricRow[];
  const stages = ['no_followup', 'budgetary', 'negotiation', 'finalise']
    .map((k) => byKey[k])
    .filter(Boolean) as MetricRow[];
  const stageMax = Math.max(1, ...stages.map((s) => s.count));

  return (
    <>
      <PageHeader
        title="Operations Dashboard"
        description="Pipeline health and tasks requiring attention across your sales offices."
      />

      <div className="flex flex-col gap-4 md:gap-5">
        {/* 1 — PIPELINE OVERVIEW */}
        <DashSection
          title="Pipeline Overview"
          icon={<Filter className="h-4 w-4 text-brand-500" />}
          filters={<SectionFilters state={pipelineF} branchOptions={branchOptions} />}
        >
          {/* Summary metrics row */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {summary.map((row) => (
              <KpiCard key={row.key} row={row} onOpen={onOpen} />
            ))}
          </div>

          {/* Quotation Stage Distribution */}
          <div className="mt-4">
            <h3 className="mb-2 text-[13px] font-semibold text-surface-600">
              Quotation Stage Distribution
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {stages.map((row) => (
                <StageCard key={row.key} row={row} max={stageMax} onOpen={onOpen} />
              ))}
            </div>
          </div>
        </DashSection>

        {/* 2 — ACTION REQUIRED */}
        <DashSection
          title="Action Required"
          icon={<ListChecks className="h-4 w-4 text-amber-500" />}
          filters={<SectionFilters state={actionF} branchOptions={branchOptions} />}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map((row) => (
              <ActionCard key={row.key} row={row} onOpen={onOpen} />
            ))}
          </div>
        </DashSection>

        {/* 3 — OVERDUE TASKS */}
        <DashSection
          title="Overdue Tasks"
          icon={<CalendarClock className="h-4 w-4 text-rose-500" />}
          filters={<SectionFilters state={overdueF} branchOptions={branchOptions} />}
        >
          {/* Compact summary */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span
              className={classNames(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold',
                overdue.total > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" /> Total Overdue: {overdue.total}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-50 px-2.5 py-1 text-[13px] text-surface-600">
              <LayoutGrid className="h-3.5 w-3.5 text-surface-400" /> Internal Ops:{' '}
              <span className="font-semibold text-surface-800">{overdue.internalTotal}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-50 px-2.5 py-1 text-[13px] text-surface-600">
              <Send className="h-3.5 w-3.5 text-surface-400" /> Sales Team:{' '}
              <span className="font-semibold text-surface-800">{overdue.salesTotal}</span>
            </span>
          </div>

          {/* Two equal columns */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <OverdueColumn
              title="Internal Ops"
              total={overdue.internalTotal}
              rows={overdue.internalOps}
              onOpen={onOpen}
            />
            <OverdueColumn
              title="Sales Team"
              total={overdue.salesTotal}
              rows={overdue.salesTeam}
              onOpen={onOpen}
            />
          </div>
        </DashSection>
      </div>
    </>
  );
}
