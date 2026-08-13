import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  StickyNote,
  UploadCloud,
  ArrowRight,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  StatusBadge,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  Drawer,
  Modal,
  FileUpload,
  TextAreaField,
  DescList,
  type Column,
  type FilterChip,
  type UploadedFile,
} from '@/components/ui';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { VERIFICATION_STATUS } from '@/lib/labels';
import type { SalesOrder, VerificationStatus } from '@/types';
import { classNames, formatDate, formatDateTime, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

export default function Verification() {
  const { salesOrders, role, updateSalesOrder, can, addToast } = useApp();
  const inScope = useOfficeScope();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [status, setStatus] = useState('');
  const [active, setActive] = useState<SalesOrder | null>(null);
  const loading = useSimulatedLoading([]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return salesOrders.filter((so) => {
      if (!inScope(so.officeId)) return false;
      if (office && so.officeId !== office) return false;
      if (status && so.verificationStatus !== status) return false;
      if (s && !`${so.poNumber} ${so.quotationNumber} ${so.customerName} ${so.number}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [salesOrders, inScope, search, office, status]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (status) chips.push({ key: 's', label: `Status: ${VERIFICATION_STATUS[status as VerificationStatus].label}`, onRemove: () => setStatus('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const columns: Column<SalesOrder>[] = [
    { key: 'po', header: 'PO Number', width: '124px', sticky: 'left', sortValue: (r) => r.poNumber, render: (r) => <span className="font-medium text-surface-800">{r.poNumber}</span> },
    { key: 'qtn', header: 'Quotation No', width: '112px', render: (r) => <span className="text-surface-600">{r.quotationNumber ?? '—'}</span> },
    { key: 'customer', header: 'Customer', truncate: true, title: (r) => r.customerName, sortValue: (r) => r.customerName, render: (r) => <span className="font-medium text-surface-800">{r.customerName}</span> },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'poval', header: 'PO Value', width: '96px', align: 'right', sortValue: (r) => r.poValue, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.poValue)}</span> },
    {
      key: 'qval',
      header: 'Quote Value',
      width: '96px',
      align: 'right',
      render: (r) => (
        <span className={classNames(Math.abs(r.poValue - r.quoteValue) > 0.5 ? 'font-medium text-rose-600' : 'text-surface-600')}>
          {formatINR(r.quoteValue)}
        </span>
      ),
    },
    { key: 'received', header: 'Received', width: '92px', sortValue: (r) => r.receivedDate, render: (r) => <span className="text-surface-600">{formatDate(r.receivedDate, { short: true })}</span> },
    { key: 'vstatus', header: 'Verification', width: '172px', render: (r) => <StatusBadge tone={VERIFICATION_STATUS[r.verificationStatus].tone} label={VERIFICATION_STATUS[r.verificationStatus].label} /> },
    {
      key: 'actions',
      header: 'Actions',
      width: '86px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setActive(r); }}>
          Verify
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="PO vs Quote Verification"
        description="Compare each customer PO against its accepted quotation before creating a sales order."
        crumbs={[{ label: 'Sales Orders' }, { label: 'PO vs Quote Verification' }]}
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setStatus(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search PO, quotation, customer…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
            <FilterSelect value={status} onChange={setStatus} placeholder="All verification states" options={Object.entries(VERIFICATION_STATUS).map(([k, v]) => ({ value: k, label: v.label }))} />
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => setActive(r)} emptyTitle="No POs to verify" />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      {active && (
        <VerificationDrawer
          so={active}
          onClose={() => setActive(null)}
          canEdit={can('sales_orders', 'edit')}
          onUpdate={(patch) => {
            updateSalesOrder(active.id, patch);
            setActive({ ...active, ...patch });
          }}
          onToast={addToast}
          onContinue={() => {
            setActive(null);
            navigate('/sales-orders/create');
          }}
        />
      )}
    </>
  );
}

function VerificationDrawer({
  so,
  onClose,
  canEdit,
  onUpdate,
  onToast,
  onContinue,
}: {
  so: SalesOrder;
  onClose: () => void;
  canEdit: boolean;
  onUpdate: (patch: Partial<SalesOrder>) => void;
  onToast: (t: { type: 'success' | 'info' | 'warning'; title: string; message?: string }) => void;
  onContinue: () => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedFile[]>([]);

  const mismatches = so.verificationFields.filter((f) => !f.match).length;
  const verified = so.verificationStatus === 'verified';

  const setStatus = (verificationStatus: VerificationStatus, label: string) => {
    onUpdate({ verificationStatus });
    onToast({ type: verificationStatus === 'mismatch' ? 'warning' : 'success', title: label, message: `${so.poNumber} • ${so.customerName}` });
  };

  const addNote = () => {
    if (!note.trim()) return;
    onUpdate({
      internalNotes: [
        ...so.internalNotes,
        { id: `note-${Date.now()}`, date: '2026-08-13T12:00:00', author: so.owner, text: note.trim() },
      ],
    });
    onToast({ type: 'success', title: 'Note added', message: 'Internal note saved to this PO.' });
    setNote('');
    setNoteOpen(false);
  };

  const doUpload = () => {
    onUpdate({ verificationStatus: 'pending' });
    onToast({ type: 'success', title: 'Corrected PO uploaded', message: `${uploaded.length} file(s) attached. Re-verification pending.` });
    setUploaded([]);
    setUploadOpen(false);
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={`Verify ${so.poNumber}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{so.customerName}</span>
          <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {officeName(so.officeId)}</span>
          <span>Quote: {so.quotationNumber}</span>
        </span>
      }
      headerExtra={<StatusBadge tone={VERIFICATION_STATUS[so.verificationStatus].tone} label={VERIFICATION_STATUS[so.verificationStatus].label} />}
      footer={
        canEdit ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" leftIcon={<StickyNote className="h-4 w-4" />} onClick={() => setNoteOpen(true)}>Add Note</Button>
              <Button variant="secondary" size="sm" leftIcon={<UploadCloud className="h-4 w-4" />} onClick={() => setUploadOpen(true)}>Upload Corrected PO</Button>
              <Button variant="danger" size="sm" leftIcon={<XCircle className="h-4 w-4" />} onClick={() => setStatus('mismatch', 'Mismatch flagged')}>Flag Mismatch</Button>
              <Button variant="primary" size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setStatus('verified', 'Marked as verified')}>Mark Verified</Button>
            </div>
            <Button variant="primary" size="sm" rightIcon={<ArrowRight className="h-4 w-4" />} disabled={!verified} onClick={onContinue}>
              Continue to Create SO
            </Button>
          </div>
        ) : (
          <p className="text-sm text-amber-600">Your role cannot verify POs.</p>
        )
      }
    >
      <div className="space-y-5">
        {/* Summary banner */}
        <div
          className={classNames(
            'flex items-center gap-3 rounded-xl border p-4',
            mismatches > 0 ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'
          )}
        >
          <div className={classNames('flex h-10 w-10 flex-none items-center justify-center rounded-full', mismatches > 0 ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600')}>
            {mismatches > 0 ? <XCircle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
          </div>
          <div>
            <p className={classNames('text-sm font-semibold', mismatches > 0 ? 'text-rose-800' : 'text-emerald-800')}>
              {mismatches > 0 ? `${mismatches} field${mismatches > 1 ? 's' : ''} do not match` : 'All fields match the accepted quotation'}
            </p>
            <p className={classNames('text-xs', mismatches > 0 ? 'text-rose-600' : 'text-emerald-600')}>
              {mismatches > 0 ? 'Resolve mismatches or request a corrected PO before creating the SO.' : 'This PO is ready to be verified and converted to a sales order.'}
            </p>
          </div>
        </div>

        {/* Comparison table */}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-surface-800">Quote vs PO Comparison</h4>
          <div className="overflow-x-auto rounded-xl border border-surface-200">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-surface-200 bg-surface-50 text-xs font-semibold uppercase tracking-wide text-surface-500">
                  <th className="px-4 py-2.5 text-left">Field</th>
                  <th className="px-4 py-2.5 text-left">Accepted Quotation</th>
                  <th className="px-4 py-2.5 text-left">Customer PO</th>
                  <th className="px-4 py-2.5 text-center">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {so.verificationFields.map((f, i) => (
                  <tr key={i} className={classNames(!f.match && 'bg-rose-50/60')}>
                    <td className="px-4 py-2.5 font-medium text-surface-700">{f.label}</td>
                    <td className="px-4 py-2.5 text-surface-600">{f.quoteValue}</td>
                    <td className={classNames('px-4 py-2.5', !f.match ? 'font-semibold text-rose-700' : 'text-surface-600')}>{f.poValue}</td>
                    <td className="px-4 py-2.5 text-center">
                      {f.match ? (
                        <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="mx-auto h-4 w-4 text-rose-500" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <DescList
          items={[
            { label: 'PO Number', value: so.poNumber },
            { label: 'PO Date', value: formatDate(so.poDate) },
            { label: 'Quotation', value: so.quotationNumber ?? '—' },
            { label: 'Received Date', value: formatDate(so.receivedDate) },
            { label: 'PO Value', value: formatINR(so.poValue) },
            { label: 'Quote Value', value: formatINR(so.quoteValue) },
          ]}
        />

        {/* Internal notes */}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-surface-800">Internal Notes</h4>
          {so.internalNotes.length === 0 ? (
            <p className="text-sm text-surface-400">No internal notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {so.internalNotes.map((n) => (
                <li key={n.id} className="rounded-lg border border-surface-200 p-3">
                  <p className="text-sm text-surface-700">{n.text}</p>
                  <p className="mt-1 text-xs text-surface-400">{n.author} • {formatDateTime(n.date)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Add Internal Note"
        size="md"
        footer={<><Button variant="secondary" onClick={() => setNoteOpen(false)}>Cancel</Button><Button variant="primary" onClick={addNote} disabled={!note.trim()}>Save Note</Button></>}
      >
        <TextAreaField label="Note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed revised pricing with customer over call…" />
      </Modal>

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload Corrected PO"
        size="md"
        footer={<><Button variant="secondary" onClick={() => setUploadOpen(false)}>Cancel</Button><Button variant="primary" onClick={doUpload} disabled={uploaded.length === 0}>Attach & Re-verify</Button></>}
      >
        <FileUpload files={uploaded} onChange={setUploaded} label="Upload corrected PO document" multiple={false} />
      </Modal>
    </Drawer>
  );
}
