import { useMemo, useState } from 'react';
import {
  Inbox,
  Send,
  FileText,
  FileSpreadsheet,
  Download,
  Printer,
  RotateCcw,
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
  reportPeriod,
  toISO,
  METRIC_LABELS,
  PERFORMANCE_WEIGHTS,
  type Metrics,
  type PeriodMode,
} from '@/lib/mis';

// The two reporting windows the Weekly / Monthly toggle applies, computed once
// from the prototype's fixed "today".
const PERIOD_PRESETS: Record<PeriodMode, ReturnType<typeof reportPeriod>> = {
  weekly: reportPeriod('weekly'),
  monthly: reportPeriod('monthly'),
};

// One phrasing of the ranking rule, derived from the weights themselves so the
// on-screen note, the CSV and the PDF can never drift apart from the maths.
const PERFORMANCE_SCORING =
  `${PERFORMANCE_WEIGHTS.inquiries}× inquiries handled + ${PERFORMANCE_WEIGHTS.quotesSent}× quotes sent + ` +
  `${PERFORMANCE_WEIGHTS.posReceived}× POs converted`;

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

  // The Weekly / Monthly toggle drives the Date Range rather than a section of
  // its own: a preset simply writes its window into from/to, so the toggle and
  // the range can never disagree, and clicking the lit preset clears it again.
  const periodMode =
    (['weekly', 'monthly'] as const).find(
      (m) => PERIOD_PRESETS[m].from === from && PERIOD_PRESETS[m].to === to
    ) ?? null;
  const applyPeriod = (m: PeriodMode) => {
    if (periodMode === m) {
      setFrom('');
      setTo('');
      return;
    }
    setFrom(PERIOD_PRESETS[m].from);
    setTo(PERIOD_PRESETS[m].to);
  };
  const periodLabel = periodMode
    ? PERIOD_PRESETS[periodMode].label
    : from || to
      ? 'Custom range'
      : 'All dates';

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
  // The per-column leader, so the strongest office in each metric reads at a
  // glance without spending width on a bar in every one of the eight cells.
  // Only an outright leader is marked — a shared top value tells the reader
  // nothing, and highlighting every tied office would drown the real signal.
  const officeLeaders = useMemo(() => {
    const leaders = {} as Record<keyof Metrics, number | null>;
    METRIC_LABELS.forEach((m) => {
      const values = offices.map((o) => o[m.key]);
      const top = Math.max(0, ...values);
      const unique = top > 0 && values.filter((v) => v === top).length === 1;
      leaders[m.key] = unique ? top : null;
    });
    return leaders;
  }, [offices]);
  const showLeaders = offices.length > 1;

  // ---- Report 2: top performer per office ----------------------------------
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
      ['Period', periodLabel],
      [],
      ['Summary'],
      ['Metric', 'Count'],
      ...METRIC_LABELS.map((m) => [m.label, kpis[m.key]] as (string | number)[]),
      [],
      ['Office-to-Office Comparison'],
      ['Office', ...METRIC_LABELS.map((m) => m.label)],
      ...offices.map((o) => [o.officeName, ...METRIC_LABELS.map((m) => o[m.key])]),
      [],
      ['Top Performer per Office'],
      [`Ranked by sales performance (${PERFORMANCE_SCORING})`],
      ['Office', 'Employee', 'Inquiries Handled', 'Quotes Sent', 'POs Received', 'Performance Score', 'SOs Generated'],
      ...performers.map((p) => [
        p.officeName,
        p.owner,
        p.inquiries,
        p.quotesSent,
        p.posReceived,
        p.score,
        p.sosSent,
      ]),
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
            Period: <b>${periodLabel}</b> &nbsp;·&nbsp;
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
        ${section('Top Performer per Office')}
        <p style="font-size:11px;margin:0 0 2px;color:#64748b;">Ranked by sales performance (${PERFORMANCE_SCORING}).</p>
        ${table(
          ['Office', 'Employee', 'Inquiries Handled', 'Quotes Sent', 'POs Received', 'Performance Score', 'SOs Generated'],
          performers.map((p) => [
            p.officeName,
            p.owner,
            p.inquiries,
            p.quotesSent,
            p.posReceived,
            p.score,
            p.sosSent,
          ]),
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
          description="Office-to-office performance and top performers."
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
        description="Office-to-office performance and top performers — same live data as the operational screens."
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

          {/* Weekly / Monthly — one-click presets for the Date Range above */}
          <div className="flex h-8 flex-none items-center rounded-lg border border-surface-200 bg-surface-50 p-0.5">
            {(['weekly', 'monthly'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => applyPeriod(m)}
                aria-pressed={periodMode === m}
                title={`${PERIOD_PRESETS[m].label}: ${formatDate(PERIOD_PRESETS[m].from)} – ${formatDate(PERIOD_PRESETS[m].to)}`}
                className={classNames(
                  'h-7 rounded-md px-3 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                  periodMode === m ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-500 hover:text-surface-700'
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

      {/* ---- Report 1: office-to-office comparison --------------------------- */}
      <SectionCard
        title="Office-to-Office Comparison"
        description="Inquiries, quotes, POs, the quotation stage split and SOs per sales office for the selected date range."
        bodyClassName="p-0"
      >
        {offices.length === 0 ? (
          <EmptyState title="No offices in scope" message="Adjust the office filter to see the comparison." />
        ) : (
          <table className="w-full table-fixed text-[12px]">
            <thead>
              <tr className="border-b border-surface-200 bg-surface-50 text-left text-[10px] uppercase leading-tight tracking-wide text-surface-500">
                <th className="w-[15%] px-3 py-2 align-bottom font-semibold">Office</th>
                {METRIC_LABELS.map((m) => (
                  <th key={m.key} className="px-2 py-2 text-right align-bottom font-semibold">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.officeId} className="border-b border-surface-100 last:border-0">
                  <td className="truncate px-3 py-2 font-medium text-surface-800">{o.officeName}</td>
                  {METRIC_LABELS.map((m) => {
                    const leads = showLeaders && officeLeaders[m.key] !== null && o[m.key] === officeLeaders[m.key];
                    return (
                      <td
                        key={m.key}
                        title={leads ? `Highest ${m.label} of any office in scope` : undefined}
                        className={classNames(
                          'px-2 py-2 text-right tabular-nums',
                          leads ? 'font-semibold text-brand-700' : 'text-surface-700'
                        )}
                      >
                        {formatNumber(o[m.key])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* ---- Report 3: top performer per office ------------------------------ */}
      <SectionCard
        title="Top Performer per Office"
        description={`The leading employee per office for the selected date range, ranked on sales performance — ${PERFORMANCE_SCORING}. SOs are shown for reference and do not affect the ranking.`}
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
                  <th className="px-3 py-2.5 text-right font-semibold">Performance Score</th>
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
                        <span className="whitespace-nowrap font-medium text-surface-800">{p.owner}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-surface-700">{p.inquiries}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-surface-700">{p.quotesSent}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-surface-700">{p.posReceived}</td>
                    <td
                      className="px-3 py-2.5 text-right font-semibold tabular-nums text-brand-700"
                      title={`Sales performance score — ${PERFORMANCE_SCORING}`}
                    >
                      {p.score}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-surface-700">{p.sosSent}</td>
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
