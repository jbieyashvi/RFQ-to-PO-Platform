import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Download, Eye, Send, RotateCcw, Plus } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  StatusBadge,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  Modal,
  TextAreaField,
  ConfirmDialog,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { SalesOrderDetailsDrawer } from '@/components/SalesOrderDetails';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { SO_STATUS } from '@/lib/labels';
import type { SalesOrder, SOStatus } from '@/types';
import { downloadCSV, downloadText, formatDate, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function SalesOrdersList() {
  const { salesOrders, role, can, updateSalesOrder, addToast } = useApp();
  const inScope = useOfficeScope();
  const [params, setParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [office, setOffice] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [active, setActive] = useState<SalesOrder | null>(null);
  const [reqRevision, setReqRevision] = useState<SalesOrder | null>(null);
  const [revReason, setRevReason] = useState('');
  const [markSent, setMarkSent] = useState<SalesOrder | null>(null);
  const loading = useSimulatedLoading([]);

  useEffect(() => {
    if (params.get('status')) setStatus(params.get('status')!);
    if ([...params.keys()].length) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return salesOrders.filter((so) => {
      if (!inScope(so.officeId)) return false;
      if (status && so.status !== status) return false;
      if (office && so.officeId !== office) return false;
      if (dateFrom && so.createdDate < dateFrom) return false;
      if (dateTo && so.createdDate > dateTo) return false;
      if (s && !`${so.number} ${so.poNumber} ${so.quotationNumber} ${so.customerName}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [salesOrders, inScope, search, status, office, dateFrom, dateTo]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (status) chips.push({ key: 's', label: `Status: ${SO_STATUS[status as SOStatus].label}`, onRemove: () => setStatus('') });
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (dateFrom || dateTo) chips.push({ key: 'd', label: `Created: ${dateFrom || '…'} → ${dateTo || '…'}`, onRemove: () => { setDateFrom(''); setDateTo(''); } });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => { setSearch(''); setStatus(''); setOffice(''); setDateFrom(''); setDateTo(''); };

  const exportCSV = () => {
    const header = ['SO Number', 'PO Number', 'Quotation No', 'Customer', 'Sales Office', 'Owner', 'Value (INR)', 'SO Status', 'Created', 'Delivery Date'];
    const rows = filtered.map((so) => [so.number, so.poNumber, so.quotationNumber ?? '', so.customerName, officeName(so.officeId), so.owner, so.value, SO_STATUS[so.status].label, so.createdDate, so.deliveryDate]);
    downloadCSV('sales-orders-filtered.csv', [header, ...rows]);
    addToast({ type: 'success', title: 'Export complete', message: `${filtered.length} sales order(s) exported.` });
  };

  const doMarkSent = (so: SalesOrder) => {
    updateSalesOrder(so.id, { status: 'so_sent' });
    addToast({ type: 'success', title: 'SO marked as sent', message: `${so.number} dispatched to customer.` });
    setMarkSent(null);
  };

  const doRequestRevision = () => {
    if (!reqRevision) return;
    updateSalesOrder(reqRevision.id, { status: 'revision_required', revisionReason: revReason || 'Revision requested', revisionRequestedDate: '2026-08-13' });
    addToast({ type: 'success', title: 'Revision requested', message: `${reqRevision.number} moved to revision queue.` });
    setReqRevision(null);
    setRevReason('');
  };

  const downloadOne = (so: SalesOrder) => {
    downloadText(`${so.number.replace(/\//g, '-')}.txt`, `SALES ORDER ${so.number}\nPO ${so.poNumber}\nCustomer ${so.customerName}\nValue ${formatINR(so.value)}`);
    addToast({ type: 'info', title: 'Download started', message: so.number });
  };

  const columns: Column<SalesOrder>[] = [
    { key: 'so', header: 'SO Number', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    { key: 'po', header: 'PO Number', render: (r) => <span className="text-surface-600">{r.poNumber}</span> },
    { key: 'qtn', header: 'Quotation', render: (r) => <span className="text-surface-500">{r.quotationNumber ?? '—'}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div className="max-w-[180px] truncate font-medium text-surface-800">{r.customerName}</div> },
    { key: 'office', header: 'Sales Office', render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'value', header: 'Value', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    { key: 'status', header: 'SO Status', render: (r) => <StatusBadge tone={SO_STATUS[r.status].tone} label={SO_STATUS[r.status].label} /> },
    { key: 'created', header: 'Created', sortValue: (r) => r.createdDate, render: (r) => formatDate(r.createdDate) },
    { key: 'delivery', header: 'Delivery', sortValue: (r) => r.deliveryDate, render: (r) => formatDate(r.deliveryDate) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setActive(r)} title="View" aria-label="View" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"><Eye className="h-4 w-4" /></button>
          {can('sales_orders', 'download') && <button onClick={() => downloadOne(r)} title="Download" aria-label="Download" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"><Download className="h-4 w-4" /></button>}
          {can('sales_orders', 'edit') && r.status !== 'so_sent' && r.status !== 'finalised' && <button onClick={() => setMarkSent(r)} title="Mark as sent" aria-label="Mark as sent" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"><Send className="h-4 w-4" /></button>}
          {can('sales_orders', 'edit') && r.status !== 'revision_required' && <button onClick={() => { setReqRevision(r); setRevReason(''); }} title="Request revision" aria-label="Request revision" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"><RotateCcw className="h-4 w-4" /></button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="List of Sales Orders"
        description="All sales orders across offices, with their PO and quotation linkage."
        crumbs={[{ label: 'Sales Orders' }, { label: 'List of Sales Orders' }]}
        actions={
          <>
            {can('sales_orders', 'download') && <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>Download CSV ({filtered.length})</Button>}
            {can('sales_orders', 'create') && <Link to="/sales-orders/create"><Button variant="primary" leftIcon={<Plus className="h-4 w-4" />}>Create SO</Button></Link>}
          </>
        }
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={clearAll}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search SO, PO, customer…" className="w-full sm:w-72" />
            <FilterSelect value={status} onChange={setStatus} placeholder="All SO statuses" options={Object.entries(SO_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
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

      <SalesOrderDetailsDrawer order={active} onClose={() => setActive(null)} />

      <ConfirmDialog
        open={!!markSent}
        onClose={() => setMarkSent(null)}
        onConfirm={() => markSent && doMarkSent(markSent)}
        title="Mark sales order as sent?"
        message={`${markSent?.number} will be marked SO Sent and shared with ${markSent?.customerName}.`}
        confirmLabel="Mark as Sent"
      />

      <Modal
        open={!!reqRevision}
        onClose={() => setReqRevision(null)}
        title="Request Revision"
        subtitle={reqRevision?.number}
        size="md"
        footer={<><Button variant="secondary" onClick={() => setReqRevision(null)}>Cancel</Button><Button variant="primary" onClick={doRequestRevision}>Request Revision</Button></>}
      >
        <TextAreaField label="Revision reason" required rows={3} value={revReason} onChange={(e) => setRevReason(e.target.value)} placeholder="Describe what needs to change…" />
      </Modal>
    </>
  );
}
