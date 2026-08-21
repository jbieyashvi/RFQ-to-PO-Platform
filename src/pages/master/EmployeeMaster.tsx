import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Eye, Power, ShieldCheck, Copy, Trash2, Lock, UserCog } from 'lucide-react';
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
  TextAreaField,
  SelectField,
  Toggle,
  ConfirmDialog,
  DescList,
  PermissionMatrixEditor,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { IconBtn } from './ItemMaster';
import { useApp } from '@/context/AppContext';
import { officeName, officeCode } from '@/data/offices';
import { SUPER_ADMIN_ROLE_ID } from '@/data/roles';
import { classNames, formatDate, TODAY } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';
import {
  ALL_SECTIONS,
  cloneFeature,
  emptyFeaturePermissions,
  equalsFeature,
  hasCustomOverrides,
  deriveLegacyPermissions,
  deriveInbox,
} from '@/lib/featurePermissions';
import type { FeaturePermissions, RoleCategory, RoleDefinition, User } from '@/types';

const DEPARTMENTS = ['Administration', 'Sales', 'Management', 'Operations', 'Finance'];

const CATEGORY_LABELS: Record<RoleCategory, string> = {
  admin: 'Admin',
  stakeholder: 'Stakeholder',
};

const todayISO = () => TODAY.toISOString().slice(0, 10);

// The protected system Super Admin role.
const isSystemSuperAdmin = (r: RoleDefinition) => r.system && r.id === SUPER_ADMIN_ROLE_ID;

// Role picker groups — 'Stakeholder' is a category heading, never a role.
function roleGroups(roles: RoleDefinition[]) {
  const opt = (r: RoleDefinition) => ({ value: r.id, label: r.name });
  return [
    { label: 'Admin', options: roles.filter((r) => r.category === 'admin').map(opt) },
    { label: 'Stakeholder', options: roles.filter((r) => r.category === 'stakeholder').map(opt) },
  ].filter((g) => g.options.length > 0);
}

function enabledCount(fp: FeaturePermissions): { on: number; total: number } {
  let on = 0;
  let total = 0;
  for (const s of ALL_SECTIONS)
    for (const a of s.actions) {
      total += 1;
      if (fp[s.key]?.[a]) on += 1;
    }
  return { on, total };
}

function nextEmployeeCode(users: User[]): string {
  const max = users.reduce((m, u) => {
    const n = Number(/EMP-(\d+)/.exec(u.employeeCode)?.[1] ?? 0);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `EMP-${String(max + 1).padStart(4, '0')}`;
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const emptyEmployee = (users: User[], roles: RoleDefinition[]): User => {
  const def = roles.find((r) => r.id === 'role-sales-executive') ?? roles[0];
  const fp = cloneFeature(def.featurePermissions);
  return {
    id: '',
    employeeCode: nextEmployeeCode(users),
    fullName: '',
    email: '',
    phone: '',
    department: 'Sales',
    designation: '',
    reportingManager: '',
    roleId: def.id,
    role: def.baseRole,
    officeId: '',
    active: true,
    featurePermissions: fp,
    permissions: deriveLegacyPermissions(fp),
    inboxPermissions: deriveInbox(fp),
  };
};

export default function EmployeeMaster() {
  const { users, upsertUser, offices, can, addToast, roles, upsertRole, removeRole, roleNameOf, currentUser } =
    useApp();
  const [search, setSearch] = useState('');
  const [roleF, setRoleF] = useState('');
  const [deptF, setDeptF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [assignF, setAssignF] = useState('');

  const [editing, setEditing] = useState<User | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [viewing, setViewing] = useState<User | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<User | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<User | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);

  const loading = useSimulatedLoading([]);
  const canEdit = can('employee_master', 'edit');
  const canCreate = can('employee_master', 'create');
  // Role management (copy / rename / create / edit defaults) is a Super Admin
  // capability — gated on the acting user's Admin-category role.
  const canManageRoles =
    canEdit && roles.find((r) => r.id === currentUser.roleId)?.category === 'admin';

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  // Protection: the LAST ACTIVE Super Admin can never be deactivated (nor moved
  // off the Super Admin role) — the platform must always keep one.
  const isLastActiveSuperAdmin = (u: User) =>
    u.roleId === SUPER_ADMIN_ROLE_ID &&
    u.active &&
    !users.some((x) => x.id !== u.id && x.roleId === SUPER_ADMIN_ROLE_ID && x.active);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleF && u.roleId !== roleF) return false;
      if (deptF && (u.department ?? '') !== deptF) return false;
      if (statusF === 'active' && !u.active) return false;
      if (statusF === 'inactive' && u.active) return false;
      if (assignF === 'assigned' && !u.officeId) return false;
      if (assignF === 'unassigned' && u.officeId) return false;
      if (s && !`${u.employeeCode} ${u.fullName} ${u.email}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [users, search, roleF, deptF, statusF, assignF]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered);

  const chips: FilterChip[] = [];
  if (roleF) chips.push({ key: 'role', label: `Role: ${roleById.get(roleF)?.name ?? roleF}`, onRemove: () => setRoleF('') });
  if (deptF) chips.push({ key: 'dept', label: `Dept: ${deptF}`, onRemove: () => setDeptF('') });
  if (statusF) chips.push({ key: 'st', label: `Status: ${statusF}`, onRemove: () => setStatusF('') });
  if (assignF) chips.push({ key: 'as', label: `Office: ${assignF}`, onRemove: () => setAssignF('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const clearAll = () => {
    setRoleF('');
    setDeptF('');
    setStatusF('');
    setAssignF('');
    setSearch('');
  };

  const openNew = () => {
    setEditing(emptyEmployee(users, roles));
    setIsNew(true);
  };
  const openEdit = (u: User) => {
    const def = roleById.get(u.roleId);
    setEditing({
      ...u,
      featurePermissions: cloneFeature(u.featurePermissions ?? def?.featurePermissions ?? emptyFeaturePermissions()),
    });
    setIsNew(false);
  };

  const toggleActive = (u: User) => {
    if (u.active && isLastActiveSuperAdmin(u)) {
      addToast({
        type: 'error',
        title: 'Cannot deactivate the last Super Admin',
        message: 'At least one active Super Admin must remain. Assign another employee the Super Admin role first.',
      });
      return;
    }
    upsertUser({ ...u, active: !u.active });
    addToast({
      type: 'success',
      title: u.active ? 'Employee deactivated' : 'Employee activated',
      message: `${u.employeeCode} — ${u.fullName}`,
    });
  };

  // Save an edited role definition; when its default template changed,
  // propagate the new defaults to every employee still ON the defaults
  // (individual overrides are preserved untouched).
  const saveRole = (def: RoleDefinition, prev?: RoleDefinition) => {
    upsertRole(def);
    if (prev) {
      let touched = 0;
      for (const u of users) {
        if (u.roleId !== def.id) continue;
        const onDefaults = equalsFeature(u.featurePermissions, prev.featurePermissions);
        const fp = onDefaults ? cloneFeature(def.featurePermissions) : u.featurePermissions;
        if (onDefaults || u.role !== def.baseRole) {
          upsertUser({
            ...u,
            role: def.baseRole,
            featurePermissions: fp,
            permissions: deriveLegacyPermissions(fp),
            inboxPermissions: deriveInbox(fp),
          });
          if (onDefaults) touched += 1;
        }
      }
      addToast({
        type: 'success',
        title: 'Role updated',
        message:
          touched > 0
            ? `${def.name} — new defaults applied to ${touched} employee${touched === 1 ? '' : 's'} without overrides.`
            : `${def.name} saved.`,
      });
    } else {
      addToast({ type: 'success', title: 'Role created', message: `${def.name} (${CATEGORY_LABELS[def.category]})` });
    }
  };

  const deleteRole = (def: RoleDefinition) => {
    if (isSystemSuperAdmin(def)) {
      addToast({ type: 'error', title: 'Protected role', message: 'The system Super Admin role cannot be deleted.' });
      return false;
    }
    const inUse = users.filter((u) => u.roleId === def.id).length;
    if (inUse > 0) {
      addToast({
        type: 'error',
        title: 'Role is in use',
        message: `${def.name} is assigned to ${inUse} employee${inUse === 1 ? '' : 's'}. Reassign them first.`,
      });
      return false;
    }
    removeRole(def.id);
    addToast({ type: 'success', title: 'Role deleted', message: def.name });
    return true;
  };

  const columns: Column<User>[] = [
    {
      key: 'code',
      header: 'Employee Code',
      width: '128px',
      sticky: 'left',
      sortValue: (r) => r.employeeCode,
      render: (r) => <span className="font-medium text-surface-800">{r.employeeCode}</span>,
    },
    {
      key: 'name',
      header: 'Employee Name',
      truncate: true,
      title: (r) => r.fullName,
      sortValue: (r) => r.fullName,
      render: (r) => (
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-600 text-[10px] font-semibold text-white">
            {initials(r.fullName)}
          </span>
          <span className="truncate text-surface-800">{r.fullName}</span>
        </div>
      ),
    },
    {
      key: 'email',
      header: 'Work Email (Login)',
      truncate: true,
      title: (r) => r.email,
      sortValue: (r) => r.email,
      render: (r) => <span className="text-surface-500">{r.email}</span>,
    },
    { key: 'phone', header: 'Phone', width: '132px', render: (r) => <span className="text-surface-500">{r.phone}</span> },
    { key: 'dept', header: 'Department', width: '116px', truncate: true, sortValue: (r) => r.department ?? '', render: (r) => <span className="text-surface-600">{r.department ?? '—'}</span> },
    {
      key: 'role',
      header: 'Role',
      width: '148px',
      sortValue: (r) => roleNameOf(r),
      render: (r) => {
        const def = roleById.get(r.roleId);
        return (
          <StatusBadge
            tone={def?.category === 'admin' ? 'violet' : 'blue'}
            dot={false}
            label={roleNameOf(r)}
          />
        );
      },
    },
    {
      key: 'office',
      header: 'Assigned Office',
      width: '132px',
      sortValue: (r) => (r.officeId ? officeName(r.officeId) : ''),
      render: (r) =>
        r.officeId ? (
          <span className="text-surface-600" title={officeName(r.officeId)}>{officeCode(r.officeId)}</span>
        ) : (
          <span className="text-[11px] font-medium text-amber-600">Unassigned</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '98px',
      render: (r) => <StatusBadge tone={r.active ? 'green' : 'gray'} label={r.active ? 'Active' : 'Inactive'} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '156px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="View" onClick={() => setViewing(r)}>
            <Eye className="h-4 w-4" />
          </IconBtn>
          {canEdit && (
            <IconBtn title="Edit" onClick={() => openEdit(r)}>
              <Pencil className="h-4 w-4" />
            </IconBtn>
          )}
          {canEdit && (
            <IconBtn title="Override Permissions" onClick={() => setPermissionsFor(r)}>
              <ShieldCheck className="h-4 w-4" />
            </IconBtn>
          )}
          {canEdit && (
            <IconBtn title={r.active ? 'Deactivate' : 'Activate'} onClick={() => setConfirmToggle(r)}>
              <Power className={classNames('h-4 w-4', r.active ? 'text-emerald-500' : 'text-surface-400')} />
            </IconBtn>
          )}
        </div>
      ),
    },
  ];

  const managerName = (id?: string) => users.find((u) => u.id === id)?.fullName ?? '—';

  return (
    <>
      <PageHeader
        title="Employee Master"
        description="Manage employees, roles and permissions. Work email is the login identity."
        crumbs={[{ label: 'Master' }, { label: 'Employee Master' }]}
        actions={
          <div className="flex items-center gap-2">
            {canManageRoles && (
              <Button variant="secondary" leftIcon={<UserCog className="h-4 w-4" />} onClick={() => setRolesOpen(true)}>
                Manage Roles
              </Button>
            )}
            {canCreate && (
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>
                Add Employee
              </Button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={clearAll}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, code, email…" className="w-full sm:w-64" />
            <FilterSelect
              value={roleF}
              onChange={setRoleF}
              placeholder="All roles"
              options={roles.map((r) => ({ value: r.id, label: r.name }))}
            />
            <FilterSelect
              value={deptF}
              onChange={setDeptF}
              placeholder="All departments"
              options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
            />
            <FilterSelect
              value={statusF}
              onChange={setStatusF}
              placeholder="All statuses"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            <FilterSelect
              value={assignF}
              onChange={setAssignF}
              placeholder="Any office"
              options={[
                { value: 'assigned', label: 'Assigned' },
                { value: 'unassigned', label: 'Unassigned' },
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
          emptyTitle="No employees found"
          emptyMessage="Try adjusting filters, or add a new employee."
          emptyAction={
            canCreate ? (
              <Button variant="primary" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>
                Add Employee
              </Button>
            ) : undefined
          }
        />
        {!loading && total > 0 && (
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      {/* View modal */}
      <Modal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.fullName} subtitle={viewing?.employeeCode} size="lg">
        {viewing && (
          <DescList
            items={[
              { label: 'Employee Code', value: viewing.employeeCode },
              { label: 'Work Email (login identity)', value: viewing.email },
              { label: 'Phone', value: viewing.phone },
              { label: 'Department', value: viewing.department ?? '—' },
              { label: 'Designation', value: viewing.designation ?? '—' },
              { label: 'Reporting Manager', value: managerName(viewing.reportingManager) },
              {
                label: 'Role',
                value: (
                  <span className="inline-flex items-center gap-2">
                    <StatusBadge
                      tone={roleById.get(viewing.roleId)?.category === 'admin' ? 'violet' : 'blue'}
                      dot={false}
                      label={roleNameOf(viewing)}
                    />
                    <span className="text-[11px] text-surface-400">
                      {CATEGORY_LABELS[roleById.get(viewing.roleId)?.category ?? 'stakeholder']} category
                    </span>
                  </span>
                ),
              },
              {
                label: 'Permissions',
                value: (() => {
                  const def = roleById.get(viewing.roleId);
                  const overridden = def ? hasCustomOverrides(viewing.featurePermissions, def.featurePermissions) : false;
                  return overridden ? (
                    <StatusBadge tone="amber" dot={false} label="Custom overrides" />
                  ) : (
                    <span className="text-surface-600">Role defaults</span>
                  );
                })(),
              },
              {
                label: 'Assigned Office',
                value: viewing.officeId ? `${officeName(viewing.officeId)} (${officeCode(viewing.officeId)})` : 'Unassigned',
              },
              { label: 'Assignment Date', value: viewing.assignmentDate ? formatDate(viewing.assignmentDate) : '—' },
              {
                label: 'Status',
                value: <StatusBadge tone={viewing.active ? 'green' : 'gray'} label={viewing.active ? 'Active' : 'Inactive'} />,
              },
            ]}
          />
        )}
      </Modal>

      {/* Add / Edit employee */}
      {editing && (
        <EmployeeFormModal
          employee={editing}
          isNew={isNew}
          users={users}
          roles={roles}
          offices={offices}
          onClose={() => setEditing(null)}
          onSave={(u) => {
            upsertUser(u);
            addToast({
              type: 'success',
              title: isNew ? 'Employee created' : 'Employee updated',
              message: `${u.employeeCode} — ${u.fullName}`,
            });
            setEditing(null);
          }}
        />
      )}

      {/* Per-employee permission overrides */}
      {permissionsFor && (
        <PermissionsModal
          employee={permissionsFor}
          roles={roles}
          users={users}
          onClose={() => setPermissionsFor(null)}
          onSave={(u) => {
            upsertUser(u);
            addToast({ type: 'success', title: 'Permissions saved', message: `${u.fullName} • ${roleById.get(u.roleId)?.name ?? ''}` });
            setPermissionsFor(null);
          }}
        />
      )}

      {/* Role management (Super Admin) */}
      {rolesOpen && (
        <RolesManagerModal
          roles={roles}
          users={users}
          onClose={() => setRolesOpen(false)}
          onSaveRole={saveRole}
          onDeleteRole={deleteRole}
        />
      )}

      <ConfirmDialog
        open={!!confirmToggle}
        onClose={() => setConfirmToggle(null)}
        onConfirm={() => confirmToggle && toggleActive(confirmToggle)}
        title={confirmToggle?.active ? 'Deactivate employee?' : 'Activate employee?'}
        message={
          confirmToggle?.active
            ? `${confirmToggle?.fullName} will no longer be able to sign in or appear as an active user.`
            : `${confirmToggle?.fullName} will be able to sign in again.`
        }
        confirmLabel={confirmToggle?.active ? 'Deactivate' : 'Activate'}
        danger={confirmToggle?.active}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit employee. Login identity is the WORK EMAIL — no username or
// password fields. Selecting a role loads that role's default permissions;
// per-employee overrides are managed via the Override Permissions action.
// ---------------------------------------------------------------------------
function EmployeeFormModal({
  employee,
  isNew,
  users,
  roles,
  offices,
  onClose,
  onSave,
}: {
  employee: User;
  isNew: boolean;
  users: User[];
  roles: RoleDefinition[];
  offices: { id: string; name: string; code: string; active: boolean }[];
  onClose: () => void;
  onSave: (u: User) => void;
}) {
  const [form, setForm] = useState<User>(employee);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);

  useEffect(() => {
    setForm(employee);
    setErrors({});
    setPendingRoleId(null);
  }, [employee]);

  const set = <K extends keyof User>(k: K, v: User[K]) => setForm((f) => ({ ...f, [k]: v }));

  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const currentDef = roleById.get(form.roleId);

  const guardsLastSuperAdmin =
    !isNew &&
    employee.roleId === SUPER_ADMIN_ROLE_ID &&
    employee.active &&
    !users.some((x) => x.id !== employee.id && x.roleId === SUPER_ADMIN_ROLE_ID && x.active);

  const applyRoleTemplate = (roleId: string) => {
    const def = roleById.get(roleId);
    if (!def) return;
    setForm((f) => ({ ...f, roleId, role: def.baseRole, featurePermissions: cloneFeature(def.featurePermissions) }));
  };

  const requestRoleChange = (roleId: string) => {
    if (roleId === form.roleId) return;
    const def = roleById.get(form.roleId);
    if (def && hasCustomOverrides(form.featurePermissions, def.featurePermissions)) setPendingRoleId(roleId);
    else applyRoleTemplate(roleId);
  };

  const managerOptions = useMemo(
    () =>
      users
        .filter((u) => u.id && u.id !== form.id)
        .map((u) => ({ value: u.id, label: `${u.fullName} (${u.employeeCode})` })),
    [users, form.id]
  );

  const submit = () => {
    const e: Record<string, string> = {};
    const code = form.employeeCode.trim();
    const email = form.email.trim().toLowerCase();

    if (!code) e.employeeCode = 'Employee code is required';
    else if (users.some((u) => u.id !== form.id && u.employeeCode.toLowerCase() === code.toLowerCase()))
      e.employeeCode = 'This employee code is already in use';

    if (!form.fullName.trim()) e.fullName = 'Full name is required';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Enter a valid email';
    else if (users.some((u) => u.id !== form.id && u.email.toLowerCase() === email))
      e.email = 'This work email is already in use';

    if (!/^[+\d][\d\s-]{7,}$/.test(form.phone)) e.phone = 'Enter a valid phone number';

    if (!roleById.get(form.roleId)) e.roleId = 'Select a role';

    // Protect the last active Super Admin: they can neither be deactivated nor
    // moved off the Super Admin role.
    if (guardsLastSuperAdmin && !form.active)
      e.active = 'The last active Super Admin cannot be deactivated';
    if (guardsLastSuperAdmin && form.roleId !== SUPER_ADMIN_ROLE_ID)
      e.roleId = 'The last active Super Admin must keep the Super Admin role';

    setErrors(e);
    if (Object.keys(e).length) return;

    // Resolve office assignment / assignment date. Office assignment is a
    // data-scope concern; changing it here mirrors the Sales Office Master
    // assignment and stamps the assignment date + a transfer record.
    let assignmentDate = form.assignmentDate;
    let transferHistory = form.transferHistory;
    const prevOffice = employee.officeId;
    if (form.officeId !== prevOffice) {
      if (form.officeId) {
        assignmentDate = todayISO();
        if (prevOffice) {
          transferHistory = [
            ...(transferHistory ?? []),
            { id: `trf-${Date.now()}`, fromOfficeId: prevOffice, toOfficeId: form.officeId, date: todayISO(), by: 'Employee Master' },
          ];
        }
      } else {
        assignmentDate = undefined;
      }
    }

    const next: User = {
      ...form,
      employeeCode: code,
      id: form.id || `usr-${Date.now()}`,
      assignmentDate,
      transferHistory,
      permissions: deriveLegacyPermissions(form.featurePermissions),
      inboxPermissions: deriveInbox(form.featurePermissions),
    };
    onSave(next);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? 'Add Employee' : 'Edit Employee'}
      subtitle={isNew ? 'Work email is the login identity — no username or password' : `${form.employeeCode} • ${form.email}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {isNew ? 'Create Employee' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Personal */}
        <section>
          <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-surface-500">Personal Details</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Employee Code / User ID" required value={form.employeeCode} error={errors.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} placeholder="e.g. EMP-0014" />
            <TextField label="Full Name" required value={form.fullName} error={errors.fullName} onChange={(e) => set('fullName', e.target.value)} />
            <TextField
              label="Work Email"
              required
              type="email"
              value={form.email}
              error={errors.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="name@flowtech-instruments.com"
              hint="This is the login identity — there are no usernames or passwords"
            />
            <TextField label="Phone" required value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98XXX XXXXX" />
            <SelectField label="Department" value={form.department ?? ''} onChange={(e) => set('department', e.target.value)} options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} placeholder="Select department…" />
            <TextField label="Designation" value={form.designation ?? ''} onChange={(e) => set('designation', e.target.value)} placeholder="e.g. Sales Executive" />
            <SelectField label="Reporting Manager" value={form.reportingManager ?? ''} onChange={(e) => set('reportingManager', e.target.value)} options={managerOptions} placeholder="None" hint="Optional" />
            <SelectField
              label="Assigned Office"
              value={form.officeId}
              onChange={(e) => set('officeId', e.target.value)}
              options={offices.map((o) => ({ value: o.id, label: `${o.name} (${o.code})${o.active ? '' : ' — Inactive'}` }))}
              placeholder="Unassigned"
              hint="Controls which office's data this employee can see"
            />
          </div>
        </section>

        {/* Role & access */}
        <section>
          <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-surface-500">Role &amp; Access</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Role"
              required
              value={form.roleId}
              error={errors.roleId}
              onChange={(e) => requestRoleChange(e.target.value)}
              groups={roleGroups(roles)}
              hint={currentDef ? currentDef.description : 'Selecting a role loads its default permissions'}
            />
            <div className="flex items-end pb-1">
              <div>
                <Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} />
                {errors.active && <p className="mt-1 text-xs font-medium text-rose-600">{errors.active}</p>}
              </div>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-surface-400">
            Employees sign in with their <span className="font-medium text-surface-600">work email</span>. Roles carry
            default permissions; use <span className="font-medium text-surface-600">Override Permissions</span> to
            customise an individual employee.
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={!!pendingRoleId}
        onClose={() => setPendingRoleId(null)}
        onConfirm={() => pendingRoleId && applyRoleTemplate(pendingRoleId)}
        title="Replace custom permissions?"
        message={`This employee has custom permission overrides. Switching to ${roleById.get(pendingRoleId ?? '')?.name ?? ''} will replace them with that role's default template.`}
        confirmLabel="Apply defaults"
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Override Permissions — per-EMPLOYEE permission overrides on top of the
// assigned role's defaults. The role's template itself is edited in Manage
// Roles; anything changed here applies to this employee only.
// ---------------------------------------------------------------------------
function PermissionsModal({
  employee,
  roles,
  users,
  onClose,
  onSave,
}: {
  employee: User;
  roles: RoleDefinition[];
  users: User[];
  onClose: () => void;
  onSave: (u: User) => void;
}) {
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);
  const [roleId, setRoleId] = useState<string>(employee.roleId);
  const [fp, setFp] = useState<FeaturePermissions>(() =>
    cloneFeature(employee.featurePermissions ?? roleById.get(employee.roleId)?.featurePermissions ?? emptyFeaturePermissions())
  );
  const [pendingRoleId, setPendingRoleId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRoleId(employee.roleId);
    setFp(cloneFeature(employee.featurePermissions ?? roleById.get(employee.roleId)?.featurePermissions ?? emptyFeaturePermissions()));
    setPendingRoleId(null);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  const def = roleById.get(roleId);

  const guardsLastSuperAdmin =
    employee.roleId === SUPER_ADMIN_ROLE_ID &&
    employee.active &&
    !users.some((x) => x.id !== employee.id && x.roleId === SUPER_ADMIN_ROLE_ID && x.active);

  const applyRoleTemplate = (id: string) => {
    const d = roleById.get(id);
    if (!d) return;
    setRoleId(id);
    setFp(cloneFeature(d.featurePermissions));
  };

  const requestRoleChange = (id: string) => {
    if (id === roleId) return;
    if (def && hasCustomOverrides(fp, def.featurePermissions)) setPendingRoleId(id);
    else applyRoleTemplate(id);
  };

  const customised = def ? hasCustomOverrides(fp, def.featurePermissions) : false;

  const save = () => {
    if (guardsLastSuperAdmin && roleId !== SUPER_ADMIN_ROLE_ID) {
      setError('The last active Super Admin must keep the Super Admin role.');
      return;
    }
    const d = roleById.get(roleId);
    if (!d) return;
    onSave({
      ...employee,
      roleId,
      role: d.baseRole,
      featurePermissions: fp,
      permissions: deriveLegacyPermissions(fp),
      inboxPermissions: deriveInbox(fp),
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Override Permissions"
      subtitle={`${employee.fullName} • ${employee.employeeCode} — applies to this employee only`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save Permissions
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SelectField
            label="Role"
            wrapClassName="w-full sm:w-64"
            value={roleId}
            onChange={(e) => requestRoleChange(e.target.value)}
            groups={roleGroups(roles)}
            hint="Loads the role's default permissions"
          />
          <button
            type="button"
            onClick={() => applyRoleTemplate(roleId)}
            className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-600 hover:underline"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Reset to {def?.name ?? 'role'} defaults
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700">
            {error}
          </div>
        )}

        {customised && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              These permissions are <span className="font-semibold">custom overrides</span> for this employee — they
              differ from the <span className="font-semibold">{def?.name}</span> role defaults.
            </span>
          </div>
        )}

        <PermissionMatrixEditor value={fp} onChange={setFp} />

        <p className="text-[12px] text-surface-400">
          Overrides apply to this employee only — the {def?.name ?? 'role'} defaults are unchanged (edit those in
          Manage Roles). Office assignment only controls which office's data this employee can see.
        </p>
      </div>

      <ConfirmDialog
        open={!!pendingRoleId}
        onClose={() => setPendingRoleId(null)}
        onConfirm={() => pendingRoleId && applyRoleTemplate(pendingRoleId)}
        title="Replace custom permissions?"
        message={`Switching to ${roleById.get(pendingRoleId ?? '')?.name ?? ''} will replace the current custom permissions with that role's default template.`}
        confirmLabel="Apply defaults"
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Manage Roles — Super Admin's role register. Lists roles by CATEGORY (Admin /
// Stakeholder), with copy, rename, create-custom, edit-defaults and delete.
// The system Super Admin role is protected from rename and deletion.
// ---------------------------------------------------------------------------
function RolesManagerModal({
  roles,
  users,
  onClose,
  onSaveRole,
  onDeleteRole,
}: {
  roles: RoleDefinition[];
  users: User[];
  onClose: () => void;
  onSaveRole: (def: RoleDefinition, prev?: RoleDefinition) => void;
  onDeleteRole: (def: RoleDefinition) => boolean;
}) {
  // editor: null = list; {def, prev} = editing existing; {def} = creating new/copy
  const [editor, setEditor] = useState<{ def: RoleDefinition; prev?: RoleDefinition } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoleDefinition | null>(null);

  const employeeCount = (id: string) => users.filter((u) => u.roleId === id).length;

  const startCreate = () =>
    setEditor({
      def: {
        id: `role-custom-${Date.now()}`,
        name: '',
        category: 'stakeholder',
        description: '',
        system: false,
        baseRole: 'sales_user',
        featurePermissions: emptyFeaturePermissions(),
      },
    });

  const startCopy = (src: RoleDefinition) =>
    setEditor({
      def: {
        id: `role-custom-${Date.now()}`,
        name: `Copy of ${src.name}`,
        category: src.category,
        description: src.description,
        system: false,
        baseRole: src.baseRole,
        featurePermissions: cloneFeature(src.featurePermissions),
        copiedFrom: src.id,
      },
    });

  const startEdit = (def: RoleDefinition) => setEditor({ def: { ...def, featurePermissions: cloneFeature(def.featurePermissions) }, prev: def });

  const section = (category: RoleCategory) => {
    const list = roles.filter((r) => r.category === category);
    return (
      <section key={category}>
        <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-surface-500">
          {CATEGORY_LABELS[category]}
          <span className="ml-2 font-medium normal-case tracking-normal text-surface-400">
            {category === 'stakeholder' ? 'Category — groups the operational roles; not a selectable role' : 'Full-control platform roles'}
          </span>
        </h4>
        <div className="overflow-hidden rounded-xl border border-surface-200">
          {list.map((r, i) => {
            const count = employeeCount(r.id);
            const { on, total } = enabledCount(r.featurePermissions);
            const protectedRole = isSystemSuperAdmin(r);
            return (
              <div
                key={r.id}
                className={classNames(
                  'flex flex-wrap items-center gap-3 px-4 py-3',
                  i > 0 && 'border-t border-surface-100'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-surface-800">{r.name}</span>
                    {r.system ? (
                      <StatusBadge tone="slate" dot={false} label="System" />
                    ) : (
                      <StatusBadge tone="teal" dot={false} label="Custom" />
                    )}
                    {protectedRole && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-surface-400" title="The system Super Admin role cannot be deleted">
                        <Lock className="h-3 w-3" /> Protected
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-surface-500" title={r.description}>
                    {r.description || '—'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-surface-400">
                    {count} employee{count === 1 ? '' : 's'} • {on} of {total} permissions enabled
                    {r.copiedFrom ? ` • copied from ${roles.find((x) => x.id === r.copiedFrom)?.name ?? 'a deleted role'}` : ''}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-0.5">
                  <IconBtn title={protectedRole ? 'Edit default permissions' : 'Edit / rename'} onClick={() => startEdit(r)}>
                    <Pencil className="h-4 w-4" />
                  </IconBtn>
                  <IconBtn title="Copy role" onClick={() => startCopy(r)}>
                    <Copy className="h-4 w-4" />
                  </IconBtn>
                  {protectedRole ? (
                    <span
                      className="inline-flex h-8 w-8 cursor-not-allowed items-center justify-center text-surface-300"
                      title="The system Super Admin role cannot be deleted"
                    >
                      <Trash2 className="h-4 w-4" />
                    </span>
                  ) : (
                    <IconBtn title="Delete role" onClick={() => setConfirmDelete(r)}>
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </IconBtn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        size="xl"
        title="Manage Roles"
        subtitle="Copy, rename or create roles and edit their default permissions. Changes to a role's defaults apply to employees without custom overrides."
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={startCreate}>
              Create Custom Role
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {section('admin')}
          {section('stakeholder')}
        </div>
      </Modal>

      {editor && (
        <RoleEditModal
          def={editor.def}
          isNew={!editor.prev}
          roles={roles}
          onClose={() => setEditor(null)}
          onSave={(d) => {
            onSaveRole(d, editor.prev);
            setEditor(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) onDeleteRole(confirmDelete);
        }}
        title="Delete role?"
        message={
          confirmDelete
            ? employeeCount(confirmDelete.id) > 0
              ? `${confirmDelete.name} is assigned to ${employeeCount(confirmDelete.id)} employee(s) — deletion will be refused until they are reassigned.`
              : `${confirmDelete.name} will be permanently removed from the role register.`
            : ''
        }
        confirmLabel="Delete"
        danger
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Role editor — create / copy / rename a role and edit its default permission
// template. The system Super Admin role keeps its name and category.
// ---------------------------------------------------------------------------
function RoleEditModal({
  def,
  isNew,
  roles,
  onClose,
  onSave,
}: {
  def: RoleDefinition;
  isNew: boolean;
  roles: RoleDefinition[];
  onClose: () => void;
  onSave: (d: RoleDefinition) => void;
}) {
  const [form, setForm] = useState<RoleDefinition>(def);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm(def);
    setErrors({});
  }, [def]);

  const protectedRole = isSystemSuperAdmin(def);
  const nameLocked = protectedRole; // system Super Admin cannot be renamed
  const categoryLocked = def.system; // system roles keep their category

  const submit = () => {
    const e: Record<string, string> = {};
    const name = form.name.trim();
    if (!name) e.name = 'Role name is required';
    else if (roles.some((r) => r.id !== form.id && r.name.trim().toLowerCase() === name.toLowerCase()))
      e.name = 'A role with this name already exists';
    setErrors(e);
    if (Object.keys(e).length) return;

    // Category drives the scope archetype for custom roles: Admin-category
    // roles see all offices; Stakeholder roles are office-scoped. Copies keep
    // their source archetype unless the category was changed.
    let baseRole = form.baseRole;
    if (!form.system) {
      if (form.category === 'admin') baseRole = 'super_admin';
      else if (baseRole === 'super_admin') baseRole = 'sales_user';
    }
    onSave({ ...form, name, baseRole });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? (def.copiedFrom ? 'Copy Role' : 'Create Custom Role') : `Edit Role — ${def.name}`}
      subtitle={
        isNew
          ? 'Name the role, pick its category and set its default permissions'
          : def.system
            ? 'System role — edit its default permissions'
            : 'Custom role — rename or edit its default permissions'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {isNew ? 'Create Role' : 'Save Role'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Role Name"
            required
            value={form.name}
            error={errors.name}
            disabled={nameLocked}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Regional Sales Head"
            hint={nameLocked ? 'The system Super Admin role cannot be renamed' : undefined}
          />
          <SelectField
            label="Category"
            required
            value={form.category}
            disabled={categoryLocked}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as RoleCategory }))}
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'stakeholder', label: 'Stakeholder' },
            ]}
            hint={
              categoryLocked
                ? 'System roles keep their category'
                : 'Admin roles see all offices; Stakeholder roles are scoped to their assigned office'
            }
          />
        </div>
        <TextAreaField
          label="Description"
          rows={2}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="What this role is for…"
        />

        <div>
          <h4 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-surface-500">Default Permissions</h4>
          <PermissionMatrixEditor
            value={form.featurePermissions}
            onChange={(fp) => setForm((f) => ({ ...f, featurePermissions: fp }))}
          />
          {!isNew && (
            <p className="mt-2 text-[12px] text-surface-400">
              Saving applies the new defaults to employees on this role who have no custom overrides. Employees with
              overrides keep them.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
