import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Filter,
  ListChecks,
  CalendarClock,
  RotateCcw,
  ChevronRight,
  ArrowRight,
  AlertTriangle,
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
  type FunnelStage,
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

// Compact date input — kept small so per-section filters never dominate a card.
const DATE_INPUT =
  'h-full w-[112px] bg-transparent px-2 text-[12px] text-surface-700 focus:outline-none';

function SectionFilters({
  state,
  branchOptions,
}: {
  state: SectionFilterState;
  branchOptions: { value: string; label: string }[];
}) {
  const { branch, setBranch, from, setFrom, to, setTo, error, dirty, reset } = state;
  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterSelect
          value={branch === 'all' ? '' : branch}
          onChange={(v) => setBranch(v || 'all')}
          placeholder="All Branches"
          options={branchOptions}
          className="!h-8 min-w-[132px] flex-none !text-[12px]"
        />
        {/* From/To grouped into a single compact date-range control. */}
        <div
          className={classNames(
            'flex h-8 flex-none items-center rounded-lg border bg-white shadow-sm transition',
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
            className="inline-flex flex-none items-center gap-1 rounded text-[11px] font-semibold text-surface-500 transition hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        )}
      </div>
      {error && <p className="text-[11px] font-medium text-rose-600">{error}</p>}
    </div>
  );
}

function DashSection({
  title,
  icon,
  filters,
  className,
  children,
}: {
  title: string;
  icon: ReactNode;
  filters: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={classNames('card flex flex-col overflow-hidden', className)}>
      <div className="flex flex-col gap-2 border-b border-surface-100 px-4 py-3 sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex flex-none items-center gap-2">
          {icon}
          <h2 className="whitespace-nowrap text-[16px] font-semibold leading-5 text-surface-800">
            {title}
          </h2>
        </div>
        {filters}
      </div>
      <div className="flex-1 p-3.5 sm:p-4">{children}</div>
    </section>
  );
}

// ===========================================================================
// 1 — PIPELINE FUNNEL
// ===========================================================================
// First layer a dark slate (the raw intake), every stage after it a
// progressively lighter Flowtech red — no rainbow, orange reserved for
// warnings elsewhere. Widths taper by position (not by value) so even the
// smallest layer stays readable.
const FUNNEL_FILL: Record<string, string> = {
  queries: 'bg-slate-700',
  quotes_sent: 'bg-brand-800',
  budgetary: 'bg-brand-700',
  negotiation: 'bg-brand-600',
  finalised: 'bg-brand-500',
  so_sent: 'bg-brand-400',
};

function FunnelLayer({
  stage,
  index,
  total,
  onOpen,
}: {
  stage: FunnelStage;
  index: number;
  total: number;
  onOpen: (to: string) => void;
}) {
  // Linear positional taper: widest at the top, ~50% at the base. The taper is
  // applied only from `sm` up (via a CSS var) so narrow/mobile layers stay
  // full-width and every label — including the smallest stage — stays readable.
  const width = 100 - (index / Math.max(1, total - 1)) * 52;
  return (
    <div
      className="group relative mx-auto w-full sm:[max-width:var(--fw)]"
      style={{ '--fw': `${width}%` } as CSSProperties}
    >
      <button
        type="button"
        onClick={() => onOpen(stage.to)}
        aria-label={`${stage.label}: ${stage.count}. ${
          stage.fromPrevPct !== null ? `${stage.fromPrevPct}% from previous stage, ` : ''
        }${stage.overallPct}% of queries received. Open filtered list.`}
        className={classNames(
          'flex w-full items-center justify-between gap-3 rounded-[10px] px-4 py-3 text-left text-white shadow-sm transition',
          'hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-500/60',
          FUNNEL_FILL[stage.key]
        )}
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-4">{stage.label}</span>
          <span className="mt-0.5 block text-[11px] font-medium leading-4 text-white/75">
            {stage.fromPrevPct === null ? 'Pipeline entry' : `${stage.fromPrevPct}% from previous`}
          </span>
        </span>
        <span className="flex flex-none items-center gap-2">
          <span className="text-right">
            <span className="block text-[22px] font-bold leading-6 tabular-nums">{stage.count}</span>
            <span className="block text-[11px] leading-4 text-white/75">{stage.overallPct}% overall</span>
          </span>
          <ArrowRight className="h-4 w-4 flex-none text-white/50 transition group-hover:translate-x-0.5 group-hover:text-white" />
        </span>
      </button>

      {/* Hover tooltip — stage count, step conversion, overall conversion. */}
      <div
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 w-56 -translate-x-1/2 rounded-lg border border-surface-200 bg-white p-2.5 text-[12px] text-surface-700 opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100"
      >
        <p className="mb-1 text-[12px] font-semibold text-surface-800">{stage.label}</p>
        <dl className="space-y-0.5">
          <div className="flex justify-between gap-3">
            <dt className="text-surface-500">Stage count</dt>
            <dd className="font-semibold tabular-nums text-surface-800">{stage.count}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-surface-500">From previous</dt>
            <dd className="font-semibold tabular-nums text-surface-800">
              {stage.fromPrevPct === null ? '—' : `${stage.fromPrevPct}%`}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-surface-500">Overall conversion</dt>
            <dd className="font-semibold tabular-nums text-surface-800">{stage.overallPct}%</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function PipelineFunnel({ stages, onOpen }: { stages: FunnelStage[]; onOpen: (to: string) => void }) {
  return (
    <div className="space-y-2 pb-6">
      {stages.map((stage, i) => (
        <FunnelLayer key={stage.key} stage={stage} index={i} total={stages.length} onOpen={onOpen} />
      ))}
    </div>
  );
}

// ===========================================================================
// 2 — ACTION REQUIRED  (one compact card, clickable rows)
// ===========================================================================
const ACTION_TONE: Record<ActionRow['tone'], { edge: string; count: string }> = {
  red: { edge: 'border-l-rose-500', count: 'text-rose-600' },
  orange: { edge: 'border-l-amber-500', count: 'text-amber-600' },
  purple: { edge: 'border-l-violet-500', count: 'text-violet-600' },
  slate: { edge: 'border-l-surface-300', count: 'text-surface-600' },
};

function ActionRowItem({ row, onOpen }: { row: ActionRow; onOpen: (to: string) => void }) {
  const tone = ACTION_TONE[row.tone];
  return (
    <button
      type="button"
      onClick={() => onOpen(row.to)}
      aria-label={`${row.label}: ${row.count}. ${row.description}`}
      className={classNames(
        'group flex min-h-[64px] w-full items-center gap-3 border-l-[3px] px-3 py-2.5 text-left transition-colors',
        'hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/40',
        tone.edge
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-[18px] text-surface-800">
          {row.label}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-4 text-surface-500">
          {row.description}
        </span>
      </span>
      <span className={classNames('flex-none text-[20px] font-bold leading-6 tabular-nums', tone.count)}>
        {row.count}
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-surface-300 transition group-hover:translate-x-0.5 group-hover:text-surface-500" />
    </button>
  );
}

function ActionList({ rows, onOpen }: { rows: ActionRow[]; onOpen: (to: string) => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 divide-y divide-surface-100">
        {rows.map((row) => (
          <ActionRowItem key={row.key} row={row} onOpen={onOpen} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onOpen('/inbox')}
        className="mt-1 inline-flex items-center gap-1 self-start rounded px-1 text-[12px] font-semibold text-brand-600 transition hover:text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
      >
        View all actions <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ===========================================================================
// 3 — OVERDUE TASKS
// ===========================================================================
function OverdueItem({ row, onOpen }: { row: OverdueRow; onOpen: (to: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row.to)}
      aria-label={`${row.label}: ${row.count}. ${row.note}`}
      className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-[18px] text-surface-800">
          {row.label}
        </span>
        <span className="block truncate text-[12px] leading-4 text-surface-400">{row.note}</span>
      </span>
      <span
        className={classNames(
          'flex-none rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums',
          row.count > 0 ? 'bg-rose-50 text-rose-600' : 'bg-surface-100 text-surface-400'
        )}
      >
        {row.count}
      </span>
      <ArrowRight className="h-4 w-4 flex-none text-surface-300 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
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
        <span className="rounded-md bg-surface-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-surface-600">
          {total}
        </span>
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

  const funnel = useMemo(() => {
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

  return (
    <>
      <PageHeader
        title="Operations Dashboard"
        description="Pipeline health and tasks requiring attention across your sales offices."
      />

      {/* 12-column responsive grid: Funnel (8) + Action Required (4) on the top
          row, Overdue Tasks full-width below. Everything stacks under 1180px. */}
      <div className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-12 min-[1180px]:gap-5">
        {/* 1 — PIPELINE FUNNEL */}
        <DashSection
          title="Pipeline Funnel"
          icon={<Filter className="h-4 w-4 text-brand-500" />}
          filters={<SectionFilters state={pipelineF} branchOptions={branchOptions} />}
          className="min-[1180px]:col-span-8"
        >
          <PipelineFunnel stages={funnel} onOpen={onOpen} />
        </DashSection>

        {/* 2 — ACTION REQUIRED */}
        <DashSection
          title="Action Required"
          icon={<ListChecks className="h-4 w-4 text-amber-500" />}
          filters={<SectionFilters state={actionF} branchOptions={branchOptions} />}
          className="min-[1180px]:col-span-4"
        >
          <ActionList rows={actions} onOpen={onOpen} />
        </DashSection>

        {/* 3 — OVERDUE TASKS */}
        <DashSection
          title="Overdue Tasks"
          icon={<CalendarClock className="h-4 w-4 text-rose-500" />}
          filters={<SectionFilters state={overdueF} branchOptions={branchOptions} />}
          className="min-[1180px]:col-span-12"
        >
          {/* Combined summary headline. */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={classNames(
                'inline-flex items-center gap-1.5 text-[15px] font-bold',
                overdue.total > 0 ? 'text-rose-600' : 'text-emerald-600'
              )}
            >
              <AlertTriangle className="h-4 w-4" />
              {overdue.total} overdue {overdue.total === 1 ? 'task' : 'tasks'}
            </span>
            <span className="text-[12px] text-surface-500">
              Internal Ops <span className="font-semibold text-surface-700">{overdue.internalTotal}</span>
              <span className="mx-1.5 text-surface-300">·</span>
              Sales Team <span className="font-semibold text-surface-700">{overdue.salesTotal}</span>
            </span>
          </div>

          {/* Two balanced columns. */}
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
