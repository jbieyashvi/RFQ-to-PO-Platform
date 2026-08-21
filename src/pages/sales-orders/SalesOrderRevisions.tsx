import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
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
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import type { SalesOrder } from '@/types';
import { formatDateTime } from '@/lib/format';
import { SLA_FILTER_OPTIONS, revisionReceivedAtOf, revisionSla, slaDueAt } from '@/lib/sla';
import { inboxUrl } from '@/lib/inboxContext';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function SalesOrderRevisions() {
  const { salesOrders, role, emails } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [sla, setSla] = useState('');
  const loading = useSimulatedLoading([]);

  const ownerOf = (so: SalesOrder) => so.revisionOwner ?? so.owner;

  // Sales Order Revision is handled through the client conversation in the
  // Global Inbox, consistent with Quotes Revision and PO vs Quote. Open finds
  // the seeded revision-request email for this SO and deep-links to the inbox
  // with the Sales Order Revision workspace in the right panel.
  const openInbox = (so: SalesOrder) => {
    const match = emails.find((e) => e.soRevisionId === so.id && !e.sent && (!e.partyId || e.partyId === so.partyId));
    const emailId = match?.id ?? `em-so-rev-${so.id}`;
    // One context object, every id taken from THIS sales-order record.
    navigate(
      inboxUrl({
        emailId,
        customerId: so.partyId,
        inquiryId: so.quotationId ?? null,
        mode: 'so-revision',
        so: so.number,
      })
    );
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return salesOrders.filter((so) => {
      if (!inScope(so.officeId) || !so.revisionState) return false;
      if (office && so.officeId !== office) return false;
      if (sla && revisionSla(so)?.state !== sla) return false;
      // Search by SO number, customer and owner only (never revision reason/state).
      if (s && !`${so.number} ${so.customerName} ${ownerOf(so)}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [salesOrders, inScope, search, office, sla]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (sla) chips.push({ key: 'sla', label: `SLA: ${SLA_FILTER_OPTIONS.find((o) => o.value === sla)?.label ?? sla}`, onRemove: () => setSla('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const columns: Column<SalesOrder>[] = [
    { key: 'so', header: 'SO No', width: '128px', sticky: 'left', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, sortValue: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'received', header: 'Received At', width: '148px', sortValue: (r) => revisionReceivedAtOf(r) ?? '', render: (r) => { const at = revisionReceivedAtOf(r); return <span className="text-surface-600">{at ? formatDateTime(at) : '—'}</span>; } },
    { key: 'due', header: 'Due Date', width: '148px', sortValue: (r) => { const at = revisionReceivedAtOf(r); return at ? slaDueAt(at) : ''; }, render: (r) => { const at = revisionReceivedAtOf(r); return <span className="text-surface-600">{at ? formatDateTime(slaDueAt(at)) : '—'}</span>; } },
    { key: 'sla', header: 'SLA Status', width: '132px', sortValue: (r) => revisionSla(r)?.state ?? '', render: (r) => { const info = revisionSla(r); return info ? <StatusBadge tone={info.tone} label={info.label} dot /> : <span className="text-surface-400">—</span>; } },
    { key: 'owner', header: 'Owner', truncate: true, title: (r) => ownerOf(r), render: (r) => <span className="text-surface-600">{ownerOf(r)}</span> },
    {
      key: 'actions',
      header: 'Action',
      width: '104px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="secondary" rightIcon={<ArrowRight className="h-3.5 w-3.5" />} aria-label={`Open ${r.number}`} onClick={() => openInbox(r)}>
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
          title="Sales Order Revision"
          description="Sales orders under revision. Open a record to handle the client's revision request in the Global Inbox and issue a revised Sales Order."
          crumbs={[{ label: 'Sales Orders' }, { label: 'Sales Order Revision' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sales Order Revision"
        description="Sales orders under revision. Open a record to handle the client's revision request in the Global Inbox and issue a revised Sales Order."
        crumbs={[{ label: 'Sales Orders' }, { label: 'Sales Order Revision' }]}
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setSla(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search SO number or customer…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
            <FilterSelect value={sla} onChange={setSla} placeholder="All SLA" options={SLA_FILTER_OPTIONS} />
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => openInbox(r)} emptyTitle="No revisions here" emptyMessage="No sales orders are currently under revision." />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>
    </>
  );
}
