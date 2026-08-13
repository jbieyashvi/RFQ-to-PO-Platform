import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { ModuleKey } from '@/types';
import { useApp } from '@/context/AppContext';
import { MODULE_LABELS, ROLE_LABELS } from '@/lib/labels';
import { Button } from '@/components/ui';

export function RequirePermission({
  module,
  children,
}: {
  module: ModuleKey;
  children: ReactNode;
}) {
  const { can, role } = useApp();
  if (can(module, 'view')) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold text-surface-800">Access restricted</h2>
        <p className="mt-2 text-sm text-surface-500">
          Your previewed role <span className="font-medium text-surface-700">{ROLE_LABELS[role]}</span>{' '}
          does not have permission to view{' '}
          <span className="font-medium text-surface-700">{MODULE_LABELS[module]}</span>. Switch the role
          preview in the header to explore this module.
        </p>
        <div className="mt-5">
          <Link to="/dashboard">
            <Button variant="primary">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function RequireInbox({ children }: { children: ReactNode }) {
  const { canInbox, role } = useApp();
  if (canInbox('view')) return <>{children}</>;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <ShieldAlert className="h-7 w-7" />
        </div>
        <h2 className="text-lg font-semibold text-surface-800">Access restricted</h2>
        <p className="mt-2 text-sm text-surface-500">
          Your previewed role <span className="font-medium text-surface-700">{ROLE_LABELS[role]}</span>{' '}
          does not have permission to view the{' '}
          <span className="font-medium text-surface-700">Global Inbox</span>. Switch the role preview in
          the header to explore this module.
        </p>
        <div className="mt-5">
          <Link to="/dashboard">
            <Button variant="primary">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
