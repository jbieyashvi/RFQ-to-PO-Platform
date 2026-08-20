import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Eye, Send, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  Modal,
  TextAreaField,
  StatusBadge,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { SalesOrderDetailsDrawer } from '@/components/SalesOrderDetails';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import type { ErpHandoff as ErpHandoffRecord, SalesOrder } from '@/types';
import { ERP_HANDOFF_STATE } from '@/lib/labels';
import { downloadText, formatDate, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

const HANDOFF_STATES = [
  { value: 'pending', label: 'Pending' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'failed', label: 'Failed' },
];

export default function ErpHandoff() {
  const { salesOrders, role, currentUser, can, updateSalesOrder, addToast } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const location = useLocation();

  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [owner, setOwner] = useState('');
  const [state, setState] = useState('');

  const [active, setActive] = useState<SalesOrder | null>(null);
  const [submitFor, setSubmitFor] = useState<SalesOrder | null>(null);
  const loading = useSimulatedLoading([]);

  // A freshly-created SO passes its id via router state so we can highlight it.
  const highlightId = (location.state as { highlightId?: string } | null)?.highlightId ?? null;
  const [highlight, setHighlight] = useState<string | null>(highlightId);
  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlight(null), 5000);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  const canSubmit = can('erp_handoff', 'edit');
  const canDownload = can('erp_handoff', 'download');

  // Only sales orders that have entered the ERP Handoff queue.
  const records = useMemo(
    () => salesOrders.filter((so) => so.erpHandoff && inScope(so.officeId)),
    [salesOrders, inScope]
  );

  const owners = useMemo(
    () => Array.from(new Set(records.map((r) => r.owner).filter(Boolean))).sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return records.filter((so) => {
      if (office && so.officeId !== office) return false;
      if (owner && so.owner !== owner) return false;
      if (state && so.erpHandoff!.state !== state) return false;
      // Search by SO number, PO number and customer.
      if (s && !`${so.number} ${so.poNumber} ${so.customerName}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [records, search, office, owner, state]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (owner) chips.push({ key: 'w', label: `Owner: ${owner}`, onRemove: () => setOwner('') });
  if (state) chips.push({ key: 's', label: `Status: ${ERP_HANDOFF_STATE[state as keyof typeof ERP_HANDOFF_STATE].label}`, onRemove: () => setState('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => { setSearch(''); setOffice(''); setOwner(''); setState(''); };

  const downloadOne = (so: SalesOrder) => {
    downloadText(
      `${so.number.replace(/\//g, '-')}.txt`,
      `SALES ORDER ${so.number}${so.revisionNumber > 0 ? ` (Rev ${so.revisionNumber})` : ''}\nPO ${so.poNumber} (${formatDate(so.poDate)})\nCustomer ${so.customerName}\nSales Office ${officeName(so.officeId)}\nOwner ${so.owner}\nValue ${formatINR(so.value)}\nHandoff Status ${ERP_HANDOFF_STATE[so.erpHandoff!.state].label}`
    );
    addToast({ type: 'info', title: 'Download started', message: so.number });
  };

  // Push (or re-push) a Sales Order to the ERP: Pending/Failed → Submitted, then
  // simulate the ERP acknowledging it → Accepted. Updates the single handoff
  // record in place and mirrors the SO's current revision number.
  const pushToErp = (so: SalesOrder, reference?: string) => {
    const at = new Date().toISOString();
    const submitEntry = {
      id: `act-${so.id}-erpsubmit-${Date.now()}`,
      date: at,
      actor: currentUser.fullName,
      action: so.erpHandoff!.state === 'failed' ? 'Resubmitted to ERP' : 'Submitted to ERP',
      detail: reference ? `${so.number} → ${reference}` : `${so.number} submitted to ERP`,
    };
    const submitted: ErpHandoffRecord = {
      ...so.erpHandoff!,
      state: 'submitted',
      reference: reference || so.erpHandoff!.reference,
      revisionNumber: so.revisionNumber,
      updatedAt: at,
      processedAt: undefined,
      processedBy: undefined,
      failureReason: undefined,
    };
    const activityAfterSubmit = [...so.activity, submitEntry];
    updateSalesOrder(so.id, { erpHandoff: submitted, activity: activityAfterSubmit });
    addToast({ type: 'info', title: 'Submitted to ERP', message: `${so.number} is being processed by the ERP.` });

    // Simulate the ERP acknowledging the order shortly after.
    window.setTimeout(() => {
      const at2 = new Date().toISOString();
      const accepted: ErpHandoffRecord = { ...submitted, state: 'accepted', updatedAt: at2, processedAt: at2, processedBy: 'ERP Bridge' };
      updateSalesOrder(so.id, {
        erpHandoff: accepted,
        activity: [
          ...activityAfterSubmit,
          { id: `act-${so.id}-erpaccept-${Date.now()}`, date: at2, actor: 'ERP Bridge', action: 'Accepted by ERP', detail: `${so.number} accepted by ERP` },
        ],
      });
      addToast({ type: 'success', title: 'Accepted by ERP', message: `${so.number} was accepted.` });
    }, 1300);
  };

  const columns: Column<SalesOrder>[] = [
    {
      key: 'so',
      header: 'SO Number',
      width: '168px',
      sticky: 'left',
      sortValue: (r) => r.number,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-surface-800">{r.number}</span>
          {r.revisionNumber > 0 && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">Rev {r.revisionNumber}</span>
          )}
          {r.id === highlight && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">New</span>
          )}
        </span>
      ),
    },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, sortValue: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'po', header: 'Customer PO No.', width: '150px', truncate: true, title: (r) => r.poNumber, sortValue: (r) => r.poNumber, render: (r) => <span className="text-surface-600">{r.poNumber}</span> },
    { key: 'poDate', header: 'PO Date', width: '112px', sortValue: (r) => r.poDate, render: (r) => <span className="text-surface-600">{formatDate(r.poDate)}</span> },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', truncate: true, title: (r) => r.owner, sortValue: (r) => r.owner, render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'value', header: 'Order Value', width: '120px', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    {
      key: 'submitted',
      header: 'Submitted Date',
      width: '124px',
      sortValue: (r) => r.erpHandoff!.submittedAt,
      render: (r) => <span className="text-surface-600">{formatDate(r.erpHandoff!.submittedAt)}</span>,
    },
    {
      key: 'state',
      header: 'Handoff Status',
      width: '148px',
      sortValue: (r) => r.erpHandoff!.state,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge tone={ERP_HANDOFF_STATE[r.erpHandoff!.state].tone} label={ERP_HANDOFF_STATE[r.erpHandoff!.state].label} />
          <span className="text-[11px] text-surface-400">Updated {formatDate(r.erpHandoff!.updatedAt)}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '124px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button type="button" className={iconBtn} title="View Sales Order" aria-label={`View ${r.number}`} onClick={() => setActive(r)}>
            <Eye className="h-4 w-4" />
          </button>
          <button type="button" className={iconBtn} title="Download Sales Order" aria-label={`Download ${r.number}`} disabled={!canDownload} onClick={() => downloadOne(r)}>
            <Download className="h-4 w-4" />
          </button>
          {r.erpHandoff!.state === 'pending' && (
            <button type="button" className={iconBtn} title="Submit to ERP" aria-label={`Submit ${r.number} to ERP`} disabled={!canSubmit} onClick={() => setSubmitFor(r)}>
              <Send className="h-4 w-4" />
            </button>
          )}
          {r.erpHandoff!.state === 'failed' && (
            <button type="button" className={`${iconBtn} text-red-500 hover:text-red-600`} title="Retry ERP submission" aria-label={`Retry ${r.number}`} disabled={!canSubmit} onClick={() => pushToErp(r)}>
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="ERP Handoff"
          description="Final approved Sales Orders pushed to the ERP for manufacturing."
          crumbs={[{ label: 'ERP Handoff' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="ERP Handoff"
        description="Final approved Sales Orders pushed to the ERP for manufacturing."
        crumbs={[{ label: 'ERP Handoff' }]}
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={clearAll}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search SO, PO or customer…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
            <FilterSelect value={owner} onChange={setOwner} placeholder="All owners" options={owners.map((o) => ({ value: o, label: o }))} />
            <FilterSelect value={state} onChange={setState} placeholder="All statuses" options={HANDOFF_STATES} />
          </FilterBar>
        </div>
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => setActive(r)}
          rowClassName={(r) => (r.id === highlight ? 'bg-emerald-50/70' : undefined)}
          emptyTitle="No Sales Orders are currently in the ERP Handoff queue."
          emptyMessage="Approved Sales Orders from Global Inbox and Create SO Manually appear here for ERP handoff."
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <SalesOrderDetailsDrawer order={active} onClose={() => setActive(null)} />

      <SubmitModal
        order={submitFor}
        onClose={() => setSubmitFor(null)}
        onConfirm={(reference) => {
          pushToErp(submitFor!, reference);
          setSubmitFor(null);
        }}
      />
    </>
  );
}

function SubmitModal({
  order,
  onClose,
  onConfirm,
}: {
  order: SalesOrder | null;
  onClose: () => void;
  onConfirm: (reference: string) => void;
}) {
  const [reference, setReference] = useState('');

  // Reset the field each time a different order is opened.
  useEffect(() => {
    setReference('');
  }, [order?.id]);

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onConfirm(reference.trim())}>Submit to ERP</Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Send className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-surface-800">Submit to ERP</h3>
          <p className="mt-1 text-[12px] leading-[18px] text-surface-500">
            Push this Sales Order to the ERP for manufacturing. It moves to Submitted, then Accepted once the ERP acknowledges it.
          </p>
          {order && (
            <p className="mt-2 text-[12px] text-surface-500">
              <span className="font-medium text-surface-700">{order.number}</span>
              {order.revisionNumber > 0 && <span className="text-surface-400"> · Rev {order.revisionNumber}</span>} · {order.customerName}
            </p>
          )}
          <div className="mt-4">
            <TextAreaField
              label="ERP Reference / Note"
              rows={3}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional — e.g. ERP-SO-2026-0042 or a note for the manufacturing team"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
