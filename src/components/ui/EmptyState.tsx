import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-100 text-surface-400">
        {icon ?? <Inbox className="h-7 w-7" />}
      </div>
      <h3 className="text-sm font-semibold text-surface-700">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-surface-400">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
