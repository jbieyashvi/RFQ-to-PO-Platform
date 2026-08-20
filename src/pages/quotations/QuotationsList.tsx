import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, X } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  SearchInput,
  FilterSelect,
  Pagination,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { QuotationDetailsDrawer } from '@/components/QuotationDetails';
import { WorkflowInlineSelect } from '@/components/WorkflowInlineSelect';
import { WorkflowUpdateModal, type WorkflowRequest } from '@/components/WorkflowUpdateModal';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { QUOTATION_STAGE, QUOTATION_STATUS } from '@/lib/labels';
import type { Quotation, QuotationStage, QuotationStatus } from '@/types';
import { downloadCSV, formatDate, formatDateTime, formatINR } from '@/lib/format';
import { latestQuoteSubmittedAt, firstInquiryAt } from '@/lib/quotationDates';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';
import { poQuotationIds, isQuoteSent, isConvertedQuote, isAwaitingPOQuote } from '@/lib/metrics';

// Dashboard funnel deep-link views (?view=). Each uses the same shared metrics
// predicates as the funnel itself, so list counts always match the dashboard.
const VIEW_LABELS: Record<string, string> = {
  sent: 'Quotes Sent',
  converted: 'Converted Opportunities',
  awaiting_po: 'Finalised — Awaiting PO',
};

export default function QuotationsList() {
  const { quotations, salesOrders, role, can, addToast } = useApp();
  const canEdit = can('quotations', 'edit');
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const [params, setParams] = useSearchParams();

  const [qtnNumber, setQtnNumber] = useState(params.get('q') ?? '');
  const [customerName, setCustomerName] = useState('');
  const [custCode, setCustCode] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [stage, setStage] = useState(params.get('stage') ?? '');
  const [view, setView] = useState(params.get('view') ?? '');
  const [office, setOffice] = useState('');

  // Track the open drawer by id so it always reflects the live quotation after
  // a workflow update (inline or drawer), rather than a stale snapshot.
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = activeId ? quotations.find((q) => q.id === activeId) ?? null : null;

  // The inline Status/Stage dropdowns don't mutate immediately — picking a new
  // value opens the shared "Update Quotation Workflow" prompt (review date).
  const [pending, setPending] = useState<WorkflowRequest | null>(null);
  const loading = useSimulatedLoading([]);

  // "Current Date" column — dynamically generated (today, date-only).
  const currentDate = formatDate(new Date().toISOString().slice(0, 10));

  const statusOptions = (Object.entries(QUOTATION_STATUS) as [QuotationStatus, { label: string }][]).map(
    ([value, v]) => ({ value, label: v.label })
  );
  const stageOptions = (Object.entries(QUOTATION_STAGE) as [QuotationStage, { label: string }][]).map(
    ([value, v]) => ({ value, label: v.label })
  );

  // sync incoming query params once (dashboard deep-links pass ?status / ?stage /
  // ?view=<funnel level> / ?q=<QTN no>)
  useEffect(() => {
    if (params.get('status')) setStatus(params.get('status')!);
    if (params.get('stage')) setStage(params.get('stage')!);
    if (params.get('view')) setView(params.get('view')!);
    if (params.get('q')) setQtnNumber(params.get('q')!);
    // clear params so they don't stick on manual changes
    if ([...params.keys()].length) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Quotation ids that already have a linked customer PO (sales order), built
  // from the same role-scoped SO set the dashboard funnel uses so the two can
  // never classify a quotation differently.
  const poIds = useMemo(
    () => poQuotationIds(salesOrders.filter((s) => inScope(s.officeId))),
    [salesOrders, inScope]
  );

  const filtered = useMemo(() => {
    const qn = qtnNumber.trim().toLowerCase();
    const cn = customerName.trim().toLowerCase();
    const cc = custCode.trim().toLowerCase();
    return quotations.filter((q) => {
      if (!inScope(q.officeId)) return false;
      if (view === 'sent' && !isQuoteSent(q)) return false;
      if (view === 'converted' && !isConvertedQuote(q, poIds)) return false;
      if (view === 'awaiting_po' && !isAwaitingPOQuote(q, poIds)) return false;
      if (status && q.status !== status) return false;
      if (stage && q.stage !== stage) return false;
      if (office && q.officeId !== office) return false;
      if (qn && !q.number.toLowerCase().includes(qn)) return false;
      if (cn && !q.customerName.toLowerCase().includes(cn)) return false;
      if (cc && !q.customerCode.toLowerCase().includes(cc)) return false;
      return true;
    });
  }, [quotations, inScope, qtnNumber, customerName, custCode, status, stage, view, poIds, office]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (view) chips.push({ key: 'vw', label: `View: ${VIEW_LABELS[view] ?? view}`, onRemove: () => setView('') });
  if (qtnNumber) chips.push({ key: 'qn', label: `QTN No: "${qtnNumber}"`, onRemove: () => setQtnNumber('') });
  if (customerName) chips.push({ key: 'cn', label: `Customer: "${customerName}"`, onRemove: () => setCustomerName('') });
  if (custCode) chips.push({ key: 'cc', label: `Cust code: "${custCode}"`, onRemove: () => setCustCode('') });
  if (status) chips.push({ key: 'st', label: `Status: ${QUOTATION_STATUS[status as keyof typeof QUOTATION_STATUS]?.label ?? status}`, onRemove: () => setStatus('') });
  if (stage) chips.push({ key: 'sg', label: `Stage: ${QUOTATION_STAGE[stage as keyof typeof QUOTATION_STAGE]?.label ?? stage}`, onRemove: () => setStage('') });
  if (office) chips.push({ key: 'of', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });

  const clearAll = () => {
    setQtnNumber(''); setCustomerName(''); setCustCode('');
    setStatus(''); setStage(''); setView(''); setOffice('');
  };

  const exportCSV = () => {
    const header = ['Quotation No', 'Customer', 'Customer Code', 'Sales Office', 'Owner', 'Status', 'Stage', 'Value (INR)', 'Current Date', 'First Inquiry Date', 'Latest Quote Sent'];
    const rows = filtered.map((q) => {
      const sent = latestQuoteSubmittedAt(q);
      return [
        q.number, q.customerName, q.customerCode, officeName(q.officeId), q.owner,
        QUOTATION_STATUS[q.status].label, QUOTATION_STAGE[q.stage].label, q.value,
        currentDate, formatDateTime(firstInquiryAt(q)), sent ? formatDateTime(sent) : '—',
      ];
    });
    downloadCSV('quotations-filtered.csv', [header, ...rows]);
    addToast({ type: 'success', title: 'Export complete', message: `${filtered.length} filtered quotation(s) exported to CSV.` });
  };

  const columns: Column<Quotation>[] = [
    { key: 'number', header: 'QTN No', width: '116px', sticky: 'left', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (r) => r.customerName,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-surface-800" title={r.customerName}>{r.customerName}</p>
          <p className="truncate text-[11px] text-surface-400">{r.customerCode}</p>
        </div>
      ),
    },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), sortValue: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', width: '100px', truncate: true, title: (r) => r.owner, render: (r) => <span className="text-surface-600">{r.owner}</span> },
    {
      key: 'status',
      header: 'Status',
      width: '116px',
      render: (r) => (
        <WorkflowInlineSelect
          value={r.status}
          tone={QUOTATION_STATUS[r.status].tone}
          options={statusOptions}
          disabled={!canEdit}
          ariaLabel={`Status for ${r.number}`}
          onSelect={(value) => setPending({ quotation: r, field: 'status', value })}
        />
      ),
    },
    {
      key: 'stage',
      header: 'Stage',
      width: '128px',
      render: (r) => (
        <WorkflowInlineSelect
          value={r.stage}
          tone={QUOTATION_STAGE[r.stage].tone}
          options={stageOptions}
          disabled={!canEdit}
          ariaLabel={`Stage for ${r.number}`}
          onSelect={(value) => setPending({ quotation: r, field: 'stage', value })}
        />
      ),
    },
    { key: 'value', header: 'Value', width: '92px', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    {
      key: 'currentDate',
      header: 'Current Date',
      width: '92px',
      render: () => <span className="text-surface-600">{currentDate}</span>,
    },
    {
      key: 'firstInquiry',
      header: 'First Inquiry Date',
      width: '104px',
      sortValue: (r) => firstInquiryAt(r),
      render: (r) => <DateCell iso={firstInquiryAt(r)} />,
    },
    {
      key: 'latestSent',
      header: 'Latest Quote Sent',
      width: '104px',
      sortValue: (r) => latestQuoteSubmittedAt(r) ?? '',
      render: (r) => <DateCell iso={latestQuoteSubmittedAt(r)} />,
    },
    {
      key: 'actions',
      header: '',
      width: '84px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <Button variant="secondary" size="sm" onClick={() => setActiveId(r.id)} aria-label={`Open ${r.number}`}>
            Open
          </Button>
        </div>
      ),
    },
  ];

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="List of Quotations"
          description="Master view of all quotations. Every quotation is tagged to a sales office."
          crumbs={[{ label: 'Sales Quotations' }, { label: 'List of Quotations' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="List of Quotations"
        description="Master view of all quotations. Every quotation is tagged to a sales office."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'List of Quotations' }]}
        actions={
          can('quotations', 'download') && (
            <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>
              Download Filtered List ({filtered.length})
            </Button>
          )
        }
      />

      <div className="card">
        <div className="space-y-4 border-b border-surface-100 p-4">
          {/* Required filters — each a distinct, independently functional control */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <Labeled label="QTN Number">
              <SearchInput value={qtnNumber} onChange={setQtnNumber} placeholder="e.g. QTN/2026/1001" className="w-full" />
            </Labeled>
            <Labeled label="Customer Name">
              <SearchInput value={customerName} onChange={setCustomerName} placeholder="Search customer…" className="w-full" />
            </Labeled>
            <Labeled label="Customer Code">
              <SearchInput value={custCode} onChange={setCustCode} placeholder="e.g. CUST-1001" className="w-full" />
            </Labeled>
            <Labeled label="Status">
              <FilterSelect className="w-full" value={status} onChange={setStatus} placeholder="All statuses" options={Object.entries(QUOTATION_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Labeled>
            <Labeled label="Stage">
              <FilterSelect className="w-full" value={stage} onChange={setStage} placeholder="All stages" options={Object.entries(QUOTATION_STAGE).map(([k, v]) => ({ value: k, label: v.label }))} />
            </Labeled>
            {role === 'super_admin' && (
              <Labeled label="Sales Office">
                <FilterSelect className="w-full" value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />
              </Labeled>
            )}
          </div>

          {/* Toolbar: result count · clear all · download */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-surface-600">
              <span className="font-semibold text-surface-900">{filtered.length}</span> result{filtered.length === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              {chips.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Clear All Filters
                </Button>
              )}
              {can('quotations', 'download') && (
                <Button variant="secondary" size="sm" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>
                  Download Filtered List ({filtered.length})
                </Button>
              )}
            </div>
          </div>

          {/* Applied-filter chips */}
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-surface-400">Active filters:</span>
              {chips.map((chip) => (
                <span key={chip.key} className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-brand-700">
                  {chip.label}
                  <button onClick={chip.onRemove} aria-label={`Remove ${chip.label}`} className="rounded-full p-0.5 text-brand-400 hover:bg-brand-100 hover:text-brand-700">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => setActiveId(r.id)}
          emptyTitle="No quotations match your filters"
          emptyMessage="Try clearing some filters to see more results."
          emptyAction={chips.length > 0 ? <Button variant="secondary" size="sm" onClick={clearAll}>Clear all filters</Button> : undefined}
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <QuotationDetailsDrawer quotation={active} onClose={() => setActiveId(null)} onEdit={() => addToast({ type: 'info', title: 'Edit mode', message: 'Use the workflow controls to update status, stage and review date.' })} />

      <WorkflowUpdateModal request={pending} onClose={() => setPending(null)} />
    </>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-surface-500">{label}</label>
      {children}
    </div>
  );
}

// Compact single-line date so the three date columns fit the desktop table at
// 1280/1440 without horizontal scroll. Renders "—" when the quotation has
// never been sent to the customer (Latest Quote Sent).
function DateCell({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-surface-400">—</span>;
  return <span className="text-surface-600">{formatDate(iso.slice(0, 10))}</span>;
}
