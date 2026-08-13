import { useMemo, useState } from 'react';
import { Eye, Pencil, Send, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  StatusBadge,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  ConfirmDialog,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { QuotationDetailsDrawer } from '@/components/QuotationDetails';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { QUOTATION_STAGE } from '@/lib/labels';
import type { Quotation } from '@/types';
import { ageLabel, classNames, daysBetween, formatDate, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function QuotesPending() {
  const { quotations, role, can, updateQuotation, addToast } = useApp();
  const inScope = useOfficeScope();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [active, setActive] = useState<Quotation | null>(null);
  const [markSent, setMarkSent] = useState<Quotation | null>(null);
  const loading = useSimulatedLoading([]);

  const base = useMemo(
    () => quotations.filter((q) => q.workState === 'pending_send' && inScope(q.officeId)),
    [quotations, inScope]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return base.filter((q) => {
      if (office && q.officeId !== office) return false;
      if (s && !`${q.number} ${q.customerName} ${q.customerCode} ${q.owner}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [base, search, office]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const overdueCount = base.filter((q) => daysBetween(q.createdDate) > 1).length;

  const doMarkSent = (q: Quotation) => {
    updateQuotation(q.id, {
      workState: 'sent',
      lastUpdated: '2026-08-13',
      activity: [...q.activity, { id: `act-${Date.now()}`, date: '2026-08-13T12:00:00', actor: q.owner, action: 'Quotation sent to customer' }],
    });
    addToast({ type: 'success', title: 'Marked as sent', message: `${q.number} moved out of the pending queue.` });
    setMarkSent(null);
  };

  const columns: Column<Quotation>[] = [
    { key: 'number', header: 'Quotation No', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    {
      key: 'customer',
      header: 'Customer',
      render: (r) => (
        <div className="max-w-[200px]"><p className="truncate font-medium text-surface-800">{r.customerName}</p><p className="text-xs text-surface-400">{r.customerCode}</p></div>
      ),
    },
    { key: 'office', header: 'Sales Office', render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'value', header: 'Value', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    { key: 'created', header: 'Created', sortValue: (r) => r.createdDate, render: (r) => formatDate(r.createdDate) },
    {
      key: 'age',
      header: 'Age',
      sortValue: (r) => daysBetween(r.createdDate),
      render: (r) => {
        const over = daysBetween(r.createdDate) > 1;
        return (
          <span className={classNames('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', over ? 'bg-rose-50 text-rose-600' : 'bg-surface-100 text-surface-500')}>
            {over && <AlertCircle className="h-3 w-3" />}
            {ageLabel(r.createdDate)}
          </span>
        );
      },
    },
    { key: 'stage', header: 'Stage', render: (r) => <StatusBadge tone={QUOTATION_STAGE[r.stage].tone} label={QUOTATION_STAGE[r.stage].label} dot={false} /> },
    { key: 'review', header: 'Review', sortValue: (r) => r.reviewDate, render: (r) => formatDate(r.reviewDate) },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setActive(r)} title="View" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100"><Eye className="h-4 w-4" /></button>
          {can('quotations', 'edit') && <button onClick={() => setActive(r)} title="Prepare / Edit quote" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100"><Pencil className="h-4 w-4" /></button>}
          {can('quotations', 'edit') && (
            <Button size="sm" variant="primary" leftIcon={<Send className="h-3.5 w-3.5" />} onClick={() => setMarkSent(r)}>
              Mark Sent
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Quotes Pending to be Sent"
        description="Quotations awaiting preparation or dispatch to the customer."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Pending to be Sent' }]}
      />

      {overdueCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-5 w-5 flex-none" />
          <span>
            <span className="font-semibold">{overdueCount} quotation{overdueCount > 1 ? 's' : ''}</span> pending for more than 24 hours — highlighted below.
          </span>
        </div>
      )}

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
          </FilterBar>
        </div>
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => setActive(r)}
          emptyTitle="Nothing pending"
          emptyMessage="All quotations have been prepared and sent. 🎉"
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <QuotationDetailsDrawer quotation={active} onClose={() => setActive(null)} />

      <ConfirmDialog
        open={!!markSent}
        onClose={() => setMarkSent(null)}
        onConfirm={() => markSent && doMarkSent(markSent)}
        title="Mark quotation as sent?"
        message={`${markSent?.number} for ${markSent?.customerName} will be marked as sent and removed from the pending queue.`}
        confirmLabel="Mark as Sent"
      />
    </>
  );
}
