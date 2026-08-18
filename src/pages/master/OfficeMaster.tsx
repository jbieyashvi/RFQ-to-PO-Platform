import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Users,
  Building2,
  Power,
  Mail,
  Phone,
  Trash2,
  ShieldCheck,
  Eye,
  Inbox,
  MapPin,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  StatusBadge,
  SearchInput,
  Modal,
  Drawer,
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  ConfirmDialog,
  PermissionMatrix,
  DescList,
} from '@/components/ui';
import { IconBtn } from './ItemMaster';
import { useApp } from '@/context/AppContext';
import { classNames } from '@/lib/format';
import { ROLE_LABELS, INBOX_ACTION_LABELS, INBOX_ACTION_ORDER } from '@/lib/labels';
import { defaultPermissionsFor, defaultInboxPermissionsFor, cloneMatrix, cloneInbox } from '@/lib/permissions';
import type { InboxAction, PermissionMatrix as PMatrix, Role, SalesOffice, User } from '@/types';

const emptyOffice = (): SalesOffice => ({
  id: '',
  name: '',
  code: '',
  address: '',
  city: '',
  state: '',
  active: true,
});

export default function OfficeMaster() {
  const { offices, users, upsertOffice, can, addToast } = useApp();
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<SalesOffice | null>(null);
  const [editingOffice, setEditingOffice] = useState<SalesOffice | null>(null);
  const [isNewOffice, setIsNewOffice] = useState(false);
  const [confirmOffice, setConfirmOffice] = useState<SalesOffice | null>(null);
  const canEdit = can('office_master', 'edit');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return offices.filter((o) => !s || `${o.name} ${o.code} ${o.city} ${o.state}`.toLowerCase().includes(s));
  }, [offices, search]);

  const userCount = (officeId: string) => users.filter((u) => u.officeId === officeId).length;

  return (
    <>
      <PageHeader
        title="Sales Office Master"
        description="Manage sales offices, their users and module-wise permissions."
        crumbs={[{ label: 'Master' }, { label: 'Sales Office Master' }]}
        actions={
          can('office_master', 'create') && (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => { setEditingOffice(emptyOffice()); setIsNewOffice(true); }}>
              Add Office
            </Button>
          )
        }
      />

      <div className="card overflow-hidden">
        {/* compact search toolbar */}
        <div className="border-b border-surface-100 px-4 py-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search offices…" className="w-full sm:w-80" />
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-14 text-center text-sm text-surface-400">No offices found.</div>
        ) : (
          <ul className="divide-y divide-surface-100">
            {filtered.map((o) => (
              <li
                key={o.id}
                className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-surface-50/60 sm:flex-row sm:items-center sm:gap-4"
              >
                {/* Identity: avatar + name + code / location */}
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-brand-50 text-[11px] font-bold text-brand-600">
                    {o.code.slice(0, 3)}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-surface-800" title={o.name}>{o.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-surface-400">
                      <span className="font-medium text-surface-500">{o.code}</span>
                      <span className="hidden text-surface-300 sm:inline">&middot;</span>
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <MapPin className="h-3 w-3 flex-none" />
                        <span className="truncate">{o.city}, {o.state}</span>
                      </span>
                    </p>
                  </div>
                </div>

                {/* Meta: assigned users + status */}
                <div className="flex flex-none items-center gap-3 sm:gap-4">
                  <span
                    className="inline-flex items-center gap-1.5 text-[13px] text-surface-600"
                    title={`${userCount(o.id)} assigned ${userCount(o.id) === 1 ? 'user' : 'users'}`}
                  >
                    <Users className="h-4 w-4 text-surface-400" /> {userCount(o.id)}
                  </span>
                  <StatusBadge tone={o.active ? 'green' : 'gray'} label={o.active ? 'Active' : 'Inactive'} />
                </div>

                {/* Actions: direct icon buttons (replaces three-dot menu) */}
                <div className="flex flex-none items-center gap-1 border-t border-surface-100 pt-2 sm:border-0 sm:pt-0">
                  <ActionIcon title="View office" onClick={() => setDetail(o)}>
                    <Eye className="h-[18px] w-[18px]" />
                  </ActionIcon>
                  {canEdit && (
                    <>
                      <ActionIcon title="Edit office" onClick={() => { setEditingOffice({ ...o }); setIsNewOffice(false); }}>
                        <Pencil className="h-[18px] w-[18px]" />
                      </ActionIcon>
                      <ActionIcon
                        title={o.active ? 'Deactivate office' : 'Activate office'}
                        tone={o.active ? 'danger' : 'positive'}
                        onClick={() => setConfirmOffice(o)}
                      >
                        <Power className="h-[18px] w-[18px]" />
                      </ActionIcon>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail && <OfficeDetailDrawer office={detail} onClose={() => setDetail(null)} />}

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
        message={confirmOffice?.active ? `${confirmOffice?.name} and its users will be marked inactive for new activity.` : `${confirmOffice?.name} will be active again.`}
        confirmLabel={confirmOffice?.active ? 'Deactivate' : 'Activate'}
        danger={confirmOffice?.active}
      />
    </>
  );
}

// ---------- Direct action icon button (tone-aware) ----------
function ActionIcon({
  title,
  tone = 'neutral',
  onClick,
  children,
}: {
  title: string;
  tone?: 'neutral' | 'danger' | 'positive';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tones: Record<'neutral' | 'danger' | 'positive', string> = {
    neutral: 'text-surface-500 hover:bg-surface-100 hover:text-surface-800 focus-visible:ring-brand-500/50',
    danger: 'text-rose-500 hover:bg-rose-50 hover:text-rose-600 focus-visible:ring-rose-500/40',
    positive: 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 focus-visible:ring-emerald-500/40',
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={classNames(
        'flex h-9 w-9 flex-none items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2',
        tones[tone]
      )}
    >
      {children}
    </button>
  );
}

// ---------- Office detail drawer with users ----------
function OfficeDetailDrawer({ office, onClose }: { office: SalesOffice; onClose: () => void }) {
  const { users, upsertUser, removeUser, can, addToast } = useApp();
  const officeUsers = users.filter((u) => u.officeId === office.id);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isNewUser, setIsNewUser] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<User | null>(null);

  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={office.name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {office.code}</span>
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
                { label: 'City / State', value: `${office.city}, ${office.state}` },
                { label: 'Address', value: office.address },
                { label: 'Total Users', value: `${officeUsers.length}` },
              ]}
            />
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-surface-800">
              Office Users <span className="text-surface-400">({officeUsers.length})</span>
            </h3>
            {can('office_master', 'edit') && (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setEditingUser({
                    id: '',
                    fullName: '',
                    email: '',
                    phone: '',
                    role: 'sales_user',
                    officeId: office.id,
                    active: true,
                    permissions: defaultPermissionsFor('sales_user'),
                    inboxPermissions: defaultInboxPermissionsFor('sales_user'),
                  });
                  setIsNewUser(true);
                }}
              >
                Add User
              </Button>
            )}
          </div>

          {officeUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-surface-200 py-8 text-center text-sm text-surface-400">
              No users assigned to this office yet.
            </div>
          ) : (
            <ul className="space-y-2">
              {officeUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-3 rounded-xl border border-surface-200 bg-white p-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
                    {u.fullName.split(' ').map((n) => n[0]).slice(0, 2).join('')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-surface-800">{u.fullName}</p>
                      <StatusBadge tone={u.active ? 'green' : 'gray'} label={u.active ? 'Active' : 'Inactive'} dot={false} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 text-xs text-surface-400">
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {u.email}</span>
                      <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {u.phone}</span>
                    </div>
                  </div>
                  <StatusBadge tone="blue" dot={false} label={ROLE_LABELS[u.role]} />
                  {can('office_master', 'edit') && (
                    <div className="flex items-center gap-1">
                      <IconBtn title="Edit user & permissions" onClick={() => { setEditingUser({ ...u, permissions: cloneMatrix(u.permissions), inboxPermissions: cloneInbox(u.inboxPermissions) }); setIsNewUser(false); }}>
                        <Pencil className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn title="Remove user" onClick={() => setRemoveConfirm(u)}>
                        <Trash2 className="h-4 w-4 text-rose-400" />
                      </IconBtn>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editingUser && (
        <UserFormModal
          user={editingUser}
          isNew={isNewUser}
          onClose={() => setEditingUser(null)}
          onSave={(u) => {
            upsertUser(u);
            addToast({ type: 'success', title: isNewUser ? 'User added' : 'User updated', message: `${u.fullName} • ${ROLE_LABELS[u.role]}` });
            setEditingUser(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeConfirm}
        onClose={() => setRemoveConfirm(null)}
        onConfirm={() => {
          if (removeConfirm) {
            removeUser(removeConfirm.id);
            addToast({ type: 'success', title: 'User removed', message: removeConfirm.fullName });
          }
        }}
        title="Remove this user?"
        message={`${removeConfirm?.fullName} will lose access to ${office.name}. This cannot be undone.`}
        confirmLabel="Remove User"
        danger
      />
    </Drawer>
  );
}

// ---------- User form with permission matrix ----------
function UserFormModal({ user, isNew, onClose, onSave }: { user: User; isNew: boolean; onClose: () => void; onSave: (u: User) => void }) {
  const [form, setForm] = useState<User>(user);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { setForm(user); setErrors({}); }, [user]);

  const set = <K extends keyof User>(k: K, v: User[K]) => setForm((f) => ({ ...f, [k]: v }));

  const applyRoleTemplate = (role: Role) => {
    setForm((f) => ({
      ...f,
      role,
      permissions: defaultPermissionsFor(role),
      inboxPermissions: defaultInboxPermissionsFor(role),
    }));
  };

  const setPermissions = (permissions: PMatrix) => setForm((f) => ({ ...f, permissions }));

  const toggleInbox = (action: InboxAction) =>
    setForm((f) => ({
      ...f,
      inboxPermissions: { ...f.inboxPermissions, [action]: !f.inboxPermissions[action] },
    }));

  const submit = () => {
    const e: Record<string, string> = {};
    if (!form.fullName.trim()) e.fullName = 'Full name is required';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Enter a valid email';
    if (!/^[+\d][\d\s-]{7,}$/.test(form.phone)) e.phone = 'Enter a valid phone number';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSave({ ...form, id: form.id || `usr-${Date.now()}` });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? 'Add User' : 'Edit User'}
      subtitle={isNew ? 'Create a user and configure module permissions' : form.email}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>{isNew ? 'Add User' : 'Save Changes'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Full Name" required value={form.fullName} error={errors.fullName} onChange={(e) => set('fullName', e.target.value)} />
          <TextField label="Email" required type="email" value={form.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
          <TextField label="Phone" required value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98XXX XXXXX" />
          <SelectField
            label="Role"
            required
            value={form.role}
            onChange={(e) => applyRoleTemplate(e.target.value as Role)}
            options={(['super_admin', 'office_admin', 'sales_user'] as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            hint="Selecting a role applies its default permission template"
          />
          <div className="flex items-end pb-1">
            <Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-brand-500" />
              <h4 className="text-sm font-semibold text-surface-800">Module Permissions</h4>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <button onClick={() => setPermissions(defaultPermissionsFor(form.role))} className="font-medium text-brand-600 hover:underline">
                Reset to {ROLE_LABELS[form.role]} defaults
              </button>
            </div>
          </div>
          <p className="mb-3 text-xs text-surface-400">
            Configure View, Create, Edit, Delete and Download access per module. The sidebar and action buttons respect these settings.
          </p>
          <PermissionMatrix value={form.permissions} onChange={setPermissions} />
        </div>

        {/* Global Inbox — action-level permissions */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Inbox className="h-4 w-4 text-brand-500" />
            <h4 className="text-sm font-semibold text-surface-800">Global Inbox — Action Permissions</h4>
          </div>
          <p className="mb-3 text-xs text-surface-400">
            AI may classify, extract and draft. Sending an external email always requires a user with{' '}
            <span className="font-medium text-surface-600">Approve</span> and{' '}
            <span className="font-medium text-surface-600">Send</span> permission.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-surface-200 p-3 sm:grid-cols-4">
            {INBOX_ACTION_ORDER.map((action) => (
              <label key={action} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-50">
                <input
                  type="checkbox"
                  checked={form.inboxPermissions[action]}
                  onChange={() => toggleInbox(action)}
                  className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500/40"
                />
                <span className="text-[13px] text-surface-700">{INBOX_ACTION_LABELS[action]}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Office form ----------
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
    if (!form.city.trim()) e.city = 'City is required';
    if (!form.state.trim()) e.state = 'State is required';
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
        <TextField label="Office Name" required value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pune (West Zone)" />
        <TextField label="Office Code" required value={form.code} error={errors.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. PUN-06" />
        <TextField label="City" required value={form.city} error={errors.city} onChange={(e) => set('city', e.target.value)} />
        <TextField label="State" required value={form.state} error={errors.state} onChange={(e) => set('state', e.target.value)} />
        <TextAreaField wrapClassName="sm:col-span-2" label="Address" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
        <div className="flex items-center pt-1"><Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} /></div>
      </div>
    </Modal>
  );
}
