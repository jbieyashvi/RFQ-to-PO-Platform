import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Eye, Pencil, SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  StatusBadge,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { QuotationDetailsDrawer } from '@/components/QuotationDetails';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { OWNERS } from '@/data/users';
import { QUOTATION_STAGE, QUOTATION_STATUS } from '@/lib/labels';
import type { Quotation } from '@/types';
import { downloadCSV, formatDate, formatINR, isOverdue } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function QuotationsList() {
  const { quotations, role, can, addToast } = useApp();
  const inScope = useOfficeScope();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [stage, setStage] = useState(params.get('stage') ?? '');
  const [office, setOffice] = useState('');
  const [owner, setOwner] = useState('');
  const [custCode, setCustCode] = useState('');
  const [quoteFrom, setQuoteFrom] = useState('');
  const [quoteTo, setQuoteTo] = useState('');
  const [reviewFrom, setReviewFrom] = useState('');
  const [reviewTo, setReviewTo] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [active, setActive] = useState<Quotation | null>(null);
  const loading = useSimulatedLoading([]);

  // sync incoming query params once
  useEffect(() => {
    if (params.get('status')) setStatus(params.get('status')!);
    if (params.get('stage')) setStage(params.get('stage')!);
    if (params.get('q')) setSearch(params.get('q')!);
    // clear params so they don't stick on manual changes
    if ([...params.keys()].length) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const cc = custCode.trim().toLowerCase();
    return quotations.filter((q) => {
      if (!inScope(q.officeId)) return false;
      if (status && q.status !== status) return false;
      if (stage && q.stage !== stage) return false;
      if (office && q.officeId !== office) return false;
      if (owner && q.owner !== owner) return false;
      if (cc && !q.customerCode.toLowerCase().includes(cc)) return false;
      if (quoteFrom && q.quoteDate < quoteFrom) return false;
      if (quoteTo && q.quoteDate > quoteTo) return false;
      if (reviewFrom && q.reviewDate < reviewFrom) return false;
      if (reviewTo && q.reviewDate > reviewTo) return false;
      if (s && !`${q.number} ${q.customerName} ${q.customerCode} ${q.owner}`.toLowerCase().includes(s))
        return false;
      return true;
    });
  }, [quotations, inScope, search, status, stage, office, owner, custCode, quoteFrom, quoteTo, reviewFrom, reviewTo]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (status) chips.push({ key: 'st', label: `Status: ${QUOTATION_STATUS[status as keyof typeof QUOTATION_STATUS]?.label ?? status}`, onRemove: () => setStatus('') });
  if (stage) chips.push({ key: 'sg', label: `Stage: ${QUOTATION_STAGE[stage as keyof typeof QUOTATION_STAGE]?.label ?? stage}`, onRemove: () => setStage('') });
  if (office) chips.push({ key: 'of', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (owner) chips.push({ key: 'ow', label: `Owner: ${owner}`, onRemove: () => setOwner('') });
  if (custCode) chips.push({ key: 'cc', label: `Cust code: ${custCode}`, onRemove: () => setCustCode('') });
  if (quoteFrom || quoteTo) chips.push({ key: 'qd', label: `Quote: ${quoteFrom || '…'} → ${quoteTo || '…'}`, onRemove: () => { setQuoteFrom(''); setQuoteTo(''); } });
  if (reviewFrom || reviewTo) chips.push({ key: 'rd', label: `Review: ${reviewFrom || '…'} → ${reviewTo || '…'}`, onRemove: () => { setReviewFrom(''); setReviewTo(''); } });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => {
    setSearch(''); setStatus(''); setStage(''); setOffice(''); setOwner('');
    setCustCode(''); setQuoteFrom(''); setQuoteTo(''); setReviewFrom(''); setReviewTo('');
  };

  const exportCSV = () => {
    const header = ['Quotation No', 'Customer', 'Customer Code', 'Sales Office', 'Owner', 'Status', 'Stage', 'Value (INR)', 'Quote Date', 'Review Date', 'Last Updated'];
    const rows = filtered.map((q) => [
      q.number, q.customerName, q.customerCode, officeName(q.officeId), q.owner,
      QUOTATION_STATUS[q.status].label, QUOTATION_STAGE[q.stage].label, q.value,
      q.quoteDate, q.reviewDate, q.lastUpdated,
    ]);
    downloadCSV('quotations-filtered.csv', [header, ...rows]);
    addToast({ type: 'success', title: 'Export complete', message: `${filtered.length} filtered quotation(s) exported to CSV.` });
  };

  const columns: Column<Quotation>[] = [
    { key: 'number', header: 'Quotation No', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    {
      key: 'customer',
      header: 'Customer',
      sortValue: (r) => r.customerName,
      render: (r) => (
        <div className="max-w-[200px]">
          <p className="truncate font-medium text-surface-800">{r.customerName}</p>
          <p className="text-xs text-surface-400">{r.customerCode}</p>
        </div>
      ),
    },
    { key: 'office', header: 'Sales Office', sortValue: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge tone={QUOTATION_STATUS[r.status].tone} label={QUOTATION_STATUS[r.status].label} /> },
    { key: 'stage', header: 'Stage', render: (r) => <StatusBadge tone={QUOTATION_STAGE[r.stage].tone} label={QUOTATION_STAGE[r.stage].label} dot={false} /> },
    { key: 'value', header: 'Value', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    { key: 'quoteDate', header: 'Quote Date', sortValue: (r) => r.quoteDate, render: (r) => formatDate(r.quoteDate) },
    {
      key: 'reviewDate',
      header: 'Review Date',
      sortValue: (r) => r.reviewDate,
      render: (r) => (
        <span className={isOverdue(r.reviewDate) && r.status === 'open' ? 'font-medium text-rose-600' : 'text-surface-600'}>
          {formatDate(r.reviewDate)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setActive(r)} title="View" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 hover:text-surface-800">
            <Eye className="h-4 w-4" />
          </button>
          {can('quotations', 'edit') && (
            <button onClick={() => setActive(r)} title="Edit" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 hover:text-surface-800">
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="List of Quotations"
        description="Master view of all quotations. Every quotation is tagged to a sales office."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'List of Quotations' }]}
        actions={
          can('quotations', 'download') && (
            <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>
              Download CSV ({filtered.length})
            </Button>
          )
        }
      />

      <div className="card">
        <div className="space-y-4 border-b border-surface-100 p-4">
          <FilterBar
            chips={chips}
            onClearAll={clearAll}
            right={
              <Button variant="ghost" size="sm" leftIcon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide' : 'More'} filters
              </Button>
            }
          >
            <SearchInput value={search} onChange={setSearch} placeholder="Search quotation no, customer, owner…" className="w-full sm:w-72" />
            <FilterSelect value={status} onChange={setStatus} placeholder="All statuses" options={Object.entries(QUOTATION_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
            <FilterSelect value={stage} onChange={setStage} placeholder="All stages" options={Object.entries(QUOTATION_STAGE).map(([k, v]) => ({ value: k, label: v.label }))} />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
          </FilterBar>

          {showAdvanced && (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-surface-100 bg-surface-50/60 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <FilterSelect value={owner} onChange={setOwner} placeholder="All owners" options={OWNERS.map((o) => ({ value: o, label: o }))} />
              <div>
                <SearchInput value={custCode} onChange={setCustCode} placeholder="Customer code…" />
              </div>
              <div />
              <DateRange label="Quote Date" from={quoteFrom} to={quoteTo} onFrom={setQuoteFrom} onTo={setQuoteTo} />
              <DateRange label="Review Date" from={reviewFrom} to={reviewTo} onFrom={setReviewFrom} onTo={setReviewTo} />
            </div>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => setActive(r)}
          emptyTitle="No quotations match your filters"
          emptyMessage="Try clearing some filters to see more results."
          emptyAction={chips.length > 0 ? <Button variant="secondary" size="sm" onClick={clearAll}>Clear all filters</Button> : undefined}
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <QuotationDetailsDrawer quotation={active} onClose={() => setActive(null)} onEdit={() => addToast({ type: 'info', title: 'Edit mode', message: 'Use the workflow controls to update status, stage and review date.' })} />
    </>
  );
}

function DateRange({
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  label: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-surface-500">{label} range</label>
      <div className="flex items-center gap-2">
        <input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="input py-1.5 text-sm" />
        <span className="text-surface-400">→</span>
        <input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="input py-1.5 text-sm" />
      </div>
    </div>
  );
}
