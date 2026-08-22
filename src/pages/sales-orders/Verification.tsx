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
import { VERIFICATION_STATUS } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';
import { poReceivedAtOf, slaDueAt } from '@/lib/sla';
import { inboxUrl } from '@/lib/inboxContext';
import type { SalesOrder, VerificationStatus } from '@/types';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function Verification() {
  const { salesOrders, emails, role, addToast } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [status, setStatus] = useState('');
  const loading = useSimulatedLoading([]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return salesOrders.filter((so) => {
      if (!inScope(so.officeId)) return false;
      if (office && so.officeId !== office) return false;
      if (status && so.verificationStatus !== status) return false;
      if (s && !`${so.poNumber} ${so.quotationNumber} ${so.customerName} ${so.owner} ${so.number}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [salesOrders, inScope, search, office, status]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (status) chips.push({ key: 's', label: `Status: ${VERIFICATION_STATUS[status as VerificationStatus].label}`, onRemove: () => setStatus('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  // Every verification record links to its originating Purchase Order email in the
  // Global Inbox. Open deep-links to that email; the inbox renders the two-step
  // PO vs Quote workflow. Guard the (prototype-only) case of a missing link.
  const openInInbox = (so: SalesOrder) => {
    // Same customer, same record: the PO email is the one this verification was
    // built from, never one that merely quotes the same document numbers.
    const linked = emails.find((e) => e.poVerifyId === so.id && (!e.partyId || e.partyId === so.partyId));
    if (!linked) {
      addToast({ type: 'error', title: 'Purchase Order email not found', message: 'The source Purchase Order email could not be found.' });
      return;
    }
    // One context object, every id taken from THIS sales-order record.
    navigate(
      inboxUrl({
        emailId: linked.id,
        customerId: so.partyId,
        inquiryId: so.quotationId ?? null,
        mode: 'po-verification',
        po: so.poNumber,
        qtn: so.quotationNumber ?? '',
      })
    );
  };

  const columns: Column<SalesOrder>[] = [
    { key: 'po', header: 'PO Number', width: '128px', sticky: 'left', sortValue: (r) => r.poNumber, render: (r) => <span className="font-medium text-surface-800">{r.poNumber}</span> },
    { key: 'qtn', header: 'Quotation No', width: '120px', render: (r) => <span className="text-surface-600">{r.quotationNumber ?? '—'}</span> },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, sortValue: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', truncate: true, title: (r) => r.owner, sortValue: (r) => r.owner, render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'received', header: 'PO Received At', width: '160px', sortValue: (r) => poReceivedAtOf(r) ?? '', render: (r) => { const at = poReceivedAtOf(r); return <span className="text-surface-600">{at ? formatDateTime(at) : '—'}</span>; } },
    { key: 'due', header: 'Due Date', width: '148px', sortValue: (r) => { const at = poReceivedAtOf(r); return at ? slaDueAt(at) : ''; }, render: (r) => { const at = poReceivedAtOf(r); return <span className="text-surface-600">{at ? formatDateTime(slaDueAt(at)) : '—'}</span>; } },
    { key: 'vstatus', header: 'Verification', width: '176px', render: (r) => <StatusBadge tone={VERIFICATION_STATUS[r.verificationStatus].tone} label={VERIFICATION_STATUS[r.verificationStatus].label} /> },
    {
      key: 'actions',
      header: 'Action',
      width: '92px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <Button size="sm" variant="secondary" rightIcon={<ArrowRight className="h-3.5 w-3.5" />} onClick={(e) => { e.stopPropagation(); openInInbox(r); }}>
          Open
        </Button>
      ),
    },
  ];

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="PO vs Quote Verification"
          description="Open each customer PO in the Global Inbox to compare it against its accepted quotation before a sales order is generated."
          crumbs={[{ label: 'Sales Orders' }, { label: 'PO vs Quote Verification' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="PO vs Quote Verification"
        description="Open each customer PO in the Global Inbox to compare it against its accepted quotation before a sales order is generated."
        crumbs={[{ label: 'Sales Orders' }, { label: 'PO vs Quote Verification' }]}
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setStatus(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search PO, quotation, customer, owner…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
            <FilterSelect value={status} onChange={setStatus} placeholder="All verification states" options={Object.entries(VERIFICATION_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => openInInbox(r)} emptyTitle="No POs to verify" />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>
    </>
  );
}
