import { useNavigate } from 'react-router-dom';
import {
  FileText,
  RefreshCw,
  ClipboardCheck,
  FileSpreadsheet,
  Reply,
  UserCog,
  AlertTriangle,
} from 'lucide-react';
import type { InboxEmail } from '@/types';
import { Button, SelectField } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { extractionState } from './helpers';

/**
 * The RIGHT panel for NORMAL inbox emails (no quote-send mode). It carries the
 * contextual Business Action for the email's classification plus the Reassign
 * control. The outgoing email is written and sent from the CENTRE panel
 * (InboxCenterPanel) — this panel never hosts the composer.
 */
export function EmailActionPanel({ email }: { email: InboxEmail }) {
  const { updateEmail, canInbox, addToast, users } = useApp();
  const navigate = useNavigate();

  const canReassign = canInbox('reassign');

  const reassign = (userId: string) => {
    const u = users.find((x) => x.id === userId);
    if (!u) return;
    updateEmail(email.id, { owner: u.fullName, officeId: u.officeId });
    addToast({ type: 'success', title: 'Email reassigned', message: `Assigned to ${u.fullName}.` });
  };

  const actions = contextualActions(email, navigate);

  // The related business action (prepare quotation, start PO verification, SO
  // revision, …) stays locked until the AI-extracted mandatory fields are
  // confirmed. Generic mail (State C → 'hidden') is never gated.
  const extractionLocked = extractionState(email) === 'needs_review';

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Business Action</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {email.classification === 'unclassified' ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>This email is <span className="font-semibold">Unclassified</span>. Classify it (use “Reclassify” in the centre panel) before any business action or reply can proceed.</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {actions.map((a) => (
              <Button
                key={a.label}
                variant={a.primary ? 'primary' : 'secondary'}
                size="sm"
                className="w-full justify-start"
                leftIcon={a.icon}
                onClick={a.onClick}
                disabled={extractionLocked}
                title={extractionLocked ? 'Confirm the extracted details before starting this action.' : undefined}
              >
                {a.label}
              </Button>
            ))}
            {extractionLocked && actions.length > 0 && (
              <p className="flex items-start gap-1.5 pt-1 text-[11px] text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                Confirm the AI-extracted details in the centre panel to unlock this action.
              </p>
            )}
          </div>
        )}

        {/* Reassign */}
        {canReassign && (
          <div className="mt-4">
            <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-surface-500"><UserCog className="h-3.5 w-3.5" /> Reassign owner</label>
            <SelectField
              className="w-full py-1.5 text-[13px]"
              value={users.find((u) => u.fullName === email.owner)?.id ?? ''}
              onChange={(e) => reassign(e.target.value)}
              options={users.filter((u) => u.active).map((u) => ({ value: u.id, label: `${u.fullName} · ${officeName(u.officeId)}` }))}
              placeholder="Select owner…"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function contextualActions(
  email: InboxEmail,
  navigate: (to: string) => void
): { label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean }[] {
  switch (email.classification) {
    case 'inquiry':
      return [
        { label: 'Prepare Quotation', icon: <FileText className="h-4 w-4" />, onClick: () => navigate('/quotations/pending'), primary: true },
      ];
    case 'quotation_revision':
      return [
        { label: 'Open Quotation & Start Revision', icon: <RefreshCw className="h-4 w-4" />, onClick: () => navigate('/quotations/revisions'), primary: true },
      ];
    case 'purchase_order':
      return [
        { label: 'Start PO vs Quote Verification', icon: <ClipboardCheck className="h-4 w-4" />, onClick: () => navigate('/sales-orders/verification'), primary: true },
      ];
    case 'so_query':
      return [
        { label: 'Open Sales Order', icon: <FileSpreadsheet className="h-4 w-4" />, onClick: () => navigate('/sales-orders'), primary: true },
        { label: 'Create SO Revision', icon: <RefreshCw className="h-4 w-4" />, onClick: () => navigate('/sales-orders/revisions') },
      ];
    case 'finance_other':
      return [
        { label: 'Reply to Sender', icon: <Reply className="h-4 w-4" />, onClick: () => {}, primary: true },
      ];
    default:
      return [];
  }
}
