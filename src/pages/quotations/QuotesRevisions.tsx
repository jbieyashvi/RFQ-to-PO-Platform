import { useMemo, useState } from 'react';
import { Eye, Pencil, UploadCloud, CheckCheck, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  Modal,
  FileUpload,
  ConfirmDialog,
  type Column,
  type FilterChip,
  type UploadedFile,
} from '@/components/ui';
import { QuotationDetailsDrawer } from '@/components/QuotationDetails';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import type { Quotation } from '@/types';
import { formatDate, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function QuotesRevisions() {
  const { quotations, role, can, updateQuotation, addToast } = useApp();
  const inScope = useOfficeScope();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [active, setActive] = useState<Quotation | null>(null);
  const [uploadFor, setUploadFor] = useState<Quotation | null>(null);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);
  const [markSent, setMarkSent] = useState<Quotation | null>(null);
  const loading = useSimulatedLoading([]);

  const base = useMemo(
    () => quotations.filter((q) => q.workState === 'needs_revision' && inScope(q.officeId)),
    [quotations, inScope]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return base.filter((q) => {
      if (office && q.officeId !== office) return false;
      if (s && !`${q.number} ${q.customerName} ${q.owner} ${q.revisionReason ?? ''}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [base, search, office]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const doMarkSent = (q: Quotation) => {
    updateQuotation(q.id, {
      workState: 'sent',
      lastUpdated: '2026-08-13',
      revisions: [...q.revisions, { id: `rev-${Date.now()}`, version: q.revisions.length + 1, date: '2026-08-13', reason: 'Revised quotation sent to customer', by: q.owner }],
      activity: [...q.activity, { id: `act-${Date.now()}`, date: '2026-08-13T12:00:00', actor: q.owner, action: 'Revision sent to customer' }],
    });
    addToast({ type: 'success', title: 'Revision sent', message: `${q.number} revision marked as sent.` });
    setMarkSent(null);
  };

  const confirmUpload = () => {
    if (!uploadFor) return;
    updateQuotation(uploadFor.id, {
      attachments: [
        ...uploadFor.attachments,
        ...uploaded.map((u) => ({ id: u.id, name: u.name, size: u.size, uploadedOn: '2026-08-13' })),
      ],
      lastUpdated: '2026-08-13',
      activity: [...uploadFor.activity, { id: `act-${Date.now()}`, date: '2026-08-13T12:00:00', actor: uploadFor.owner, action: 'Revised quote uploaded', detail: uploaded.map((u) => u.name).join(', ') }],
    });
    addToast({ type: 'success', title: 'Revised quote uploaded', message: `${uploaded.length} file(s) attached to ${uploadFor.number}.` });
    setUploadFor(null);
    setUploaded([]);
  };

  const columns: Column<Quotation>[] = [
    { key: 'number', header: 'Quotation No', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    { key: 'customer', header: 'Customer', render: (r) => <div className="max-w-[180px]"><p className="truncate font-medium text-surface-800">{r.customerName}</p><p className="text-xs text-surface-400">{r.customerCode}</p></div> },
    { key: 'office', header: 'Sales Office', render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'reason', header: 'Revision Reason', render: (r) => <span className="block max-w-[220px] truncate text-surface-700" title={r.revisionReason}>{r.revisionReason}</span> },
    { key: 'requested', header: 'Requested', sortValue: (r) => r.revisionRequestedDate ?? '', render: (r) => formatDate(r.revisionRequestedDate ?? '') },
    { key: 'owner', header: 'Owner', render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'value', header: 'Value', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    { key: 'review', header: 'Review', sortValue: (r) => r.reviewDate, render: (r) => formatDate(r.reviewDate) },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => setActive(r)} title="View original" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100"><Eye className="h-4 w-4" /></button>
          {can('quotations', 'edit') && <button onClick={() => setActive(r)} title="Edit revision" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100"><Pencil className="h-4 w-4" /></button>}
          {can('quotations', 'edit') && <button onClick={() => { setUploadFor(r); setUploaded([]); }} title="Upload revised quote" className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100"><UploadCloud className="h-4 w-4" /></button>}
          {can('quotations', 'edit') && <Button size="sm" variant="primary" leftIcon={<CheckCheck className="h-3.5 w-3.5" />} onClick={() => setMarkSent(r)}>Mark Sent</Button>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Quotes Needing Revision"
        description="Quotations returned by customers or reviewers for changes."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Needing Revision' }]}
      />

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
          emptyTitle="No revisions pending"
          emptyMessage="No quotations are currently awaiting revision."
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <QuotationDetailsDrawer quotation={active} onClose={() => setActive(null)} />

      <Modal
        open={!!uploadFor}
        onClose={() => setUploadFor(null)}
        title="Upload Revised Quote"
        subtitle={uploadFor?.number}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setUploadFor(null)}>Cancel</Button>
            <Button variant="primary" onClick={confirmUpload} disabled={uploaded.length === 0}>Attach & Save</Button>
          </>
        }
      >
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <RefreshCw className="mr-1.5 inline h-3.5 w-3.5" />
          {uploadFor?.revisionReason}
        </div>
        <FileUpload files={uploaded} onChange={setUploaded} label="Upload revised quotation" />
      </Modal>

      <ConfirmDialog
        open={!!markSent}
        onClose={() => setMarkSent(null)}
        onConfirm={() => markSent && doMarkSent(markSent)}
        title="Mark revision as sent?"
        message={`${markSent?.number} revision will be recorded and the quotation returned to the active pipeline.`}
        confirmLabel="Mark Revision Sent"
      />
    </>
  );
}
