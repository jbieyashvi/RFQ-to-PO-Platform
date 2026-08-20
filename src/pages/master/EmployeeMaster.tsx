import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Eye, Power, ShieldCheck, KeyRound, RefreshCw } from 'lucide-react';
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
  PermissionMatrixEditor,
  type Column,
  type FilterChip,
} from '@/components/ui';
import { IconBtn } from './ItemMaster';
import { useApp } from '@/context/AppContext';
import { ROLE_LABELS } from '@/lib/labels';
import { officeName, officeCode } from '@/data/offices';
import { classNames, formatDate, TODAY } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';
import {
  makeFeaturePermissions,
  cloneFeature,
  hasCustomOverrides,
  deriveLegacyPermissions,
  deriveInbox,
} from '@/lib/featurePermissions';
import type { FeaturePermissions, Role, User } from '@/types';

const ROLES: Role[] = ['super_admin', 'office_admin', 'sales_user', 'management_viewer'];
const DEPARTMENTS = ['Administration', 'Sales', 'Management', 'Operations', 'Finance'];

const todayISO = () => TODAY.toISOString().slice(0, 10);

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

const emptyEmployee = (users: User[]): User => {
  const fp = makeFeaturePermissions('sales_user');
  return {
    id: '',
    employeeCode: nextEmployeeCode(users),
    fullName: '',
    email: '',
    phone: '',
    department: 'Sales',
    designation: '',
    reportingManager: '',
    role: 'sales_user',
    username: '',
    forcePasswordChange: true,
    officeId: '',
    active: true,
    featurePermissions: fp,
    permissions: deriveLegacyPermissions(fp),
    inboxPermissions: deriveInbox(fp),
  };
};

export default function EmployeeMaster() {
  const { users, upsertUser, offices, can, addToast } = useApp();
  const [search, setSearch] = useState('');
  const [roleF, setRoleF] = useState('');
  const [deptF, setDeptF] = useState('');
  const [statusF, setStatusF] = useState('');
  const [assignF, setAssignF] = useState('');

  const [editing, setEditing] = useState<User | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [viewing, setViewing] = useState<User | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<User | null>(null);
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<User | null>(null);

  const loading = useSimulatedLoading([]);
  const canEdit = can('employee_master', 'edit');
  const canCreate = can('employee_master', 'create');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleF && u.role !== roleF) return false;
      if (deptF && (u.department ?? '') !== deptF) return false;
      if (statusF === 'active' && !u.active) return false;
      if (statusF === 'inactive' && u.active) return false;
      if (assignF === 'assigned' && !u.officeId) return false;
      if (assignF === 'unassigned' && u.officeId) return false;
      if (s && !`${u.employeeCode} ${u.fullName} ${u.email} ${u.username}`.toLowerCase().includes(s))
        return false;
      return true;
    });
  }, [users, search, roleF, deptF, statusF, assignF]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered);

  const chips: FilterChip[] = [];
  if (roleF) chips.push({ key: 'role', label: `Role: ${ROLE_LABELS[roleF as Role]}`, onRemove: () => setRoleF('') });
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
    setEditing(emptyEmployee(users));
    setIsNew(true);
  };
  const openEdit = (u: User) => {
    setEditing({ ...u, featurePermissions: cloneFeature(u.featurePermissions ?? makeFeaturePermissions(u.role)) });
    setIsNew(false);
  };

  const toggleActive = (u: User) => {
    upsertUser({ ...u, active: !u.active });
    addToast({
      type: 'success',
      title: u.active ? 'Employee deactivated' : 'Employee activated',
      message: `${u.employeeCode} — ${u.fullName}`,
    });
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
    { key: 'email', header: 'Email', truncate: true, title: (r) => r.email, sortValue: (r) => r.email, render: (r) => <span className="text-surface-500">{r.email}</span> },
    { key: 'phone', header: 'Phone', width: '132px', render: (r) => <span className="text-surface-500">{r.phone}</span> },
    { key: 'dept', header: 'Department', width: '116px', truncate: true, sortValue: (r) => r.department ?? '', render: (r) => <span className="text-surface-600">{r.department ?? '—'}</span> },
    { key: 'desig', header: 'Designation', width: '132px', truncate: true, title: (r) => r.designation ?? '', sortValue: (r) => r.designation ?? '', render: (r) => <span className="text-surface-600">{r.designation ?? '—'}</span> },
    {
      key: 'role',
      header: 'Role',
      width: '132px',
      sortValue: (r) => ROLE_LABELS[r.role],
      render: (r) => <StatusBadge tone="blue" dot={false} label={ROLE_LABELS[r.role]} />,
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
      width: '188px',
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
            <IconBtn title="Manage Permissions" onClick={() => setPermissionsFor(r)}>
              <ShieldCheck className="h-4 w-4" />
            </IconBtn>
          )}
          {canEdit && (
            <IconBtn title="Reset Password" onClick={() => setResetFor(r)}>
              <KeyRound className="h-4 w-4" />
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
        description="Manage employees, login identities, roles and permissions."
        crumbs={[{ label: 'Master' }, { label: 'Employee Master' }]}
        actions={
          canCreate && (
            <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openNew}>
              Add Employee
            </Button>
          )
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
              options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
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
              { label: 'Employee Code / User ID', value: viewing.employeeCode },
              { label: 'Username', value: viewing.username },
              { label: 'Work Email', value: viewing.email },
              { label: 'Phone', value: viewing.phone },
              { label: 'Department', value: viewing.department ?? '—' },
              { label: 'Designation', value: viewing.designation ?? '—' },
              { label: 'Reporting Manager', value: managerName(viewing.reportingManager) },
              { label: 'Role', value: ROLE_LABELS[viewing.role] },
              {
                label: 'Assigned Office',
                value: viewing.officeId ? `${officeName(viewing.officeId)} (${officeCode(viewing.officeId)})` : 'Unassigned',
              },
              { label: 'Assignment Date', value: viewing.assignmentDate ? formatDate(viewing.assignmentDate) : '—' },
              {
                label: 'Status',
                value: <StatusBadge tone={viewing.active ? 'green' : 'gray'} label={viewing.active ? 'Active' : 'Inactive'} />,
              },
              { label: 'Force password change', value: viewing.forcePasswordChange ? 'Yes' : 'No' },
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
          offices={offices}
          onClose={() => setEditing(null)}
          onSave={(u, tempPassword) => {
            upsertUser(u);
            addToast({
              type: 'success',
              title: isNew ? 'Employee created' : 'Employee updated',
              message:
                isNew && tempPassword
                  ? `${u.fullName} • temporary password set`
                  : `${u.employeeCode} — ${u.fullName}`,
            });
            setEditing(null);
          }}
        />
      )}

      {/* Manage permissions */}
      {permissionsFor && (
        <PermissionsModal
          employee={permissionsFor}
          onClose={() => setPermissionsFor(null)}
          onSave={(u) => {
            upsertUser(u);
            addToast({ type: 'success', title: 'Permissions saved', message: `${u.fullName} • ${ROLE_LABELS[u.role]}` });
            setPermissionsFor(null);
          }}
        />
      )}

      {/* Reset password */}
      {resetFor && (
        <ResetPasswordModal
          employee={resetFor}
          onClose={() => setResetFor(null)}
          onSave={(u) => {
            upsertUser(u);
            addToast({ type: 'success', title: 'Password reset', message: `A temporary password was set for ${u.fullName}.` });
            setResetFor(null);
          }}
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
// Add / Edit employee — Personal + Login identity. Permissions are managed
// separately via the "Manage Permissions" action (matrix editor).
// ---------------------------------------------------------------------------
function EmployeeFormModal({
  employee,
  isNew,
  users,
  offices,
  onClose,
  onSave,
}: {
  employee: User;
  isNew: boolean;
  users: User[];
  offices: { id: string; name: string; code: string; active: boolean }[];
  onClose: () => void;
  onSave: (u: User, tempPassword?: string) => void;
}) {
  const [form, setForm] = useState<User>(employee);
  const [tempPassword, setTempPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingRole, setPendingRole] = useState<Role | null>(null);

  useEffect(() => {
    setForm(employee);
    setTempPassword('');
    setErrors({});
    setPendingRole(null);
  }, [employee]);

  const set = <K extends keyof User>(k: K, v: User[K]) => setForm((f) => ({ ...f, [k]: v }));

  const applyRoleTemplate = (role: Role) =>
    setForm((f) => ({ ...f, role, featurePermissions: makeFeaturePermissions(role) }));

  const requestRoleChange = (role: Role) => {
    if (role === form.role) return;
    if (hasCustomOverrides(form.featurePermissions, form.role)) setPendingRole(role);
    else applyRoleTemplate(role);
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
    const username = form.username.trim().toLowerCase();

    if (!code) e.employeeCode = 'Employee code is required';
    else if (users.some((u) => u.id !== form.id && u.employeeCode.toLowerCase() === code.toLowerCase()))
      e.employeeCode = 'This employee code is already in use';

    if (!form.fullName.trim()) e.fullName = 'Full name is required';

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Enter a valid email';
    else if (users.some((u) => u.id !== form.id && u.email.toLowerCase() === email)) e.email = 'This email is already in use';

    if (!/^[+\d][\d\s-]{7,}$/.test(form.phone)) e.phone = 'Enter a valid phone number';

    if (!username) e.username = 'Username is required';
    else if (users.some((u) => u.id !== form.id && u.username.toLowerCase() === username)) e.username = 'This username is already in use';

    if (isNew && !tempPassword.trim()) e.tempPassword = 'Set a temporary password';

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
    onSave(next, isNew ? tempPassword : undefined);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? 'Add Employee' : 'Edit Employee'}
      subtitle={isNew ? 'Create an employee and login identity' : `${form.employeeCode} • ${form.email}`}
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
            <TextField label="Work Email" required type="email" value={form.email} error={errors.email} onChange={(e) => set('email', e.target.value)} placeholder="name@flowtech-instruments.com" />
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

        {/* Login */}
        <section>
          <h4 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-surface-500">Login &amp; Access</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Username / User ID" required value={form.username} error={errors.username} onChange={(e) => set('username', e.target.value)} placeholder="e.g. rahul.verma" />
            <SelectField
              label="Role"
              required
              value={form.role}
              onChange={(e) => requestRoleChange(e.target.value as Role)}
              options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              hint="Selecting a role loads its default permissions"
            />
            {isNew && (
              <TextField
                label="Temporary Password"
                required
                value={tempPassword}
                error={errors.tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Set an initial password"
                hint="Prototype only — never stored or shown again"
              />
            )}
            <div className="flex items-end gap-6 pb-1">
              <Toggle checked={!!form.forcePasswordChange} onChange={(v) => set('forcePasswordChange', v)} label="Force password change on first login" />
            </div>
            <div className="flex items-end pb-1">
              <Toggle checked={form.active} onChange={(v) => set('active', v)} label={form.active ? 'Active' : 'Inactive'} />
            </div>
          </div>
          {!isNew && (
            <p className="mt-3 text-[12px] text-surface-400">
              Existing passwords are never shown. Use the <span className="font-medium text-surface-600">Reset Password</span> action to set a new one.
            </p>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={!!pendingRole}
        onClose={() => setPendingRole(null)}
        onConfirm={() => pendingRole && applyRoleTemplate(pendingRole)}
        title="Replace custom permissions?"
        message={`This employee has custom permission overrides. Switching to ${pendingRole ? ROLE_LABELS[pendingRole] : ''} will replace them with that role's default template.`}
        confirmLabel="Apply defaults"
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Manage Permissions — the granular matrix. Role preset, per-column / per-module
// select-all, clear-all live inside the editor. Reset-to-defaults + save + the
// custom-override warning live here.
// ---------------------------------------------------------------------------
function PermissionsModal({
  employee,
  onClose,
  onSave,
}: {
  employee: User;
  onClose: () => void;
  onSave: (u: User) => void;
}) {
  const [role, setRole] = useState<Role>(employee.role);
  const [fp, setFp] = useState<FeaturePermissions>(() => cloneFeature(employee.featurePermissions ?? makeFeaturePermissions(employee.role)));
  const [pendingRole, setPendingRole] = useState<Role | null>(null);

  useEffect(() => {
    setRole(employee.role);
    setFp(cloneFeature(employee.featurePermissions ?? makeFeaturePermissions(employee.role)));
    setPendingRole(null);
  }, [employee]);

  const applyRoleTemplate = (r: Role) => {
    setRole(r);
    setFp(makeFeaturePermissions(r));
  };

  const requestRoleChange = (r: Role) => {
    if (r === role) return;
    if (hasCustomOverrides(fp, role)) setPendingRole(r);
    else applyRoleTemplate(r);
  };

  const customised = hasCustomOverrides(fp, role);

  const save = () => {
    onSave({
      ...employee,
      role,
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
      title="Manage Permissions"
      subtitle={`${employee.fullName} • ${employee.employeeCode}`}
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
            label="Role preset"
            wrapClassName="w-full sm:w-64"
            value={role}
            onChange={(e) => requestRoleChange(e.target.value as Role)}
            options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
            hint="Loads the default permissions for the role"
          />
          <button
            type="button"
            onClick={() => applyRoleTemplate(role)}
            className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-medium text-brand-600 hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reset to {ROLE_LABELS[role]} defaults
          </button>
        </div>

        {customised && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-none" />
            <span>
              These permissions have been customised and differ from the{' '}
              <span className="font-semibold">{ROLE_LABELS[role]}</span> default preset.
            </span>
          </div>
        )}

        <PermissionMatrixEditor value={fp} onChange={setFp} />

        <p className="text-[12px] text-surface-400">
          Permissions come only from Employee Master. Office assignment (in Sales Office Master) only controls which
          office's data this employee can see — it never grants an action disabled here.
        </p>
      </div>

      <ConfirmDialog
        open={!!pendingRole}
        onClose={() => setPendingRole(null)}
        onConfirm={() => pendingRole && applyRoleTemplate(pendingRole)}
        title="Replace custom permissions?"
        message={`Switching to ${pendingRole ? ROLE_LABELS[pendingRole] : ''} will replace the current custom permissions with that role's default template.`}
        confirmLabel="Apply defaults"
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reset Password — sets a new temporary password (prototype: not persisted) and
// optionally forces a change on next login. Existing passwords are never shown.
// ---------------------------------------------------------------------------
function ResetPasswordModal({
  employee,
  onClose,
  onSave,
}: {
  employee: User;
  onClose: () => void;
  onSave: (u: User) => void;
}) {
  const [pwd, setPwd] = useState('');
  const [force, setForce] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setPwd('');
    setForce(true);
    setError('');
  }, [employee]);

  const generate = () => {
    // Simple readable temp password for the prototype.
    const words = ['Flow', 'Tech', 'Sales', 'Order', 'Quote', 'Delta', 'Nimbus', 'Vertex'];
    const w = words[employee.employeeCode.length % words.length];
    setPwd(`${w}@${1000 + (employee.fullName.length * 7) % 9000}`);
    setError('');
  };

  const submit = () => {
    if (!pwd.trim()) {
      setError('Set a temporary password');
      return;
    }
    onSave({ ...employee, forcePasswordChange: force });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Reset Password"
      subtitle={`${employee.fullName} • ${employee.employeeCode}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            Reset Password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px] text-surface-500">
          Set a new temporary password for this employee. The existing password is never displayed. This is a frontend
          prototype, so the value is not stored anywhere.
        </p>
        <div className="flex items-end gap-2">
          <TextField
            label="Temporary Password"
            required
            wrapClassName="flex-1"
            value={pwd}
            error={error}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="Enter or generate a password"
          />
          <Button variant="secondary" onClick={generate} className="mb-[1px]">
            Generate
          </Button>
        </div>
        <Toggle checked={force} onChange={setForce} label="Force password change on next login" />
      </div>
    </Modal>
  );
}
