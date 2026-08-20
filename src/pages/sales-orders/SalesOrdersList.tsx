import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Download, Eye, Plus } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { SalesOrderDetailsDrawer } from '@/components/SalesOrderDetails';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import type { SalesOrder } from '@/types';
import { downloadCSV, downloadText, formatDateTime, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

export default function SalesOrdersList() {
  const { salesOrders, role, can, addToast } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [active, setActive] = useState<SalesOrder | null>(null);
  const loading = useSimulatedLoading([]);

  // Clear any legacy status deep-link param (the status filter was removed).
  useEffect(() => {
    if ([...params.keys()].length) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ownerOf = (so: SalesOrder) => so.owner?.trim() || 'Unassigned';
  const sentLabel = (so: SalesOrder) => (so.sentAt ? formatDateTime(so.sentAt) : 'Not sent');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return salesOrders.filter((so) => {
      if (!inScope(so.officeId)) return false;
      if (office && so.officeId !== office) return false;
      if (dateFrom && so.createdDate < dateFrom) return false;
      if (dateTo && so.createdDate > dateTo) return false;
      // Search by SO number, customer name and owner only (never PO number).
      if (s && !`${so.number} ${so.customerName} ${ownerOf(so)}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [salesOrders, inScope, search, office, dateFrom, dateTo]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (dateFrom || dateTo) chips.push({ key: 'd', label: `Created: ${dateFrom || '…'} → ${dateTo || '…'}`, onRemove: () => { setDateFrom(''); setDateTo(''); } });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => { setSearch(''); setOffice(''); setDateFrom(''); setDateTo(''); };

  const exportCSV = () => {
    const header = ['SO No', 'Customer', 'Sales Office', 'Owner', 'Value (INR)', 'SO Sent Date'];
    const rows = filtered.map((so) => [so.number, so.customerName, officeName(so.officeId), ownerOf(so), so.value, sentLabel(so)]);
    downloadCSV('sales-orders-filtered.csv', [header, ...rows]);
    addToast({ type: 'success', title: 'Export complete', message: `${filtered.length} sales order(s) exported.` });
  };

  // Download the latest Sales Order PDF directly. For revised records the live SO
  // already reflects the latest approved revision (original kept in versions[0]).
  const downloadOne = (so: SalesOrder) => {
    downloadText(`${so.number.replace(/\//g, '-')}.txt`, `SALES ORDER ${so.number}\nPO ${so.poNumber}\nCustomer ${so.customerName}\nOwner ${ownerOf(so)}\nValue ${formatINR(so.value)}`);
    addToast({ type: 'info', title: 'Download started', message: so.number });
  };

  const columns: Column<SalesOrder>[] = [
    {
      key: 'so',
      header: 'SO No',
      width: '140px',
      sticky: 'left',
      sortValue: (r) => r.number,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-surface-800">{r.number}</span>
          {r.revisionNumber > 0 && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700" title={`Latest revision: Rev ${r.revisionNumber}`}>
              Rev {r.revisionNumber}
            </span>
          )}
        </span>
      ),
    },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, sortValue: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', truncate: true, title: (r) => ownerOf(r), sortValue: (r) => ownerOf(r), render: (r) => <span className="text-surface-600">{ownerOf(r)}</span> },
    { key: 'value', header: 'Value', width: '104px', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    {
      key: 'sentAt',
      header: 'SO Sent Date',
      width: '176px',
      sortValue: (r) => r.sentAt ?? '',
      render: (r) => (r.sentAt ? <span className="text-surface-600">{formatDateTime(r.sentAt)}</span> : <span className="text-surface-400">Not sent</span>),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '84px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={iconBtn} title="View Sales Order" aria-label={`View ${r.number}`} onClick={() => setActive(r)}>
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" className={iconBtn} title="Download Sales Order" aria-label={`Download ${r.number}`} disabled={!can('sales_orders', 'download')} onClick={() => downloadOne(r)}>
            <Download className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="List of Sales Orders"
        description="All sales orders across offices. Open a record for its PO, quotation and verification detail."
        crumbs={[{ label: 'Sales Orders' }, { label: 'List of Sales Orders' }]}
        actions={
          <>
            {!noOffice && can('sales_orders', 'download') && <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>Download CSV ({filtered.length})</Button>}
            {!noOffice && can('sales_orders', 'create') && <Link to="/sales-orders/create"><Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>Create SO</Button></Link>}
          </>
        }
      />

      {noOffice ? (
        <NoOfficeAssigned />
      ) : (
      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={clearAll}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search SO number or customer…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input h-9 py-1.5 text-sm" title="Created from" />
              <span className="text-surface-400">→</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input h-9 py-1.5 text-sm" title="Created to" />
            </div>
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => setActive(r)} emptyTitle="No sales orders found" emptyMessage="Adjust filters or create a sales order." />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>
      )}

      <SalesOrderDetailsDrawer order={active} onClose={() => setActive(null)} />
    </>
  );
}
