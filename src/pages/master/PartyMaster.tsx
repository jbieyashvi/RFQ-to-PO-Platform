import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Eye, Download, Power, Building2 } from 'lucide-react';
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
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  ConfirmDialog,
  DescList,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { IconBtn } from './ItemMaster';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { SECTORS } from '@/lib/labels';
import type { Party } from '@/types';
import { downloadCSV } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const empty = (officeId: string): Party => ({
  id: '',
  code: '',
  companyName: '',
  contactPerson: '',
  email: '',
  phone: '',
  billingAddress: '',
  shippingAddress: '',
  gstin: '',
  sector: SECTORS[0],
  officeId,
  active: true,
});

export default function PartyMaster() {
  const { parties, upsertParty, can, addToast, role, currentUser, offices } = useApp();
  const inScope = useOfficeScope();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [sector, setSector] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Party | null>(null);
  const [viewing, setViewing] = useState<Party | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirm, setConfirm] = useState<Party | null>(null);
  const loading = useSimulatedLoading([]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return parties.filter((p) => {
      if (!inScope(p.officeId)) return false;
      if (office && p.officeId !== office) return false;
      if (sector && p.sector !== sector) return false;
      if (status === 'active' && !p.active) return false;
      if (status === 'inactive' && p.active) return false;
      if (s && !`${p.code} ${p.companyName} ${p.contactPerson} ${p.gstin} ${p.email}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [parties, inScope, search, office, sector, status]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (sector) chips.push({ key: 'sec', label: `Sector: ${sector}`, onRemove: () => setSector('') });
  if (status) chips.push({ key: 'st', label: `Status: ${status}`, onRemove: () => setStatus('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const officeOptions = (role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === currentUser.officeId)).map((o) => ({ value: o.id, label: o.name }));

  const exportCSV = () => {
    const header = ['Customer Code', 'Company Name', 'Contact Person', 'Email', 'Phone', 'GSTIN', 'Sector', 'Sales Office', 'Status'];
    const rows = filtered.map((p) => [p.code, p.companyName, p.contactPerson, p.email, p.phone, p.gstin, p.sector, officeName(p.officeId), p.active ? 'Active' : 'Inactive']);
    downloadCSV('party-master.csv', [header, ...rows]);
    addToast({ type: 'success', title: 'Export complete', message: `${filtered.length} parties exported.` });
  };

  const columns: Column<Party>[] = [
    { key: 'code', header: 'Cust. Code', sortValue: (r) => r.code, render: (r) => <span className="font-medium text-surface-800">{r.code}</span> },
    {
      key: 'company',
      header: 'Company Name',
      sortValue: (r) => r.companyName,
      render: (r) => (
        <div>
          <p className="font-medium text-surface-800">{r.companyName}</p>
          <p className="text-xs text-surface-400">{r.contactPerson}</p>
        </div>
      ),
    },
    { key: 'gstin', header: 'GSTIN', render: (r) => <span className="font-mono text-xs text-surface-500">{r.gstin}</span> },
    { key: 'sector', header: 'Sector', render: (r) => <span className="chip">{r.sector}</span> },
    { key: 'office', header: 'Sales Office', sortValue: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge tone={r.active ? 'green' : 'gray'} label={r.active ? 'Active' : 'Inactive'} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="View" onClick={() => setViewing(r)}><Eye className="h-4 w-4" /></IconBtn>
          {can('party_master', 'edit') && <IconBtn title="Edit" onClick={() => { setEditing({ ...r }); setIsNew(false); }}><Pencil className="h-4 w-4" /></IconBtn>}
          {can('party_master', 'edit') && <IconBtn title={r.active ? 'Deactivate' : 'Activate'} onClick={() => setConfirm(r)}><Power className={r.active ? 'h-4 w-4 text-emerald-500' : 'h-4 w-4 text-surface-400'} /></IconBtn>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Party Master"
        description="Customer accounts, contacts and tax details, tagged to a sales office."
        crumbs={[{ label: 'Master' }, { label: 'Party Master' }]}
        actions={
          <>
            {can('party_master', 'download') && <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>Export CSV</Button>}
            {can('party_master', 'create') && <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(empty(role === 'super_admin' ? OFFICES[0].id : currentUser.officeId)); setIsNew(true); }}>Add Party</Button>}
          </>
        }
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setSector(''); setStatus(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search company, GSTIN, contact…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
            <FilterSelect value={sector} onChange={setSector} placeholder="All sectors" options={SECTORS.map((s) => ({ value: s, label: s }))} />
            <FilterSelect value={status} onChange={setStatus} placeholder="All statuses" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => setViewing(r)} emptyTitle="No parties found" emptyMessage="Adjust filters or add a new customer." />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      {/* View drawer */}
      <Drawer
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.companyName}
        subtitle={<span className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" /> {viewing && officeName(viewing.officeId)}</span>}
        width="lg"
        headerExtra={viewing && <StatusBadge tone={viewing.active ? 'green' : 'gray'} label={viewing.active ? 'Active' : 'Inactive'} />}
      >
        {viewing && (
          <div className="space-y-5">
            <DescList
              items={[
                { label: 'Customer Code', value: viewing.code },
                { label: 'Sector', value: viewing.sector },
                { label: 'Contact Person', value: viewing.contactPerson },
                { label: 'Phone', value: viewing.phone },
                { label: 'Email', value: viewing.email },
                { label: 'GSTIN', value: <span className="font-mono">{viewing.gstin}</span> },
              ]}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-surface-200 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-surface-400">Billing Address</p>
                <p className="mt-1 text-sm text-surface-700">{viewing.billingAddress}</p>
              </div>
              <div className="rounded-xl border border-surface-200 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-surface-400">Shipping Address</p>
                <p className="mt-1 text-sm text-surface-700">{viewing.shippingAddress}</p>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <PartyForm
        party={editing}
        isNew={isNew}
        officeOptions={officeOptions}
        onClose={() => setEditing(null)}
        onSave={(p) => {
          upsertParty(p);
          addToast({ type: 'success', title: isNew ? 'Party added' : 'Party updated', message: p.companyName });
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) {
            upsertParty({ ...confirm, active: !confirm.active });
            addToast({ type: 'success', title: confirm.active ? 'Party deactivated' : 'Party activated', message: confirm.companyName });
          }
        }}
        title={confirm?.active ? 'Deactivate party?' : 'Activate party?'}
        message={confirm?.active ? `${confirm?.companyName} won't appear in new quotations.` : `${confirm?.companyName} will be selectable again.`}
        confirmLabel={confirm?.active ? 'Deactivate' : 'Activate'}
        danger={confirm?.active}
      />
    </>
  );
}

function PartyForm({
  party,
  isNew,
  officeOptions,
  onClose,
  onSave,
}: {
  party: Party | null;
  isNew: boolean;
  officeOptions: { value: string; label: string }[];
  onClose: () => void;
  onSave: (p: Party) => void;
}) {
  const [form, setForm] = useState<Party>(empty(OFFICES[0].id));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (party) { setForm(party); setErrors({}); } }, [party]);
  if (!party) return null;

  const set = <K extends keyof Party>(k: K, v: Party[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    const e: Record<string, string> = {};
    if (!form.code.trim()) e.code = 'Customer code is required';
    if (!form.companyName.trim()) e.companyName = 'Company name is required';
    if (!form.contactPerson.trim()) e.contactPerson = 'Contact person is required';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Enter a valid email';
    if (!/^[+\d][\d\s-]{7,}$/.test(form.phone)) e.phone = 'Enter a valid phone number';
    if (form.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{3}$/.test(form.gstin)) e.gstin = 'Enter a valid 15-char GSTIN';
    if (!form.billingAddress.trim()) e.billingAddress = 'Billing address is required';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ ...form, id: form.id || `pty-${Date.now()}` });
  };

  return (
    <Drawer
      open={!!party}
      onClose={onClose}
      title={isNew ? 'Add Party' : 'Edit Party'}
      subtitle={isNew ? 'Create a new customer account' : form.code}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{isNew ? 'Add Party' : 'Save Changes'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Customer Code" required value={form.code} error={errors.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. CUST-1010" />
        <SelectField label="Assigned Sales Office" required value={form.officeId} onChange={(e) => set('officeId', e.target.value)} options={officeOptions} />
        <TextField wrapClassName="sm:col-span-2" label="Company Name" required value={form.companyName} error={errors.companyName} onChange={(e) => set('companyName', e.target.value)} />
        <TextField label="Contact Person" required value={form.contactPerson} error={errors.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
        <SelectField label="Sector" required value={form.sector} onChange={(e) => set('sector', e.target.value)} options={SECTORS.map((s) => ({ value: s, label: s }))} />
        <TextField label="Email" required type="email" value={form.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
        <TextField label="Phone" required value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} />
        <TextField wrapClassName="sm:col-span-2" label="GSTIN" value={form.gstin} error={errors.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="27AAACR5055K1Z5" />
        <TextAreaField wrapClassName="sm:col-span-2" label="Billing Address" required rows={2} value={form.billingAddress} error={errors.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} />
        <TextAreaField wrapClassName="sm:col-span-2" label="Shipping Address" rows={2} value={form.shippingAddress} onChange={(e) => set('shippingAddress', e.target.value)} hint="Leave blank if same as billing" />
        <div className="flex items-center pt-1"><Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} /></div>
      </div>
    </Drawer>
  );
}
