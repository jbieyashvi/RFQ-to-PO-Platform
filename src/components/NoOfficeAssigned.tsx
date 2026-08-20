import { Building2 } from 'lucide-react';
import { EmptyState } from '@/components/ui';

// Dedicated empty state shown on office-scoped screens when the acting
// (non–super-admin) employee has no Sales Office assigned. We deliberately do
// NOT silently show all offices' data — office assignment is managed in
// Employee Master / Sales Office Master.
export function NoOfficeAssigned({ inCard = true }: { inCard?: boolean }) {
  const body = (
    <EmptyState
      icon={<Building2 className="h-7 w-7" />}
      title="No Sales Office is assigned to your account"
      message="Contact the administrator to be assigned to a Sales Office. Once assigned, that office's business data will appear here."
    />
  );
  if (!inCard) return body;
  return <div className="card">{body}</div>;
}
