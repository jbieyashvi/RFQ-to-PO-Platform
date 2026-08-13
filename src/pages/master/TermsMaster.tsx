import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
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
import { TC_CATEGORIES, TC_DOCUMENT } from '@/lib/labels';
import type { TCDocument, TermCondition } from '@/types';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const empty = (): TermCondition => ({
  id: '',
  title: '',
  category: TC_CATEGORIES[0],
  description: '',
  applicableTo: 'both',
  isDefault: false,
  active: true,
});

export default function TermsMaster() {
  const { terms, upsertTerm, removeTerm, can, addToast } = useApp();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [docType, setDocType] = useState('');
  const [editing, setEditing] = useState<TermCondition | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TermCondition | null>(null);
  const loading = useSimulatedLoading([]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return terms.filter((t) => {
      if (category && t.category !== category) return false;
      if (docType && t.applicableTo !== docType && t.applicableTo !== 'both') return false;
      if (s && !`${t.title} ${t.description} ${t.category}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [terms, search, category, docType]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered);

  const chips: FilterChip[] = [];
  if (category) chips.push({ key: 'c', label: `Category: ${category}`, onRemove: () => setCategory('') });
  if (docType) chips.push({ key: 'd', label: `Doc: ${TC_DOCUMENT[docType as TCDocument]}`, onRemove: () => setDocType('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const columns: Column<TermCondition>[] = [
    {
      key: 'title',
      header: 'Title',
      sortValue: (r) => r.title,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-surface-800" title={r.title}>{r.title}</p>
          <p className="truncate text-[11px] text-surface-400" title={r.description}>{r.description}</p>
        </div>
      ),
    },
    { key: 'category', header: 'Category', width: '128px', truncate: true, title: (r) => r.category, sortValue: (r) => r.category, render: (r) => <span className="chip">{r.category}</span> },
    { key: 'doc', header: 'Applicable To', width: '128px', render: (r) => <StatusBadge tone="blue" dot={false} label={TC_DOCUMENT[r.applicableTo]} /> },
    {
      key: 'default',
      header: 'Type',
      width: '96px',
      render: (r) => (r.isDefault ? <StatusBadge tone="violet" dot={false} label="Default" /> : <span className="text-xs text-surface-400">Optional</span>),
    },
    { key: 'status', header: 'Status', width: '104px', render: (r) => <StatusBadge tone={r.active ? 'green' : 'gray'} label={r.active ? 'Active' : 'Inactive'} /> },
    {
      key: 'actions',
      header: 'Actions',
      width: '92px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          {can('tc_master', 'edit') && <IconBtn title="Edit" onClick={() => { setEditing({ ...r }); setIsNew(false); }}><Pencil className="h-4 w-4" /></IconBtn>}
          {can('tc_master', 'delete') && <IconBtn title="Delete" onClick={() => setConfirmDelete(r)}><Trash2 className="h-4 w-4 text-rose-400" /></IconBtn>}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="T&C Master"
        description="Reusable terms & conditions applied to quotations and sales orders."
        crumbs={[{ label: 'Master' }, { label: 'T&C Master' }]}
        actions={
          can('tc_master', 'create') && (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(empty()); setIsNew(true); }}>
              Add Term
            </Button>
          )
        }
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setCategory(''); setDocType(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search terms…" className="w-full sm:w-72" />
            <FilterSelect value={category} onChange={setCategory} placeholder="All categories" options={TC_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <FilterSelect value={docType} onChange={setDocType} placeholder="All document types" options={[{ value: 'quotation', label: 'Quotation' }, { value: 'sales_order', label: 'Sales Order' }, { value: 'both', label: 'Both' }]} />
          </FilterBar>
        </div>
        <DataTable columns={columns} rows={pageRows} rowKey={(r) => r.id} loading={loading} emptyTitle="No terms found" />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <TermForm
        term={editing}
        isNew={isNew}
        onClose={() => setEditing(null)}
        onSave={(t) => {
          upsertTerm(t);
          addToast({ type: 'success', title: isNew ? 'Term added' : 'Term updated', message: t.title });
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            removeTerm(confirmDelete.id);
            addToast({ type: 'success', title: 'Term deleted', message: confirmDelete.title });
          }
        }}
        title="Delete this term?"
        message={`"${confirmDelete?.title}" will be permanently removed and can no longer be applied to documents.`}
        confirmLabel="Delete"
        danger
      />
    </>
  );
}

function TermForm({ term, isNew, onClose, onSave }: { term: TermCondition | null; isNew: boolean; onClose: () => void; onSave: (t: TermCondition) => void }) {
  const [form, setForm] = useState<TermCondition>(empty());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (term) { setForm(term); setErrors({}); } }, [term]);
  if (!term) return null;

  const set = <K extends keyof TermCondition>(k: K, v: TermCondition[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Title is required';
    if (!form.description.trim()) e.description = 'Description is required';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ ...form, id: form.id || `tc-${Date.now()}` });
  };

  return (
    <Modal
      open={!!term}
      onClose={onClose}
      title={isNew ? 'Add Term & Condition' : 'Edit Term & Condition'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{isNew ? 'Add Term' : 'Save Changes'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField wrapClassName="sm:col-span-2" label="Title" required value={form.title} error={errors.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Payment — 30% Advance" />
        <SelectField label="Category" required value={form.category} onChange={(e) => set('category', e.target.value)} options={TC_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        <SelectField label="Applicable Document" required value={form.applicableTo} onChange={(e) => set('applicableTo', e.target.value as TCDocument)} options={[{ value: 'quotation', label: 'Quotation' }, { value: 'sales_order', label: 'Sales Order' }, { value: 'both', label: 'Both' }]} />
        <TextAreaField wrapClassName="sm:col-span-2" label="Description" required rows={4} value={form.description} error={errors.description} onChange={(e) => set('description', e.target.value)} />
        <div className="flex items-center gap-6 sm:col-span-2">
          <Toggle checked={form.isDefault} onChange={(v) => set('isDefault', v)} label="Default (auto-applied)" />
          <Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} />
        </div>
      </div>
    </Modal>
  );
}
