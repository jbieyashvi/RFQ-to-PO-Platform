import { useMemo, useState } from 'react';
import {
  Inbox,
  Send,
  FileText,
  FileSpreadsheet,
  Download,
  Printer,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  Minus,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { Button, FilterSelect, KpiCard, SectionCard, EmptyState } from '@/components/ui';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { classNames, downloadCSV, formatDate, formatNumber, TODAY } from '@/lib/format';
import {
  QUOTATION_DATE,
  SALES_ORDER_DATE,
  inRange,
  computeMetrics,
  officeBreakdown,
  topPerformers,
  comparisonPeriods,
  pctChange,
  toISO,
  METRIC_LABELS,
  type ComparisonMode,
  type Metrics,
} from '@/lib/mis';

// Consistent bar colours for the four metrics — brand red for the headline
// SO metric, muted neutrals elsewhere so the report stays calm.
const METRIC_BAR: Record<keyof Metrics, string> = {
  inquiries: 'bg-slate-400',
  quotesSent: 'bg-blue-400',
  posReceived: 'bg-amber-400',
  sosSent: 'bg-brand-500',
};

const DATE_INPUT =
  'h-full w-[112px] bg-transparent px-2 text-[12px] text-surface-700 focus:outline-none';

export default function MisReports() {
  const { quotations, salesOrders, role, can, visibleOffices, addToast } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();

  // ---- Filters: Date Range · Office · Weekly / Monthly ----------------------
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [office, setOffice] = useState(''); // '' = all in-scope offices
  const [mode, setMode] = useState<ComparisonMode>('weekly');

  const rangeError = from && to && from > to ? 'From date must be on or before To date.' : '';
  const dirty = !!(from || to || office);
  const resetFilters = () => {
    setFrom('');
    setTo('');
    setOffice('');
  };

  const canDownload = can('mis_reports', 'download');

  // Offices the acting user may see (role + header office switch), then the
  // page's own Office filter on top. Office-scoped roles are pinned to their
  // office so the local filter is only offered when >1 office is visible.
  const scopedOffices = useMemo(
    () => visibleOffices.filter((o) => inScope(o.id)),
    [visibleOffices, inScope]
  );
  const reportOffices = useMemo(
    () => scopedOffices.filter((o) => !office || o.id === office),
    [scopedOffices, office]
  );

  // Role/office-scoped base lists — same shared datasets as the operational
  // screens, so every MIS count equals the corresponding module list.
  const officeIds = useMemo(() => new Set(reportOffices.map((o) => o.id)), [reportOffices]);
  const baseQuotations = useMemo(
    () => quotations.filter((q) => officeIds.has(q.officeId)),
    [quotations, officeIds]
  );
  const baseSalesOrders = useMemo(
    () => salesOrders.filter((s) => officeIds.has(s.officeId)),
    [salesOrders, officeIds]
  );

  // Date-range slice (an invalid range is ignored, mirroring the Dashboard).
  const rangeOk = !rangeError;
  const rangedQuotations = useMemo(
    () => baseQuotations.filter((q) => !rangeOk || inRange(QUOTATION_DATE(q), from, to)),
    [baseQuotations, from, to, rangeOk]
  );
  const rangedSalesOrders = useMemo(
    () => baseSalesOrders.filter((s) => !rangeOk || inRange(SALES_ORDER_DATE(s), from, to)),
    [baseSalesOrders, from, to, rangeOk]
  );

  // ---- Report 0: headline KPIs ---------------------------------------------
  const kpis = useMemo(
    () => computeMetrics(rangedQuotations, rangedSalesOrders),
    [rangedQuotations, rangedSalesOrders]
  );

  // ---- Report 1: office-to-office comparison -------------------------------
  const offices = useMemo(
    () => officeBreakdown(reportOffices, rangedQuotations, rangedSalesOrders),
    [reportOffices, rangedQuotations, rangedSalesOrders]
  );
  const officeMax = useMemo(
    () =>
      Math.max(
        1,
        ...offices.flatMap((o) => METRIC_LABELS.map((m) => o[m.key]))
      ),
    [offices]
  );

  // ---- Report 2: within-office weekly / monthly comparison -----------------
  // Periods are fixed windows anchored on the prototype's "today" — the page's
  // custom Date Range deliberately does not apply here (the period IS the range).
  const periods = useMemo(() => comparisonPeriods(mode), [mode]);
  const comparison = useMemo(() => {
    const slice = (f: string, t: string) =>
      computeMetrics(
        baseQuotations.filter((q) => inRange(QUOTATION_DATE(q), f, t)),
        baseSalesOrders.filter((s) => inRange(SALES_ORDER_DATE(s), f, t))
      );
    return {
      current: slice(periods.current.from, periods.current.to),
      previous: slice(periods.previous.from, periods.previous.to),
    };
  }, [baseQuotations, baseSalesOrders, periods]);
  const comparisonMax = useMemo(
    () =>
      Math.max(
        1,
        ...METRIC_LABELS.map((m) => Math.max(comparison.current[m.key], comparison.previous[m.key]))
      ),
    [comparison]
  );

  // ---- Report 3: top performer per office ----------------------------------
  const performers = useMemo(
    () => topPerformers(reportOffices, rangedQuotations, rangedSalesOrders),
    [reportOffices, rangedQuotations, rangedSalesOrders]
  );

  // ---- Downloads (filtered data only) --------------------------------------
  const filterSummary = () => {
    const officeLabel = office
      ? scopedOffices.find((o) => o.id === office)?.name ?? office
      : scopedOffices.length > 1
        ? 'All Offices'
        : scopedOffices[0]?.name ?? '—';
    const range =
      from || to ? `${from ? formatDate(from) : 'Start'} – ${to ? formatDate(to) : 'Today'}` : 'All dates';
    return { officeLabel, range };
  };

  const downloadExcel = () => {
    const { officeLabel, range } = filterSummary();
    const rows: (string | number)[][] = [
      ['Flowtech — MIS Report'],
      ['Generated', formatDate(toISO(TODAY))],
      ['Office', officeLabel],
      ['Date Range', range],
      ['Comparison', mode === 'weekly' ? 'Weekly' : 'Monthly'],
      [],
      ['Summary'],
      ['Metric', 'Count'],
      ...METRIC_LABELS.map((m) => [m.label, kpis[m.key]] as (string | number)[]),
      [],
      ['Office-to-Office Comparison'],
      ['Office', ...METRIC_LABELS.map((m) => m.label)],
      ...offices.map((o) => [o.officeName, ...METRIC_LABELS.map((m) => o[m.key])]),
      [],
      [`${periods.current.label} vs ${periods.previous.label}`],
      [
        'Metric',
        `${periods.current.label} (${formatDate(periods.current.from)} – ${formatDate(periods.current.to)})`,
        `${periods.previous.label} (${formatDate(periods.previous.from)} – ${formatDate(periods.previous.to)})`,
        'Change %',
      ],
      ...METRIC_LABELS.map((m) => {
        const change = pctChange(comparison.current[m.key], comparison.previous[m.key]);
        return [
          m.label,
          comparison.current[m.key],
          comparison.previous[m.key],
          change === null ? 'New' : `${change}%`,
        ] as (string | number)[];
      }),
      [],
      ['Top Performer per Office'],
      ['Office', 'Employee', 'Inquiries Handled', 'Quotes Sent', 'POs Received', 'SOs Generated'],
      ...performers.map((p) => [p.officeName, p.owner, p.inquiries, p.quotesSent, p.posReceived, p.sosSent]),
    ];
    const officeSlug = office ? officeLabel.replace(/\s+/g, '-') : 'All-Offices';
    downloadCSV(`MIS-Report_${officeSlug}_${toISO(TODAY)}.csv`, rows);
    addToast({ type: 'success', title: 'Excel download started', message: 'The report contains the currently filtered data only.' });
  };

  const downloadPdf = () => {
    const { officeLabel, range } = filterSummary();
    const td = (v: string | number, right = false) =>
      `<td style="padding:6px 10px;border:1px solid #e2e8f0;${right ? 'text-align:right;' : ''}">${v}</td>`;
    const th = (v: string, right = false) =>
      `<th style="padding:6px 10px;border:1px solid #e2e8f0;background:#f8fafc;text-align:${right ? 'right' : 'left'};font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#475569;">${v}</th>`;
    const table = (head: string[], body: (string | number)[][], rightFrom = 1) =>
      `<table style="border-collapse:collapse;width:100%;font-size:12px;margin:6px 0 18px;">
        <thead><tr>${head.map((h, i) => th(h, i >= rightFrom)).join('')}</tr></thead>
        <tbody>${body.map((r) => `<tr>${r.map((c, i) => td(c, i >= rightFrom)).join('')}</tr>`).join('')}</tbody>
      </table>`;
    const section = (title: string) =>
      `<h2 style="font-size:14px;margin:18px 0 4px;color:#0f172a;">${title}</h2>`;

    const html = `<!doctype html><html><head><title>MIS Report — Flowtech</title></head>
      <body style="font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#1e293b;padding:28px;">
        <div style="border-bottom:3px solid #dc2626;padding-bottom:10px;margin-bottom:14px;">
          <h1 style="font-size:18px;margin:0;color:#dc2626;">Flowtech — MIS Report</h1>
          <p style="font-size:12px;margin:4px 0 0;color:#64748b;">
            Office: <b>${officeLabel}</b> &nbsp;·&nbsp; Date Range: <b>${range}</b> &nbsp;·&nbsp;
            Comparison: <b>${mode === 'weekly' ? 'Weekly' : 'Monthly'}</b> &nbsp;·&nbsp;
            Generated: <b>${formatDate(toISO(TODAY))}</b>
          </p>
        </div>
        ${section('Summary')}
        ${table(['Metric', 'Count'], METRIC_LABELS.map((m) => [m.label, kpis[m.key]]))}
        ${section('Office-to-Office Comparison')}
        ${table(
          ['Office', ...METRIC_LABELS.map((m) => m.label)],
          offices.map((o) => [o.officeName, ...METRIC_LABELS.map((m) => o[m.key])])
        )}
        ${section(`${periods.current.label} vs ${periods.previous.label}`)}
        ${table(
          ['Metric', periods.current.label, periods.previous.label, 'Change'],
          METRIC_LABELS.map((m) => {
            const change = pctChange(comparison.current[m.key], comparison.previous[m.key]);
            return [m.label, comparison.current[m.key], comparison.previous[m.key], change === null ? 'New' : `${change}%`];
          })
        )}
        ${section('Top Performer per Office')}
        ${table(
          ['Office', 'Employee', 'Inquiries Handled', 'Quotes Sent', 'POs Received', 'SOs Generated'],
          performers.map((p) => [p.officeName, p.owner, p.inquiries, p.quotesSent, p.posReceived, p.sosSent]),
          2
        )}
      </body></html>`;

    // Print via a hidden iframe — the browser's print dialog offers "Save as
    // PDF". No PDF library is bundled in this frontend-only prototype.
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow?.document;
    doc?.open();
    doc?.write(html);
    doc?.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => document.body.removeChild(frame), 60000);
    addToast({ type: 'info', title: 'PDF export ready', message: 'Choose “Save as PDF” in the print dialog.' });
  };

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="MIS Reports"
          description="Office performance, period comparisons and top performers."
          crumbs={[{ label: 'Management' }, { label: 'MIS Reports' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  const kpiSub =
    from || to
      ? `${from ? formatDate(from) : 'Start'} – ${to ? formatDate(to) : 'Today'}`
      : 'All dates';

  return (
    <>
      <PageHeader
        title="MIS Reports"
        description="Office performance, period comparisons and top performers — same live data as the operational screens."
        crumbs={[{ label: 'Management' }, { label: 'MIS Reports' }]}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Download className="h-4 w-4" />}
              disabled={!canDownload}
              title={canDownload ? 'Download the filtered report as Excel (CSV)' : 'Your role cannot download reports'}
              onClick={downloadExcel}
            >
              Download Excel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Printer className="h-4 w-4" />}
              disabled={!canDownload}
              title={canDownload ? 'Export the filtered report as PDF' : 'Your role cannot download reports'}
              onClick={downloadPdf}
            >
              Download PDF
            </Button>
          </>
        }
      />

      {/* ---- Filters -------------------------------------------------------- */}
      <div className="card mb-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Date range */}
          <div
            className={classNames(
              'flex h-8 flex-none items-center rounded-lg border bg-white shadow-sm transition',
              rangeError
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

          {/* Office — only offered when more than one office is visible */}
          {scopedOffices.length > 1 && (
            <FilterSelect
              value={office}
              onChange={setOffice}
              placeholder="All offices"
              options={scopedOffices.map((o) => ({ value: o.id, label: o.name }))}
            />
          )}

          {/* Weekly / Monthly comparison toggle */}
          <div className="flex h-8 flex-none items-center rounded-lg border border-surface-200 bg-surface-50 p-0.5">
            {(['weekly', 'monthly'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={classNames(
                  'h-7 rounded-md px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                  mode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-500 hover:text-surface-700'
                )}
              >
                {m === 'weekly' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>

          {dirty && (
            <button
              onClick={resetFilters}
              className="inline-flex flex-none items-center gap-1 rounded text-[11px] font-semibold text-surface-500 transition hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}

          {role !== 'super_admin' && scopedOffices.length === 1 && (
            <span className="ml-auto text-[11px] text-surface-400">
              Scoped to {scopedOffices[0].name}
            </span>
          )}
        </div>
        {rangeError && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{rangeError}</p>}
      </div>

      {/* ---- KPI cards ------------------------------------------------------ */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Inquiries Received" value={formatNumber(kpis.inquiries)} sub={kpiSub} accent="slate" icon={<Inbox className="h-4 w-4" />} />
        <KpiCard label="Quotes Sent" value={formatNumber(kpis.quotesSent)} sub={kpiSub} accent="blue" icon={<Send className="h-4 w-4" />} />
        <KpiCard label="POs Received" value={formatNumber(kpis.posReceived)} sub={kpiSub} accent="amber" icon={<FileText className="h-4 w-4" />} />
        <KpiCard label="SOs Sent" value={formatNumber(kpis.sosSent)} sub={kpiSub} accent="brand" icon={<FileSpreadsheet className="h-4 w-4" />} />
      </div>

      {/* ---- Report 1 + 2 side by side -------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 min-[1180px]:grid-cols-12 min-[1180px]:gap-5">
        {/* Office-to-office comparison */}
        <SectionCard
          title="Office-to-Office Comparison"
          description="Inquiries, quotes, POs and SOs per sales office for the selected date range."
          className="min-[1180px]:col-span-7"
          bodyClassName="p-0"
        >
          {offices.length === 0 ? (
            <EmptyState title="No offices in scope" message="Adjust the office filter to see the comparison." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-surface-200 bg-surface-50 text-left text-[11px] uppercase tracking-wide text-surface-500">
                    <th className="px-4 py-2.5 font-semibold">Office</th>
                    {METRIC_LABELS.map((m) => (
                      <th key={m.key} className="px-3 py-2.5 text-right font-semibold">{m.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {offices.map((o) => (
                    <tr key={o.officeId} className="border-b border-surface-100 last:border-0">
                      <td className="px-4 py-2.5 font-medium text-surface-800">{o.officeName}</td>
                      {METRIC_LABELS.map((m) => (
                        <td key={m.key} className="px-3 py-2.5">
                          <div className="flex items-center justify-end gap-2">
                            <span className="w-7 text-right font-medium tabular-nums text-surface-800">
                              {formatNumber(o[m.key])}
                            </span>
                            <span className="h-1.5 w-14 flex-none overflow-hidden rounded-full bg-surface-100">
                              <span
                                className={classNames('block h-full rounded-full', METRIC_BAR[m.key])}
                                style={{ width: `${Math.round((o[m.key] / officeMax) * 100)}%` }}
                              />
                            </span>
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Weekly / Monthly comparison */}
        <SectionCard
          title={`${periods.current.label} vs ${periods.previous.label}`}
          description={`${formatDate(periods.current.from, { short: true })} – ${formatDate(periods.current.to, { short: true })} vs ${formatDate(periods.previous.from, { short: true })} – ${formatDate(periods.previous.to, { short: true })}${office ? ` · ${scopedOffices.find((o) => o.id === office)?.name}` : ''}`}
          className="min-[1180px]:col-span-5"
        >
          <div className="space-y-4">
            {METRIC_LABELS.map((m) => {
              const cur = comparison.current[m.key];
              const prev = comparison.previous[m.key];
              const change = pctChange(cur, prev);
              return (
                <div key={m.key}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[12px] font-medium text-surface-600">{m.label}</span>
                    <span
                      className={classNames(
                        'inline-flex items-center gap-0.5 text-[11px] font-semibold',
                        change === null || change > 0
                          ? 'text-emerald-600'
                          : change < 0
                            ? 'text-rose-600'
                            : 'text-surface-400'
                      )}
                    >
                      {change === null ? (
                        <>
                          <TrendingUp className="h-3 w-3" /> New
                        </>
                      ) : change > 0 ? (
                        <>
                          <TrendingUp className="h-3 w-3" /> +{change}%
                        </>
                      ) : change < 0 ? (
                        <>
                          <TrendingDown className="h-3 w-3" /> {change}%
                        </>
                      ) : (
                        <>
                          <Minus className="h-3 w-3" /> 0%
                        </>
                      )}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-16 flex-none text-[10px] uppercase tracking-wide text-surface-400">
                        {periods.current.label}
                      </span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-100">
                        <span
                          className={classNames('block h-full rounded-full', METRIC_BAR[m.key])}
                          style={{ width: `${Math.round((cur / comparisonMax) * 100)}%` }}
                        />
                      </span>
                      <span className="w-6 flex-none text-right text-[12px] font-semibold tabular-nums text-surface-800">
                        {cur}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-16 flex-none text-[10px] uppercase tracking-wide text-surface-400">
                        {periods.previous.label}
                      </span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-100">
                        <span
                          className={classNames('block h-full rounded-full opacity-40', METRIC_BAR[m.key])}
                          style={{ width: `${Math.round((prev / comparisonMax) * 100)}%` }}
                        />
                      </span>
                      <span className="w-6 flex-none text-right text-[12px] tabular-nums text-surface-500">
                        {prev}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* ---- Report 3: top performer per office ------------------------------ */}
      <SectionCard
        title="Top Performer per Office"
        description="The leading employee per office for the selected date range, ranked by SOs generated."
        className="mt-4 min-[1180px]:mt-5"
        bodyClassName="p-0"
      >
        {performers.length === 0 ? (
          <EmptyState
            title="No activity in the selected range"
            message="No employee has inquiries, quotes, POs or SOs in scope. Widen the date range or clear filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-left text-[11px] uppercase tracking-wide text-surface-500">
                  <th className="px-4 py-2.5 font-semibold">Office</th>
                  <th className="px-3 py-2.5 font-semibold">Employee</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Inquiries Handled</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Quotes Sent</th>
                  <th className="px-3 py-2.5 text-right font-semibold">POs Received</th>
                  <th className="px-3 py-2.5 text-right font-semibold">SOs Generated</th>
                </tr>
              </thead>
              <tbody>
                {performers.map((p) => (
                  <tr key={p.officeId} className="border-b border-surface-100 last:border-0">
                    <td className="px-4 py-2.5 text-surface-600">{p.officeName}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700">
                          {p.owner.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                        </span>
                        <span className="font-medium text-surface-800">{p.owner}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-surface-700">{p.inquiries}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-surface-700">{p.quotesSent}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-surface-700">{p.posReceived}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-surface-800">{p.sosSent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
