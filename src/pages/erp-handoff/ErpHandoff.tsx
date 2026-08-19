import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Eye, ArrowLeftRight, AlertTriangle } from 'lucide-react';
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
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import type { SalesOrder } from '@/types';
import { ERP_HANDOFF_STATE, ERP_HANDOFF_SOURCE } from '@/lib/labels';
import { downloadText, formatDate, formatDateTime, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

const HANDOFF_STATES = [
  { value: 'pending', label: 'Pending' },
  { value: 'handed_over', label: 'Handed Over' },
];

export default function ErpHandoff() {
  const { salesOrders, role, currentUser, can, updateSalesOrder, addToast } = useApp();
  const inScope = useOfficeScope();
  const location = useLocation();

  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [owner, setOwner] = useState('');
  const [state, setState] = useState('');

  const [active, setActive] = useState<SalesOrder | null>(null);
  const [handoverFor, setHandoverFor] = useState<SalesOrder | null>(null);
  const loading = useSimulatedLoading([]);

  // A freshly-created SO passes its id via router state so we can highlight it.
  const highlightId = (location.state as { highlightId?: string } | null)?.highlightId ?? null;
  const [highlight, setHighlight] = useState<string | null>(highlightId);
  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlight(null), 5000);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  const canHandover = can('erp_handoff', 'edit');
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
  if (state) chips.push({ key: 's', label: `State: ${ERP_HANDOFF_STATE[state as keyof typeof ERP_HANDOFF_STATE].label}`, onRemove: () => setState('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => { setSearch(''); setOffice(''); setOwner(''); setState(''); };

  const downloadOne = (so: SalesOrder) => {
    downloadText(
      `${so.number.replace(/\//g, '-')}.txt`,
      `SALES ORDER ${so.number}\nPO ${so.poNumber} (${formatDate(so.poDate)})\nCustomer ${so.customerName}\nSales Office ${officeName(so.officeId)}\nOwner ${so.owner}\nValue ${formatINR(so.value)}`
    );
    addToast({ type: 'info', title: 'Download started', message: so.number });
  };

  const columns: Column<SalesOrder>[] = [
    {
      key: 'so',
      header: 'SO Number',
      width: '150px',
      sticky: 'left',
      sortValue: (r) => r.number,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-surface-800">{r.number}</span>
          {r.id === highlight && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">New</span>
          )}
        </span>
      ),
    },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, sortValue: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'po', header: 'PO Number', truncate: true, title: (r) => r.poNumber, render: (r) => <span className="text-surface-600">{r.poNumber}</span> },
    { key: 'poDate', header: 'PO Date', width: '112px', sortValue: (r) => r.poDate, render: (r) => <span className="text-surface-600">{formatDate(r.poDate)}</span> },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', truncate: true, title: (r) => r.owner, sortValue: (r) => r.owner, render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'value', header: 'Order Value', width: '112px', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    {
      key: 'source',
      header: 'Source',
      width: '168px',
      truncate: true,
      title: (r) => ERP_HANDOFF_SOURCE[r.erpHandoff!.source],
      sortValue: (r) => ERP_HANDOFF_SOURCE[r.erpHandoff!.source],
      render: (r) => <span className="text-surface-600">{ERP_HANDOFF_SOURCE[r.erpHandoff!.source]}</span>,
    },
    {
      key: 'state',
      header: 'Handoff State',
      width: '128px',
      sortValue: (r) => r.erpHandoff!.state,
      render: (r) => <StatusBadge tone={ERP_HANDOFF_STATE[r.erpHandoff!.state].tone} label={ERP_HANDOFF_STATE[r.erpHandoff!.state].label} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '120px',
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
            <button type="button" className={iconBtn} title="Handover to ERP" aria-label={`Handover ${r.number} to ERP`} disabled={!canHandover} onClick={() => setHandoverFor(r)}>
              <ArrowLeftRight className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="ERP Handoff"
        description="Sales Orders ready for manufacturing and ERP processing."
        crumbs={[{ label: 'ERP Handoff' }]}
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={clearAll}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search SO, PO or customer…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
            <FilterSelect value={owner} onChange={setOwner} placeholder="All owners" options={owners.map((o) => ({ value: o, label: o }))} />
            <FilterSelect value={state} onChange={setState} placeholder="All states" options={HANDOFF_STATES} />
          </FilterBar>
        </div>
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => setActive(r)}
          rowClassName={(r) => (r.id === highlight ? 'bg-emerald-50/70' : undefined)}
          emptyTitle="No Sales Orders are currently awaiting ERP handoff."
          emptyMessage="Sales Orders from PO vs Quote Verification and Create SO Manually appear here for ERP handoff."
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <SalesOrderDetailsDrawer order={active} onClose={() => setActive(null)} />

      <HandoverModal
        order={handoverFor}
        onClose={() => setHandoverFor(null)}
        onConfirm={(reference) => {
          const so = handoverFor!;
          const at = new Date().toISOString();
          updateSalesOrder(so.id, {
            erpHandoff: { ...so.erpHandoff!, state: 'handed_over', handedOverBy: currentUser.fullName, handedOverAt: at, reference },
            activity: [
              ...so.activity,
              { id: `act-${so.id}-handoff-${at}`, date: at, actor: currentUser.fullName, action: 'Handed over to ERP', detail: reference },
            ],
          });
          addToast({ type: 'success', title: 'Handed over', message: 'Sales Order handed over successfully.' });
          setHandoverFor(null);
        }}
      />
    </>
  );
}

const REFERENCE_ERROR = 'Enter an ERP reference or handoff note.';

function HandoverModal({
  order,
  onClose,
  onConfirm,
}: {
  order: SalesOrder | null;
  onClose: () => void;
  onConfirm: (reference: string) => void;
}) {
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);

  // Reset the field each time a different order is opened.
  useEffect(() => {
    setReference('');
    setTouched(false);
  }, [order?.id]);

  const valid = reference.trim().length > 0;

  return (
    <Modal
      open={!!order}
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              if (!valid) { setTouched(true); return; }
              onConfirm(reference.trim());
            }}
          >
            Confirm Handoff
          </Button>
        </>
      }
    >
      <div className="flex gap-4">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-surface-800">Confirm ERP Handoff</h3>
          <p className="mt-1 text-[12px] leading-[18px] text-surface-500">
            Confirm that this Sales Order is ready to be handed over for manufacturing and ERP processing.
          </p>
          {order && (
            <p className="mt-2 text-[12px] text-surface-500">
              <span className="font-medium text-surface-700">{order.number}</span> · {order.customerName}
            </p>
          )}
          <div className="mt-4">
            <TextAreaField
              label="ERP Reference / Handoff Note"
              required
              rows={3}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onBlur={() => setTouched(true)}
              error={touched && !valid ? REFERENCE_ERROR : undefined}
              placeholder="e.g. ERP-SO-2026-0042 or a note for the manufacturing team"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
