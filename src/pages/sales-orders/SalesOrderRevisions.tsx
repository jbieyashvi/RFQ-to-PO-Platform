import { useMemo, useState } from 'react';
import { Eye, Pencil, Download, CheckCheck, Save } from 'lucide-react';
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
  RowActionMenu,
  type Column,
  type FilterChip,
  type RowAction,
} from '@/components/ui';
import { SalesOrderDetailsDrawer } from '@/components/SalesOrderDetails';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { SO_STATUS } from '@/lib/labels';
import type { SalesOrder } from '@/types';
import { downloadText, formatDate, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function SalesOrderRevisions() {
  const { salesOrders, role, can, updateSalesOrder, addToast } = useApp();
  const inScope = useOfficeScope();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [active, setActive] = useState<SalesOrder | null>(null);
  const [editing, setEditing] = useState<SalesOrder | null>(null);
  const [notes, setNotes] = useState('');
  const [complete, setComplete] = useState<SalesOrder | null>(null);
  const loading = useSimulatedLoading([]);

  const base = useMemo(
    () => salesOrders.filter((so) => so.status === 'revision_required' && inScope(so.officeId)),
    [salesOrders, inScope]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return base.filter((so) => {
      if (office && so.officeId !== office) return false;
      if (s && !`${so.number} ${so.customerName} ${so.revisionReason ?? ''}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [base, search, office]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const saveDraft = () => {
    if (!editing) return;
    addToast({ type: 'success', title: 'Draft saved', message: `Revision notes saved for ${editing.number}.` });
    setEditing(null);
    setNotes('');
  };

  const markCompleted = (so: SalesOrder) => {
    updateSalesOrder(so.id, { status: 'so_sent', revisionReason: undefined });
    addToast({ type: 'success', title: 'Revision completed', message: `${so.number} revised and returned to active orders.` });
    setComplete(null);
  };

  const downloadRevised = (so: SalesOrder) => {
    downloadText(`${so.number.replace(/\//g, '-')}-revised.txt`, `REVISED SALES ORDER ${so.number}\nReason: ${so.revisionReason}\nCustomer ${so.customerName}\nValue ${formatINR(so.value)}`);
    addToast({ type: 'info', title: 'Download started', message: `${so.number} (revised)` });
  };

  const columns: Column<SalesOrder>[] = [
    { key: 'so', header: 'SO No', width: '118px', sticky: 'left', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'office', header: 'Sales Office', width: '150px', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'reason', header: 'Revision Reason', truncate: true, title: (r) => r.revisionReason ?? '', render: (r) => <span className="text-surface-700">{r.revisionReason}</span> },
    { key: 'requested', header: 'Requested', width: '92px', sortValue: (r) => r.revisionRequestedDate ?? '', render: (r) => <span className="text-surface-600">{formatDate(r.revisionRequestedDate ?? '', { short: true })}</span> },
    { key: 'owner', header: 'Owner', width: '110px', truncate: true, title: (r) => r.owner, render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'status', header: 'Status', width: '140px', render: (r) => <StatusBadge tone={SO_STATUS[r.status].tone} label={SO_STATUS[r.status].label} /> },
    {
      key: 'actions',
      header: 'Actions',
      width: '142px',
      align: 'right',
      sticky: 'right',
      render: (r) => {
        const menu: RowAction[] = [{ label: 'View Existing SO', icon: <Eye className="h-4 w-4" />, onClick: () => setActive(r) }];
        if (can('sales_orders', 'edit')) menu.push({ label: 'Edit SO / Notes', icon: <Pencil className="h-4 w-4" />, onClick: () => { setEditing(r); setNotes(''); } });
        if (can('sales_orders', 'download')) menu.push({ label: 'Download Revised SO', icon: <Download className="h-4 w-4" />, onClick: () => downloadRevised(r) });
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {can('sales_orders', 'edit') && <Button size="sm" variant="primary" leftIcon={<CheckCheck className="h-3.5 w-3.5" />} onClick={() => setComplete(r)}>Complete</Button>}
            <RowActionMenu actions={menu} label={`Actions for ${r.number}`} />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Sales Order Revision"
        description="Sales orders that require corrections before they can be finalised."
        crumbs={[{ label: 'Sales Orders' }, { label: 'Sales Order Revision' }]}
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => setActive(r)} emptyTitle="No revisions pending" emptyMessage="No sales orders currently require revision." />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <SalesOrderDetailsDrawer order={active} onClose={() => setActive(null)} />

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Edit Sales Order — Revision"
        subtitle={editing?.number}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft}>Save Draft</Button>
            <Button variant="primary" leftIcon={<CheckCheck className="h-4 w-4" />} onClick={() => { if (editing) markCompleted(editing); setEditing(null); }}>Mark Revision Completed</Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <span className="font-semibold">Requested change:</span> {editing.revisionReason}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs uppercase text-surface-400">Customer</p><p className="font-medium text-surface-800">{editing.customerName}</p></div>
              <div><p className="text-xs uppercase text-surface-400">Order Value</p><p className="font-medium text-surface-800">{formatINR(editing.value)}</p></div>
            </div>
            <TextAreaField label="Revision Notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Describe the corrections made to this sales order…" />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!complete}
        onClose={() => setComplete(null)}
        onConfirm={() => complete && markCompleted(complete)}
        title="Mark revision as completed?"
        message={`${complete?.number} will be marked SO Sent and returned to the active orders list.`}
        confirmLabel="Mark Completed"
      />
    </>
  );
}
