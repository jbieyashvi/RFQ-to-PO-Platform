import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, Eye } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  DataTable,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  StatusBadge,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { SalesOrderDetailsDrawer } from '@/components/SalesOrderDetails';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import type { ErpHandoffSource, SalesOrder } from '@/types';
import { ERP_HANDOFF_STATE, ERP_HANDOFF_SOURCE } from '@/lib/labels';
import { downloadText, formatDate, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100 hover:text-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

export default function ErpHandoff() {
  const { salesOrders, role, can, addToast } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const location = useLocation();

  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');

  const [active, setActive] = useState<SalesOrder | null>(null);
  const loading = useSimulatedLoading([]);

  // A freshly-created SO passes its id via router state so we can highlight it.
  const highlightId = (location.state as { highlightId?: string } | null)?.highlightId ?? null;
  const [highlight, setHighlight] = useState<string | null>(highlightId);
  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlight(null), 5000);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  const canDownload = can('erp_handoff', 'download');

  // Every SO ever submitted to the ERP — records stay permanently visible.
  // Submitted is the only handoff state there is: nothing that has not been
  // submitted (and no downstream ERP outcome) belongs on this screen.
  const records = useMemo(
    () =>
      salesOrders
        .filter((so) => so.erpHandoff?.state === 'submitted' && inScope(so.officeId))
        .sort((a, b) => b.erpHandoff!.submittedAt.localeCompare(a.erpHandoff!.submittedAt)),
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
      if (source && so.erpHandoff!.source !== source) return false;
      // Search by SO number, PO number, customer and where it came from.
      const hay = `${so.number} ${so.poNumber} ${so.customerName} ${ERP_HANDOFF_SOURCE[so.erpHandoff!.source]}`;
      if (s && !hay.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [records, search, office, owner, source]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (owner) chips.push({ key: 'w', label: `Owner: ${owner}`, onRemove: () => setOwner('') });
  if (source) chips.push({ key: 's', label: `Source: ${ERP_HANDOFF_SOURCE[source as ErpHandoffSource]}`, onRemove: () => setSource('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => { setSearch(''); setOffice(''); setOwner(''); setSource(''); };

  const downloadOne = (so: SalesOrder) => {
    downloadText(
      `${so.number.replace(/\//g, '-')}.txt`,
      `SALES ORDER ${so.number}${so.revisionNumber > 0 ? ` (Rev ${so.revisionNumber})` : ''}\nPO ${so.poNumber} (${formatDate(so.poDate)})\nCustomer ${so.customerName}\nSales Office ${officeName(so.officeId)}\nOwner ${so.owner}\nValue ${formatINR(so.value)}\nSource ${ERP_HANDOFF_SOURCE[so.erpHandoff!.source]}\nRevision ${so.revisionNumber > 0 ? `Rev ${so.revisionNumber}` : 'Original'}\nHandoff Status ${ERP_HANDOFF_STATE[so.erpHandoff!.state].label}`
    );
    addToast({ type: 'info', title: 'Download started', message: so.number });
  };

  const columns: Column<SalesOrder>[] = [
    {
      key: 'so',
      header: 'SO Number',
      width: '156px',
      sticky: 'left',
      sortValue: (r) => r.number,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-surface-800">{r.number}</span>
          {/* The revision lives beside the number, not in a column of its own. */}
          <span
            className={
              r.revisionNumber > 0
                ? 'rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700'
                : 'rounded bg-surface-100 px-1.5 py-0.5 text-[10px] font-semibold text-surface-500'
            }
          >
            {r.revisionNumber > 0 ? `Rev ${r.revisionNumber}` : 'Original'}
          </span>
          {r.id === highlight && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">New</span>
          )}
        </span>
      ),
    },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, sortValue: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'po', header: 'Customer PO No.', width: '112px', truncate: true, title: (r) => r.poNumber, sortValue: (r) => r.poNumber, render: (r) => <span className="text-surface-600">{r.poNumber}</span> },
    {
      key: 'source',
      header: 'Source',
      width: '108px',
      sortValue: (r) => ERP_HANDOFF_SOURCE[r.erpHandoff!.source],
      render: (r) => (
        <span className="inline-flex items-center rounded-full border border-surface-200 bg-surface-50 px-2 py-0.5 text-[11px] font-medium text-surface-600">
          {ERP_HANDOFF_SOURCE[r.erpHandoff!.source]}
        </span>
      ),
    },
    { key: 'office', header: 'Sales Office', width: '88px', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', width: '96px', truncate: true, title: (r) => r.owner, sortValue: (r) => r.owner, render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'value', header: 'Order Value', width: '96px', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    {
      key: 'submitted',
      header: 'Submitted',
      width: '104px',
      sortValue: (r) => r.erpHandoff!.submittedAt,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge tone={ERP_HANDOFF_STATE[r.erpHandoff!.state].tone} label={ERP_HANDOFF_STATE[r.erpHandoff!.state].label} />
          <span className="text-[11px] text-surface-400">{formatDate(r.erpHandoff!.submittedAt)}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '76px',
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
            <FilterSelect value={source} onChange={setSource} placeholder="All sources" options={[{ value: 'po_verification', label: ERP_HANDOFF_SOURCE.po_verification }, { value: 'manual', label: ERP_HANDOFF_SOURCE.manual }]} />
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
          emptyMessage="Sales Orders submitted from the Global Inbox or entered through Create SO Manually appear here for ERP handoff."
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <SalesOrderDetailsDrawer order={active} onClose={() => setActive(null)} />
    </>
  );
}
