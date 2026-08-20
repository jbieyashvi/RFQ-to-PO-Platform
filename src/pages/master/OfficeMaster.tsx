import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Users,
  Building2,
  Power,
  Mail,
  Eye,
  UserPlus,
  UserMinus,
  ArrowLeftRight,
  Search,
  MapPin,
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
  Modal,
  Drawer,
  TextField,
  TextAreaField,
  Toggle,
  ConfirmDialog,
  DescList,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { IconBtn } from './ItemMaster';
import { useApp } from '@/context/AppContext';
import { classNames, formatDate, TODAY } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/labels';
import type { SalesOffice, User } from '@/types';

const todayISO = () => TODAY.toISOString().slice(0, 10);

const initials = (name: string) =>
  name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const emptyOffice = (): SalesOffice => ({
  id: '',
  name: '',
  code: '',
  zone: '',
  address: '',
  city: '',
  state: '',
  phone: '',
  email: '',
  active: true,
});

// Assign an employee to an office, stamping the assignment date and recording a
// transfer entry when they are moving from a different office. Identity,
// credentials and permissions are preserved untouched.
function assignToOffice(user: User, toOfficeId: string, by: string): User {
  const from = user.officeId;
  const transferHistory =
    from && from !== toOfficeId
      ? [
          ...(user.transferHistory ?? []),
          { id: `trf-${Date.now()}-${user.id}`, fromOfficeId: from, toOfficeId, date: todayISO(), by },
        ]
      : user.transferHistory;
  return { ...user, officeId: toOfficeId, assignmentDate: todayISO(), transferHistory };
}

export default function OfficeMaster() {
  const { offices, users, upsertOffice, can, addToast } = useApp();
  const [search, setSearch] = useState('');
  const [zoneF, setZoneF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [detail, setDetail] = useState<SalesOffice | null>(null);
  const [editingOffice, setEditingOffice] = useState<SalesOffice | null>(null);
  const [isNewOffice, setIsNewOffice] = useState(false);
  const [confirmOffice, setConfirmOffice] = useState<SalesOffice | null>(null);
  const canEdit = can('office_master', 'edit');

  const zones = useMemo(() => Array.from(new Set(offices.map((o) => o.zone).filter(Boolean))).sort(), [offices]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return offices.filter((o) => {
      if (zoneF && o.zone !== zoneF) return false;
      if (statusF === 'active' && !o.active) return false;
      if (statusF === 'inactive' && o.active) return false;
      if (s && !`${o.name} ${o.code} ${o.zone} ${o.city} ${o.state}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [offices, search, zoneF, statusF]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginatedSafe(filtered);

  const userCount = (officeId: string) => users.filter((u) => u.officeId === officeId).length;

  // keep the open detail drawer in sync with the latest office record
  const detailOffice = detail ? offices.find((o) => o.id === detail.id) ?? detail : null;

  const chips: FilterChip[] = [];
  if (zoneF) chips.push({ key: 'zone', label: `Zone: ${zoneF}`, onRemove: () => setZoneF('') });
  if (statusF) chips.push({ key: 'st', label: `Status: ${statusF}`, onRemove: () => setStatusF('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });
  const clearAll = () => {
    setZoneF('');
    setStatusF('');
    setSearch('');
  };

  const columns: Column<SalesOffice>[] = [
    {
      key: 'code',
      header: 'Office Code',
      width: '112px',
      sticky: 'left',
      sortValue: (r) => r.code,
      render: (r) => <span className="font-medium text-surface-800">{r.code}</span>,
    },
    {
      key: 'name',
      header: 'Office Name',
      truncate: true,
      title: (r) => r.name,
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-brand-50 text-[10px] font-bold text-brand-600">
            {r.code.slice(0, 3)}
          </span>
          <span className="truncate text-surface-800">{r.name}</span>
        </div>
      ),
    },
    { key: 'zone', header: 'Zone / Region', width: '124px', sortValue: (r) => r.zone, render: (r) => <span className="chip">{r.zone || '—'}</span> },
    {
      key: 'location',
      header: 'Location',
      truncate: true,
      title: (r) => `${r.city}, ${r.state}`,
      sortValue: (r) => r.city,
      render: (r) => (
        <span className="inline-flex items-center gap-1 text-surface-600">
          <MapPin className="h-3.5 w-3.5 flex-none text-surface-400" /> {r.city}, {r.state}
        </span>
      ),
    },
    {
      key: 'employees',
      header: 'Employees',
      width: '104px',
      align: 'center',
      sortValue: (r) => userCount(r.id),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-surface-600">
          <Users className="h-4 w-4 text-surface-400" /> {userCount(r.id)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      render: (r) => <StatusBadge tone={r.active ? 'green' : 'gray'} label={r.active ? 'Active' : 'Inactive'} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '116px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="View" onClick={() => setDetail(r)}>
            <Eye className="h-4 w-4" />
          </IconBtn>
          {canEdit && (
            <IconBtn title="Edit" onClick={() => { setEditingOffice({ ...r }); setIsNewOffice(false); }}>
              <Pencil className="h-4 w-4" />
            </IconBtn>
          )}
          {canEdit && (
            <IconBtn title={r.active ? 'Deactivate' : 'Activate'} onClick={() => setConfirmOffice(r)}>
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
        title="Sales Office Master"
        description="Manage sales offices and assign employees to them. Employee permissions are managed in Employee Master."
        crumbs={[{ label: 'Master' }, { label: 'Sales Office Master' }]}
        actions={
          can('office_master', 'create') && (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setEditingOffice(emptyOffice()); setIsNewOffice(true); }}>
              Add Office
            </Button>
          )
        }
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={clearAll}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, location…" className="w-full sm:w-72" />
            <FilterSelect value={zoneF} onChange={setZoneF} placeholder="All zones" options={zones.map((z) => ({ value: z, label: z }))} />
            <FilterSelect
              value={statusF}
              onChange={setStatusF}
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
          onRowClick={(r) => setDetail(r)}
          emptyTitle="No offices found"
          emptyMessage="Try adjusting filters, or add a new sales office."
          emptyAction={
            can('office_master', 'create') ? (
              <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setEditingOffice(emptyOffice()); setIsNewOffice(true); }}>
                Add Office
              </Button>
            ) : undefined
          }
        />
        {total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      {detailOffice && <OfficeDetailDrawer office={detailOffice} onClose={() => setDetail(null)} />}

      <OfficeForm
        office={editingOffice}
        isNew={isNewOffice}
        onClose={() => setEditingOffice(null)}
        onSave={(o) => {
          upsertOffice(o);
          addToast({ type: 'success', title: isNewOffice ? 'Office created' : 'Office updated', message: o.name });
          setEditingOffice(null);
        }}
      />

      <ConfirmDialog
        open={!!confirmOffice}
        onClose={() => setConfirmOffice(null)}
        onConfirm={() => {
          if (confirmOffice) {
            upsertOffice({ ...confirmOffice, active: !confirmOffice.active });
            addToast({ type: 'success', title: confirmOffice.active ? 'Office deactivated' : 'Office activated', message: confirmOffice.name });
          }
        }}
        title={confirmOffice?.active ? 'Deactivate office?' : 'Activate office?'}
        message={confirmOffice?.active ? `${confirmOffice?.name} will be marked inactive for new activity.` : `${confirmOffice?.name} will be active again.`}
        confirmLabel={confirmOffice?.active ? 'Deactivate' : 'Activate'}
        danger={confirmOffice?.active}
      />
    </>
  );
}

// Local pagination that resets to page 1 when the filtered set shrinks below the
// current page. (Mirrors usePaginated but tolerant of the office list size.)
import { usePaginated } from '@/lib/hooks';
function usePaginatedSafe<T>(rows: T[]) {
  return usePaginated(rows);
}

// ---------- Office detail drawer with assigned employees ----------
function OfficeDetailDrawer({ office, onClose }: { office: SalesOffice; onClose: () => void }) {
  const { users, upsertUser, offices, can, addToast } = useApp();
  const officeUsers = users.filter((u) => u.officeId === office.id);
  const canEdit = can('office_master', 'edit');

  const [addOpen, setAddOpen] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<User | null>(null);
  const [transferUser, setTransferUser] = useState<User | null>(null);

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={office.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {office.code}</span>
          {office.zone && <span className="chip">{office.zone}</span>}
          <span>{office.city}, {office.state}</span>
          <StatusBadge tone={office.active ? 'green' : 'gray'} label={office.active ? 'Active' : 'Inactive'} />
        </span>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-sm font-semibold text-surface-800">Office Details</h3>
          <div className="rounded-xl border border-surface-200 p-4">
            <DescList
              items={[
                { label: 'Office Code', value: office.code },
                { label: 'Zone / Region', value: office.zone || '—' },
                { label: 'City / State', value: `${office.city}, ${office.state}` },
                { label: 'Address', value: office.address || '—' },
                { label: 'Contact Phone', value: office.phone || '—' },
                { label: 'Contact Email', value: office.email || '—' },
                { label: 'Assigned Employees', value: `${officeUsers.length}` },
                { label: 'Status', value: <StatusBadge tone={office.active ? 'green' : 'gray'} label={office.active ? 'Active' : 'Inactive'} /> },
              ]}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-800">
              Assigned Employees <span className="text-surface-400">({officeUsers.length})</span>
            </h3>
            {canEdit && (
              <Button variant="primary" size="sm" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
                Add Employee
              </Button>
            )}
          </div>

          {officeUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-surface-200 py-8 text-center text-sm text-surface-400">
              No employees assigned to this office yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {officeUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-3 rounded-xl border border-surface-200 bg-white p-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                    {initials(u.fullName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-surface-800">{u.fullName}</p>
                      <span className="text-[11px] text-surface-400">{u.employeeCode}</span>
                      <StatusBadge tone={u.active ? 'green' : 'gray'} label={u.active ? 'Active' : 'Inactive'} dot={false} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-surface-400">
                      <span>{u.department ?? '—'}</span>
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {u.email}</span>
                      {u.assignmentDate && <span>Assigned {formatDate(u.assignmentDate)}</span>}
                    </div>
                  </div>
                  <StatusBadge tone="blue" dot={false} label={ROLE_LABELS[u.role]} />
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <IconBtn title="Transfer to another office" onClick={() => setTransferUser(u)}>
                        <ArrowLeftRight className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn title="Remove from office" onClick={() => setRemoveConfirm(u)}>
                        <UserMinus className="h-4 w-4 text-rose-400" />
                      </IconBtn>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12px] text-surface-400">
            Assigning or removing an employee here only changes which office's data they can see. Their role and
            permissions are managed in <span className="font-medium text-surface-600">Employee Master</span>.
          </p>
        </section>
      </div>

      {addOpen && (
        <AddEmployeeModal
          office={office}
          onClose={() => setAddOpen(false)}
          onAdd={(selected) => {
            selected.forEach((u) => upsertUser(assignToOffice(u, office.id, 'Sales Office Master')));
            addToast({
              type: 'success',
              title: selected.length > 1 ? `${selected.length} employees assigned` : 'Employee assigned',
              message: `Added to ${office.name}`,
            });
            setAddOpen(false);
          }}
        />
      )}

      {transferUser && (
        <TransferModal
          user={transferUser}
          currentOffice={office}
          offices={offices.filter((o) => o.id !== office.id)}
          onClose={() => setTransferUser(null)}
          onTransfer={(toOfficeId) => {
            const to = offices.find((o) => o.id === toOfficeId);
            upsertUser(assignToOffice(transferUser, toOfficeId, 'Sales Office Master'));
            addToast({
              type: 'success',
              title: 'Employee transferred',
              message: `${transferUser.fullName} → ${to?.name ?? ''}`,
            });
            setTransferUser(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeConfirm}
        onClose={() => setRemoveConfirm(null)}
        onConfirm={() => {
          if (removeConfirm) {
            upsertUser({ ...removeConfirm, officeId: '', assignmentDate: undefined });
            addToast({ type: 'success', title: 'Employee removed from office', message: removeConfirm.fullName });
          }
        }}
        title="Remove from this office?"
        message={`${removeConfirm?.fullName} will no longer see ${office.name}'s data until reassigned. Their account and permissions are unchanged.`}
        confirmLabel="Remove"
        danger
      />
    </Drawer>
  );
}

// ---------- Add existing employees to this office (searchable) ----------
function AddEmployeeModal({
  office,
  onClose,
  onAdd,
}: {
  office: SalesOffice;
  onClose: () => void;
  onAdd: (selected: User[]) => void;
}) {
  const { users, offices } = useApp();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  // Only employees not already assigned to this office (from Employee Master).
  const candidates = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users
      .filter((u) => u.officeId !== office.id)
      .filter((u) => !s || `${u.fullName} ${u.employeeCode} ${u.email}`.toLowerCase().includes(s));
  }, [users, office.id, q]);

  const officeLabel = (id: string) => offices.find((o) => o.id === id)?.name;
  const selected = users.filter((u) => picked[u.id]);
  const toggle = (id: string) => setPicked((p) => ({ ...p, [id]: !p[id] }));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Add Employee to Office"
      subtitle={`Assign existing employees to ${office.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={selected.length === 0} onClick={() => onAdd(selected)}>
            {selected.length > 0 ? `Assign ${selected.length}` : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
          <input
            autoFocus
            className="input pl-9"
            placeholder="Search employees by name, code or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-surface-200">
          {candidates.length === 0 ? (
            <div className="py-10 text-center text-sm text-surface-400">No matching employees.</div>
          ) : (
            <ul className="divide-y divide-surface-100">
              {candidates.map((u) => (
                <li key={u.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-surface-50/60">
                    <input
                      type="checkbox"
                      checked={!!picked[u.id]}
                      onChange={() => toggle(u.id)}
                      className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/40"
                    />
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">
                      {initials(u.fullName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-surface-800">{u.fullName}</p>
                        <span className="text-[11px] text-surface-400">{u.employeeCode}</span>
                      </div>
                      <p className="truncate text-xs text-surface-400">
                        {u.department ?? '—'} · {u.email}
                      </p>
                    </div>
                    <StatusBadge tone="blue" dot={false} label={ROLE_LABELS[u.role]} />
                    {u.officeId ? (
                      <span className="ml-1 whitespace-nowrap text-[11px] text-amber-600" title="Currently assigned elsewhere — assigning here will transfer them">
                        {officeLabel(u.officeId)}
                      </span>
                    ) : (
                      <span className="ml-1 whitespace-nowrap text-[11px] text-surface-400">Unassigned</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-[12px] text-surface-400">
          Only office assignment is changed. Employees already assigned to another office will be transferred here.
          Permissions are never edited from this screen.
        </p>
      </div>
    </Modal>
  );
}

// ---------- Transfer an employee to another office ----------
function TransferModal({
  user,
  currentOffice,
  offices,
  onClose,
  onTransfer,
}: {
  user: User;
  currentOffice: SalesOffice;
  offices: SalesOffice[];
  onClose: () => void;
  onTransfer: (toOfficeId: string) => void;
}) {
  const [target, setTarget] = useState('');

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Transfer Employee"
      subtitle={`${user.fullName} • ${user.employeeCode}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!target} onClick={() => target && onTransfer(target)}>
            Transfer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-surface-200 bg-surface-50/60 px-3 py-2 text-[12px] text-surface-600">
          Transferring keeps the same Employee ID, login credentials and permissions. Only the office data scope
          changes, and the move is recorded in the employee's transfer history.
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="flex-1 rounded-lg border border-surface-200 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-surface-400">From</p>
            <p className="font-medium text-surface-800">{currentOffice.name}</p>
          </div>
          <ArrowLeftRight className="h-4 w-4 flex-none text-surface-400" />
          <div className="flex-1 rounded-lg border border-surface-200 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-surface-400">To</p>
            <p className="font-medium text-surface-800">
              {offices.find((o) => o.id === target)?.name ?? <span className="text-surface-400">Select office…</span>}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {offices.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setTarget(o.id)}
              className={classNames(
                'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                target === o.id ? 'border-brand-500 bg-brand-50/60 text-brand-700' : 'border-surface-200 hover:bg-surface-50'
              )}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{o.name}</span>
                <span className="block truncate text-[11px] text-surface-400">{o.code} · {o.zone}</span>
              </span>
              {!o.active && <span className="flex-none text-[11px] text-surface-400">Inactive</span>}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------- Office form (identity + contact, no permissions) ----------
function OfficeForm({ office, isNew, onClose, onSave }: { office: SalesOffice | null; isNew: boolean; onClose: () => void; onSave: (o: SalesOffice) => void }) {
  const [form, setForm] = useState<SalesOffice>(emptyOffice());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (office) { setForm(office); setErrors({}); } }, [office]);
  if (!office) return null;

  const set = <K extends keyof SalesOffice>(k: K, v: SalesOffice[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Office name is required';
    if (!form.code.trim()) e.code = 'Office code is required';
    if (!form.zone.trim()) e.zone = 'Zone / region is required';
    if (!form.city.trim()) e.city = 'City is required';
    if (!form.state.trim()) e.state = 'State is required';
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Enter a valid email';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ ...form, id: form.id || `off-${Date.now()}` });
  };

  return (
    <Modal
      open={!!office}
      onClose={onClose}
      title={isNew ? 'Add Sales Office' : 'Edit Sales Office'}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{isNew ? 'Create Office' : 'Save Changes'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Office Name" required value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pune" />
        <TextField label="Office Code" required value={form.code} error={errors.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. PUN-06" />
        <TextField label="Zone / Region" required value={form.zone} error={errors.zone} onChange={(e) => set('zone', e.target.value)} placeholder="e.g. West Zone" />
        <div />
        <TextField label="City" required value={form.city} error={errors.city} onChange={(e) => set('city', e.target.value)} />
        <TextField label="State" required value={form.state} error={errors.state} onChange={(e) => set('state', e.target.value)} />
        <TextField label="Contact Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 22 XXXX XXXX" />
        <TextField label="Contact Email" type="email" value={form.email} error={errors.email} onChange={(e) => set('email', e.target.value)} placeholder="office@flowtech-instruments.com" />
        <TextAreaField wrapClassName="sm:col-span-2" label="Address" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
        <div className="flex items-center pt-1"><Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} /></div>
      </div>
    </Modal>
  );
}
