import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Eye, Download, Power } from 'lucide-react';
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
  Toggle,
  ConfirmDialog,
  DescList,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { ITEM_CATEGORIES, UNITS } from '@/lib/labels';
import type { Item } from '@/types';
import { classNames, downloadCSV, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const emptyItem = (): Item => ({
  id: '',
  code: '',
  name: '',
  category: 'Electrical',
  hsnCode: '',
  unit: 'Nos',
  unitPrice: 0,
  active: true,
});

export default function ItemMaster() {
  const { items, hsn, upsertItem, can, addToast } = useApp();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');

  const [editing, setEditing] = useState<Item | null>(null);
  const [viewing, setViewing] = useState<Item | null>(null);
  const [confirmItem, setConfirmItem] = useState<Item | null>(null);
  const [isNew, setIsNew] = useState(false);

  const loading = useSimulatedLoading([]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter((it) => {
      if (category && it.category !== category) return false;
      if (status === 'active' && !it.active) return false;
      if (status === 'inactive' && it.active) return false;
      if (s && !`${it.code} ${it.name} ${it.hsnCode} ${it.category}`.toLowerCase().includes(s))
        return false;
      return true;
    });
  }, [items, search, category, status]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered);

  const chips: FilterChip[] = [];
  if (category) chips.push({ key: 'cat', label: `Category: ${category}`, onRemove: () => setCategory('') });
  if (status) chips.push({ key: 'st', label: `Status: ${status}`, onRemove: () => setStatus('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => {
    setCategory('');
    setStatus('');
    setSearch('');
  };

  const openNew = () => {
    setEditing(emptyItem());
    setIsNew(true);
  };
  const openEdit = (it: Item) => {
    setEditing({ ...it });
    setIsNew(false);
  };

  const toggleActive = (it: Item) => {
    upsertItem({ ...it, active: !it.active });
    addToast({
      type: 'success',
      title: it.active ? 'Item deactivated' : 'Item activated',
      message: `${it.code} — ${it.name}`,
    });
    setConfirmItem(null);
  };

  const exportCSV = () => {
    const header = ['Item Code', 'Item Name', 'Category', 'HSN Code', 'Unit', 'Unit Price', 'Status'];
    const rows = filtered.map((it) => [
      it.code,
      it.name,
      it.category,
      it.hsnCode,
      it.unit,
      it.unitPrice,
      it.active ? 'Active' : 'Inactive',
    ]);
    downloadCSV('item-master.csv', [header, ...rows]);
    addToast({ type: 'success', title: 'Export complete', message: `${filtered.length} items exported to CSV.` });
  };

  const columns: Column<Item>[] = [
    {
      key: 'code',
      header: 'Item Code',
      sortValue: (r) => r.code,
      render: (r) => <span className="font-medium text-surface-800">{r.code}</span>,
    },
    {
      key: 'name',
      header: 'Item Name / Description',
      sortValue: (r) => r.name,
      render: (r) => <span className="text-surface-700">{r.name}</span>,
    },
    { key: 'category', header: 'Category', sortValue: (r) => r.category, render: (r) => <span className="chip">{r.category}</span> },
    { key: 'hsn', header: 'HSN', render: (r) => <span className="text-surface-500">{r.hsnCode}</span> },
    { key: 'unit', header: 'Unit', render: (r) => r.unit },
    {
      key: 'price',
      header: 'Unit Price',
      align: 'right',
      sortValue: (r) => r.unitPrice,
      render: (r) => <span className="font-medium text-surface-800">{formatINR(r.unitPrice)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <StatusBadge tone={r.active ? 'green' : 'gray'} label={r.active ? 'Active' : 'Inactive'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="View" onClick={() => setViewing(r)}>
            <Eye className="h-4 w-4" />
          </IconBtn>
          {can('item_master', 'edit') && (
            <IconBtn title="Edit" onClick={() => openEdit(r)}>
              <Pencil className="h-4 w-4" />
            </IconBtn>
          )}
          {can('item_master', 'edit') && (
            <IconBtn title={r.active ? 'Deactivate' : 'Activate'} onClick={() => setConfirmItem(r)}>
              <Power className={classNames('h-4 w-4', r.active ? 'text-emerald-500' : 'text-surface-400')} />
            </IconBtn>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Item Master"
        description="Catalogue of items available for quotations and sales orders."
        crumbs={[{ label: 'Master' }, { label: 'Item Master' }]}
        actions={
          <>
            {can('item_master', 'download') && (
              <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={exportCSV}>
                Export CSV
              </Button>
            )}
            {can('item_master', 'create') && (
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>
                Add Item
              </Button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={clearAll}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search code, name, HSN…" className="w-full sm:w-72" />
            <FilterSelect
              value={category}
              onChange={setCategory}
              placeholder="All categories"
              options={ITEM_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
            <FilterSelect
              value={status}
              onChange={setStatus}
              placeholder="All statuses"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </FilterBar>
        </div>

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => setViewing(r)}
          emptyTitle="No items found"
          emptyMessage="Try adjusting filters, or add a new item to the catalogue."
          emptyAction={
            can('item_master', 'create') ? (
              <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>
                Add Item
              </Button>
            ) : undefined
          }
        />
        {!loading && total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      {/* View modal */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.name} subtitle={viewing?.code} size="lg">
        {viewing && (
          <DescList
            items={[
              { label: 'Item Code', value: viewing.code },
              { label: 'Category', value: viewing.category },
              { label: 'HSN Code', value: viewing.hsnCode },
              { label: 'Unit', value: viewing.unit },
              { label: 'Unit Price', value: formatINR(viewing.unitPrice) },
              {
                label: 'Status',
                value: <StatusBadge tone={viewing.active ? 'green' : 'gray'} label={viewing.active ? 'Active' : 'Inactive'} />,
              },
              { label: 'Description', value: viewing.name },
            ]}
          />
        )}
      </Modal>

      {/* Edit / New modal */}
      <ItemFormModal
        item={editing}
        isNew={isNew}
        hsnOptions={hsn.filter((h) => h.active).map((h) => ({ value: h.code, label: `${h.code} — ${h.description.slice(0, 30)}…` }))}
        onClose={() => setEditing(null)}
        onSave={(it) => {
          upsertItem(it);
          addToast({
            type: 'success',
            title: isNew ? 'Item added' : 'Item updated',
            message: `${it.code} — ${it.name}`,
          });
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmItem}
        onClose={() => setConfirmItem(null)}
        onConfirm={() => confirmItem && toggleActive(confirmItem)}
        title={confirmItem?.active ? 'Deactivate item?' : 'Activate item?'}
        message={
          confirmItem?.active
            ? `${confirmItem?.code} will be hidden from new quotations and sales orders.`
            : `${confirmItem?.code} will be available again for selection.`
        }
        confirmLabel={confirmItem?.active ? 'Deactivate' : 'Activate'}
        danger={confirmItem?.active}
      />
    </>
  );
}

export function IconBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 hover:text-surface-800"
    >
      {children}
    </button>
  );
}

function ItemFormModal({
  item,
  isNew,
  hsnOptions,
  onClose,
  onSave,
}: {
  item: Item | null;
  isNew: boolean;
  hsnOptions: { value: string; label: string }[];
  onClose: () => void;
  onSave: (it: Item) => void;
}) {
  const [form, setForm] = useState<Item>(emptyItem());
  const [errors, setErrors] = useState<Record<string, string>>({});

  // sync when item changes
  useEffect(() => {
    if (item) {
      setForm(item);
      setErrors({});
    }
  }, [item]);

  if (!item) return null;

  const set = <K extends keyof Item>(k: K, v: Item[K]) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.code.trim()) e.code = 'Item code is required';
    if (!form.name.trim()) e.name = 'Item name is required';
    if (!form.hsnCode.trim()) e.hsnCode = 'HSN code is required';
    if (form.unitPrice <= 0) e.unitPrice = 'Unit price must be greater than 0';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate()) return;
    onSave({ ...form, id: form.id || `itm-${Date.now()}` });
  };

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      title={isNew ? 'Add Item' : 'Edit Item'}
      subtitle={isNew ? 'Create a new catalogue item' : form.code}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {isNew ? 'Add Item' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Item Code" required value={form.code} error={errors.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. EL-CB-063" />
        <SelectField
          label="Category"
          required
          value={form.category}
          onChange={(e) => set('category', e.target.value)}
          options={ITEM_CATEGORIES.map((c) => ({ value: c, label: c }))}
        />
        <TextField
          wrapClassName="sm:col-span-2"
          label="Item Name / Description"
          required
          value={form.name}
          error={errors.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Full item description"
        />
        <SelectField
          label="HSN Code"
          required
          value={form.hsnCode}
          error={errors.hsnCode}
          onChange={(e) => set('hsnCode', e.target.value)}
          options={hsnOptions}
          placeholder="Select HSN…"
        />
        <SelectField
          label="Unit"
          required
          value={form.unit}
          onChange={(e) => set('unit', e.target.value)}
          options={UNITS.map((u) => ({ value: u, label: u }))}
        />
        <TextField
          label="Unit Price (₹)"
          required
          type="number"
          value={form.unitPrice}
          error={errors.unitPrice}
          onChange={(e) => set('unitPrice', Number(e.target.value))}
        />
        <div className="flex items-end pb-1">
          <Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} />
        </div>
      </div>
    </Modal>
  );
}
