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
import type { RequirementExtraction } from '@/lib/requirementExtraction';
import { Button, SelectField } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';

/** Why the business action is locked — the line items above are the only way out. */
const LOCK_MESSAGE = 'Review and confirm every extracted line item to generate the quotation.';

/**
 * The RIGHT panel for NORMAL inbox emails (no quote-send mode). It carries the
 * contextual Business Action for the email's classification, the way into the
 * compose window, and the Reassign control.
 *
 * The centre panel no longer holds an always-open outgoing form, so this panel
 * is where a reply now STARTS: "Send Acknowledgement" / "Reply to Sender" opens
 * the Gmail-style compose window over the inbox. That entry is deliberately not
 * gated on the extraction — acknowledging an enquiry is not a business action,
 * and telling a customer "received, we'll revert" should never wait on a
 * datasheet being confirmed.
 */
export function EmailActionPanel({
  email,
  extraction,
  onGenerateQuote,
  onCompose,
}: {
  email: InboxEmail;
  /**
   * The line-level reading of the enquiry, passed in whenever the AI
   * Requirement Extraction panel sits above this one. Those line-item cards are
   * the ONLY confirmation workflow — Generate Quote waits on them and on
   * nothing else.
   */
  extraction?: RequirementExtraction | null;
  /** Open the quotation builder over the inbox (inquiries only). */
  onGenerateQuote?: () => void;
  /** Open the compose window for a reply / acknowledgement. */
  onCompose?: () => void;
}) {
  const { updateEmail, canInbox, addToast, users } = useApp();
  const navigate = useNavigate();

  const canReassign = canInbox('reassign');

  const reassign = (userId: string) => {
    const u = users.find((x) => x.id === userId);
    if (!u) return;
    updateEmail(email.id, { owner: u.fullName, officeId: u.officeId });
    addToast({ type: 'success', title: 'Email reassigned', message: `Assigned to ${u.fullName}.` });
  };

  const actions = contextualActions(email, navigate, onGenerateQuote);

  // The related business action stays locked while the panel above still has a
  // line in Error, a line that Needs Review, or a required field the enquiry
  // never stated — a missing required field is what puts a line in Needs Review
  // to begin with. Confirming the last line unlocks the action on the spot;
  // there is no separate "Confirm Extraction" step. Mail with no line-level
  // reading (every classification whose own workspace owns the right panel) is
  // never gated here.
  const pendingLines = extraction ? extraction.needsReview + extraction.errors : 0;
  const extractionLocked = pendingLines > 0;

  const classified = email.classification !== 'unclassified';
  const composeLabel = email.classification === 'inquiry' ? 'Send Acknowledgement' : 'Reply to Sender';

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none border-b border-surface-100 px-3.5 py-2">
        <h2 className="text-[14px] font-semibold text-surface-800">Business Action</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2.5">
        {!classified ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800">
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
                title={extractionLocked ? LOCK_MESSAGE : undefined}
              >
                {a.label}
              </Button>
            ))}
            {extractionLocked && actions.length > 0 && (
              <p className="flex items-start gap-1.5 pt-0.5 text-[11px] text-amber-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
                {LOCK_MESSAGE}
              </p>
            )}

            {/* Replying is always available — it is a courtesy, not a workflow step. */}
            {onCompose && (
              <Button
                variant={actions.length ? 'secondary' : 'primary'}
                size="sm"
                className="w-full justify-start"
                leftIcon={<Reply className="h-4 w-4" />}
                onClick={onCompose}
              >
                {composeLabel}
              </Button>
            )}
          </div>
        )}

        {/* Reassign */}
        {canReassign && (
          <div className="mt-3">
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
  navigate: (to: string) => void,
  onGenerateQuote?: () => void
): { label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean }[] {
  // A mail WE sent is a record of what went out, not work waiting to be picked
  // up: a sent revised quotation has already left Quotes Needing Revision, so
  // inviting the reader to "start revision" from it points at an empty queue.
  if (email.sent) return [];

  switch (email.classification) {
    case 'inquiry':
      // Quoting happens OVER the conversation, not on another page: sending the
      // user to Quotes Pending loses the thread, the company mail and the
      // extraction they just confirmed.
      return onGenerateQuote
        ? [{ label: 'Generate Quote', icon: <FileText className="h-4 w-4" />, onClick: onGenerateQuote, primary: true }]
        : [];
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
    // finance_other's only action was a reply, which is now the compose entry
    // shared by every classification.
    default:
      return [];
  }
}
