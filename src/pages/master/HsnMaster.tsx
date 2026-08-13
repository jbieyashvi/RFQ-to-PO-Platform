import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Download, Power } from 'lucide-react';
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
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  ConfirmDialog,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { IconBtn } from './ItemMaster';
import { useApp } from '@/context/AppContext';
import type { Hsn } from '@/types';
import { downloadCSV } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const GST_RATES = [0, 5, 12, 18, 28];
const empty = (): Hsn => ({ id: '', code: '', description: '', gstRate: 18, active: true });

export default function HsnMaster() {
  const { hsn, upsertHsn, can, addToast } = useApp();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [rate, setRate] = useState('');
  const [editing, setEditing] = useState<Hsn | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirm, setConfirm] = useState<Hsn | null>(null);
  const loading = useSimulatedLoading([]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return hsn.filter((h) => {
      if (status === 'active' && !h.active) return false;
      if (status === 'inactive' && h.active) return false;
      if (rate && String(h.gstRate) !== rate) return false;
      if (s && !`${h.code} ${h.description}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [hsn, search, status, rate]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered);

  const chips: FilterChip[] = [];
  if (status) chips.push({ key: 's', label: `Status: ${status}`, onRemove: () => setStatus('') });
  if (rate) chips.push({ key: 'r', label: `GST: ${rate}%`, onRemove: () => setRate('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const exportCSV = () => {
    const header = ['HSN Code', 'Description', 'GST Rate', 'Status'];
    const rows = filtered.map((h) => [h.code, h.description, `${h.gstRate}%`, h.active ? 'Active' : 'Inactive']);
    downloadCSV('hsn-master.csv', [header, ...rows]);
    addToast({ type: 'success', title: 'Export complete', message: `${filtered.length} HSN codes exported.` });
  };

  const columns: Column<Hsn>[] = [
    { key: 'code', header: 'HSN Code', sortValue: (r) => r.code, render: (r) => <span className="font-medium text-surface-800">{r.code}</span> },
    { key: 'desc', header: 'Description', render: (r) => <span className="text-surface-700">{r.description}</span> },
    {
      key: 'rate',
      header: 'GST Rate',
      align: 'right',
      sortValue: (r) => r.gstRate,
      render: (r) => <span className="chip">{r.gstRate}%</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge tone={r.active ? 'green' : 'gray'} label={r.active ? 'Active' : 'Inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {can('hsn_master', 'edit') && (
            <IconBtn title="Edit" onClick={() => { setEditing({ ...r }); setIsNew(false); }}>
              <Pencil className="h-4 w-4" />
            </IconBtn>
          )}
          {can('hsn_master', 'edit') && (
            <IconBtn title={r.active ? 'Deactivate' : 'Activate'} onClick={() => setConfirm(r)}>
              <Power className={r.active ? 'h-4 w-4 text-emerald-500' : 'h-4 w-4 text-surface-400'} />
            </IconBtn>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="HSN Master"
        description="Harmonised System of Nomenclature codes and applicable GST rates."
        crumbs={[{ label: 'Master' }, { label: 'HSN Master' }]}
        actions={
          <>
            {can('hsn_master', 'download') && (
              <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>
                Export CSV
              </Button>
            )}
            {can('hsn_master', 'create') && (
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(empty()); setIsNew(true); }}>
                Add HSN
              </Button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setStatus(''); setRate(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search code or description…" className="w-full sm:w-72" />
            <FilterSelect value={rate} onChange={setRate} placeholder="All GST rates" options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} />
            <FilterSelect value={status} onChange={setStatus} placeholder="All statuses" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} emptyTitle="No HSN codes found" />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <HsnForm
        hsn={editing}
        isNew={isNew}
        onClose={() => setEditing(null)}
        onSave={(h) => {
          upsertHsn(h);
          addToast({ type: 'success', title: isNew ? 'HSN added' : 'HSN updated', message: `${h.code} • ${h.gstRate}% GST` });
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) {
            upsertHsn({ ...confirm, active: !confirm.active });
            addToast({ type: 'success', title: confirm.active ? 'HSN deactivated' : 'HSN activated', message: confirm.code });
          }
        }}
        title={confirm?.active ? 'Deactivate HSN code?' : 'Activate HSN code?'}
        message={confirm?.active ? `${confirm?.code} won't be selectable for new items.` : `${confirm?.code} will be available again.`}
        confirmLabel={confirm?.active ? 'Deactivate' : 'Activate'}
        danger={confirm?.active}
      />
    </>
  );
}

function HsnForm({ hsn, isNew, onClose, onSave }: { hsn: Hsn | null; isNew: boolean; onClose: () => void; onSave: (h: Hsn) => void }) {
  const [form, setForm] = useState<Hsn>(empty());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (hsn) { setForm(hsn); setErrors({}); } }, [hsn]);
  if (!hsn) return null;

  const submit = () => {
    const e: Record<string, string> = {};
    if (!/^\d{4,8}$/.test(form.code.trim())) e.code = 'Enter a valid 4-8 digit HSN code';
    if (!form.description.trim()) e.description = 'Description is required';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ ...form, id: form.id || `hsn-${Date.now()}` });
  };

  return (
    <Modal
      open={!!hsn}
      onClose={onClose}
      title={isNew ? 'Add HSN Code' : 'Edit HSN Code'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{isNew ? 'Add HSN' : 'Save Changes'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="HSN Code" required value={form.code} error={errors.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="e.g. 8536" />
        <TextAreaField label="Description" required rows={3} value={form.description} error={errors.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <SelectField label="GST Rate" required value={String(form.gstRate)} onChange={(e) => setForm((f) => ({ ...f, gstRate: Number(e.target.value) }))} options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))} />
        <Toggle checked={form.active} onChange={(v) => setForm((f) => ({ ...f, active: v }))} label={form.active ? 'Active' : 'Inactive'} />
      </div>
    </Modal>
  );
}
