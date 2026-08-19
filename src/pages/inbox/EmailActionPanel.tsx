import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  RefreshCw,
  ClipboardCheck,
  FileSpreadsheet,
  Reply,
  UserCog,
  Send,
  Eye,
  Save,
  Paperclip,
  X,
  Plus,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  ArrowLeft,
  CheckCircle2,
  Ban,
} from 'lucide-react';
import type { EmailAttachment, InboxEmail, OutgoingDraft } from '@/types';
import {
  Button,
  TextField,
  TextAreaField,
  Modal,
  StatusBadge,
  SelectField,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import { officeName } from '@/data/offices';
import { classNames, formatINR } from '@/lib/format';
import { sendBlockers, isValidEmail } from './helpers';
import { RevisionQuotePanel } from './RevisionQuotePanel';
import { PoVerificationPanel } from './PoVerificationPanel';

const TODAY_TS = '2026-08-13T12:30:00';

function templateFor(email: InboxEmail): OutgoingDraft {
  const greeting = `Dear ${email.senderName.split(' ')[0] || 'Sir/Madam'},`;
  return {
    from: email.recipient,
    to: email.senderEmail,
    cc: email.cc.join(', '),
    subject: `RE: ${email.subject}`,
    body: `${greeting}\n\nThank you for your email. We acknowledge receipt and will revert shortly.\n\nWarm regards,\n${email.owner}\nNexus RFQ — ${officeName(email.officeId)}`,
    attachments: [],
    relatedDoc: email.linkedQuotation ?? email.linkedPO ?? email.linkedSO ?? '',
    aiGenerated: true,
  };
}

let attSeq = 0;

export function EmailActionPanel({ email }: { email: InboxEmail }) {
  const { updateEmail, canInbox, addToast, quotations, salesOrders, updateQuotation, updateSalesOrder, users, currentUser, role } = useApp();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<OutgoingDraft>(email.draft ?? templateFor(email));
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    setDraft(email.draft ?? templateFor(email));
    setPreview(false);
  }, [email.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const canDraft = canInbox('draft_reply');
  const canSend = canInbox('send');
  const canApprove = canInbox('approve');
  const canReassign = canInbox('reassign');

  // Approve & Send needs BOTH approve and send permission (role-enforced, not just cosmetic).
  const permissionOk = canSend && canApprove;
  const permissionMessage =
    role === 'sales_user'
      ? 'Approval required from Office Admin or Super Admin.'
      : 'You do not have permission to approve & send this email.';

  // Build the working email (with the in-progress draft) for validation
  const workingEmail: InboxEmail = { ...email, draft };
  const validationBlockers = useMemo(() => sendBlockers(workingEmail), [workingEmail]);
  const blockers = permissionOk ? validationBlockers : [...validationBlockers, permissionMessage];
  const canFinalSend = blockers.length === 0;
  // One clear, concise reason to show next to the disabled button.
  const blockReason = !permissionOk
    ? permissionMessage
    : validationBlockers.length > 0
    ? 'Complete classification and confirm the extracted details before sending.'
    : '';

  const setD = <K extends keyof OutgoingDraft>(k: K, v: OutgoingDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const saveDraft = () => {
    updateEmail(email.id, { draft, draftSaved: true });
    addToast({ type: 'success', title: 'Draft saved', message: `Reply to ${email.senderName} saved as draft.` });
  };

  const addAttachment = (name = `Attachment-${++attSeq}.pdf`, type = 'PDF') => {
    const att: EmailAttachment = { id: `att-${Date.now()}-${attSeq}`, name, size: '128 KB', type };
    setDraft((d) => ({ ...d, attachments: [...d.attachments, att] }));
  };
  const removeAttachment = (id: string) => setDraft((d) => ({ ...d, attachments: d.attachments.filter((a) => a.id !== id) }));

  const approveAndSend = () => {
    if (!canFinalSend) return;
    updateEmail(email.id, { draft, draftSaved: true, sent: true, sentAt: TODAY_TS, needsReview: false });

    const activity = {
      id: `act-${Date.now()}`,
      date: TODAY_TS,
      actor: currentUser.fullName,
      action: 'Email sent to customer',
      detail: `${draft.subject} → ${draft.to}`,
    };

    // Outbound quotation send: set delivery state to Sent and drop it from the pending queue.
    if (email.quotationSendId) {
      const q = quotations.find((x) => x.id === email.quotationSendId);
      if (q) {
        updateQuotation(q.id, {
          deliveryState: 'sent',
          workState: 'sent',
          sentAt: TODAY_TS,
          sentBy: currentUser.fullName,
          sendChannel: 'Email (via Global Inbox)',
          sendFailureReason: undefined,
          lastUpdated: '2026-08-13',
          activity: [
            ...q.activity,
            { ...activity, action: 'Quotation emailed to customer', detail: `${draft.subject} → ${draft.to} · approved by ${currentUser.fullName}` },
          ],
        });
      }
    } else if (email.linkedQuotation) {
      const q = quotations.find((x) => x.number === email.linkedQuotation);
      if (q) updateQuotation(q.id, { activity: [...q.activity, activity], lastUpdated: '2026-08-13' });
    }
    if (email.linkedSO) {
      const so = salesOrders.find((x) => x.number === email.linkedSO);
      if (so) updateSalesOrder(so.id, { internalNotes: [...so.internalNotes, { id: activity.id, date: TODAY_TS, author: currentUser.fullName, text: `Email sent: ${draft.subject}` }] });
    }
    setPreview(false);
    addToast({ type: 'success', title: 'Email sent & approved', message: `Sent to ${draft.to}. Added to Sent and the record timeline.` });
  };

  const reassign = (userId: string) => {
    const u = users.find((x) => x.id === userId);
    if (!u) return;
    updateEmail(email.id, { owner: u.fullName, officeId: u.officeId });
    addToast({ type: 'success', title: 'Email reassigned', message: `Assigned to ${u.fullName}.` });
  };

  // ---- Contextual action config ----
  const actions = contextualActions(email, navigate);

  const readOnly = email.sent || !canDraft;

  // Quotes Needing Revision → Open lands here: render the dedicated Quote
  // Generator (queue label, changes requested, editable revised quote, send)
  // instead of the generic reply composer.
  if (email.revisionSendId) {
    return <RevisionQuotePanel email={email} />;
  }

  // PO vs Quote Verification → Open lands here: render the two-step verification
  // workflow (comparison + resolution, then gated SO generation) instead of the
  // generic composer.
  if (email.poVerifyId) {
    return <PoVerificationPanel email={email} />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Contextual business action */}
      <div className="flex-none border-b border-surface-100 px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Business Action</p>
        {email.classification === 'unclassified' ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
            <span>This email is <span className="font-semibold">Unclassified</span>. Classify it (use “Reclassify” in the centre panel) before any business action or reply can proceed.</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            {actions.map((a) => (
              <Button key={a.label} variant={a.primary ? 'primary' : 'secondary'} size="sm" className="w-full justify-start" leftIcon={a.icon} onClick={a.onClick}>
                {a.label}
              </Button>
            ))}
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

      {/* Outgoing composer */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">Outgoing Email</p>
          {draft.aiGenerated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
              <Sparkles className="h-2.5 w-2.5" /> AI-drafted
            </span>
          )}
        </div>

        {email.sent && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Sent on {email.sentAt?.slice(0, 10)} — read-only.
          </div>
        )}

        <div className="space-y-2.5">
          <TextField label="From" value={draft.from} disabled onChange={() => {}} className="py-1.5 text-[13px]" />
          <TextField label="To" required value={draft.to} onChange={(e) => setD('to', e.target.value)} disabled={readOnly} error={!isValidEmail(draft.to) ? 'Valid recipient required' : undefined} className="py-1.5 text-[13px]" />
          <TextField label="Cc" value={draft.cc} onChange={(e) => setD('cc', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" />
          <TextField label="Subject" required value={draft.subject} onChange={(e) => setD('subject', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" />
          <TextAreaField label="Body" required rows={8} value={draft.body} onChange={(e) => setD('body', e.target.value)} disabled={readOnly} className="text-[13px]" />

          <div className="grid grid-cols-2 gap-2">
            <TextField label="Related Document" value={draft.relatedDoc ?? ''} onChange={(e) => setD('relatedDoc', e.target.value)} disabled={readOnly} className="py-1.5 text-[13px]" placeholder="QTN / PO / SO no." />
            <TextField label="Amount (₹)" type="number" value={draft.amount ?? ''} onChange={(e) => setD('amount', e.target.value ? Number(e.target.value) : undefined)} disabled={readOnly} className="py-1.5 text-[13px]" />
          </div>

          {/* Attachments */}
          <div>
            <label className="mb-1 flex items-center justify-between text-[13px] font-medium text-surface-700">
              <span className="flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Attachments {email.requiredAttachment && <span className="text-rose-500">*</span>}</span>
              {!readOnly && (
                <button onClick={() => addAttachment()} className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-600 hover:underline">
                  <Plus className="h-3 w-3" /> Attach
                </button>
              )}
            </label>
            {draft.attachments.length === 0 ? (
              <p className={classNames('rounded-lg border border-dashed px-3 py-2 text-[12px]', email.requiredAttachment ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-surface-200 text-surface-400')}>
                {email.requiredAttachment ? 'A quotation attachment is required before sending.' : 'No attachments.'}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {draft.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-lg border border-surface-200 px-3 py-1.5">
                    <FileText className="h-4 w-4 text-brand-500" />
                    <span className="flex-1 truncate text-[12px] text-surface-700">{a.name}</span>
                    <span className="text-[11px] text-surface-400">{a.type}</span>
                    {!readOnly && <button onClick={() => removeAttachment(a.id)} aria-label={`Remove ${a.name}`} className="rounded p-0.5 text-surface-400 hover:text-rose-500"><X className="h-3.5 w-3.5" /></button>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Blockers */}
          {!email.sent && blockers.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-amber-800"><ShieldCheck className="h-3.5 w-3.5" /> Send is blocked:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[11px] text-amber-700">
                {blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      {!email.sent && (
        <div className="flex-none border-t border-surface-100 bg-surface-50/60 px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft} disabled={!canDraft}>Save Draft</Button>
            <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)} disabled={!canDraft}>Preview</Button>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="mt-2 w-full"
            leftIcon={canFinalSend ? <Send className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
            onClick={() => setPreview(true)}
            disabled={!canFinalSend}
            title={blockReason || 'Open final review and send'}
          >
            Approve &amp; Send
          </Button>
          {!canFinalSend && blockReason && (
            <p className={classNames('mt-1.5 text-center text-[11px]', !permissionOk ? 'font-medium text-rose-600' : 'text-amber-600')}>
              {blockReason}
            </p>
          )}
        </div>
      )}

      {/* Preview modal — final human review before send */}
      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        size="xl"
        title="Final Review — Approve & Send"
        subtitle="AI drafted this email. Review everything before it leaves the platform."
        footer={
          <>
            <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => setPreview(false)}>Back to Edit</Button>
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={approveAndSend} disabled={!canFinalSend}>Approve &amp; Send</Button>
          </>
        }
      >
        <div className="space-y-4">
          {draft.aiGenerated && (
            <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
              <Sparkles className="h-4 w-4" /> This email contains AI-generated content. A human must approve before it is sent.
            </div>
          )}

          <div className="rounded-xl border border-surface-200">
            <div className="space-y-1 border-b border-surface-100 px-4 py-3 text-[13px]">
              <p><span className="text-surface-400">From:</span> <span className="text-surface-700">{draft.from}</span></p>
              <p><span className="text-surface-400">To:</span> <span className="font-medium text-surface-800">{draft.to || '—'}</span></p>
              {draft.cc && <p><span className="text-surface-400">Cc:</span> <span className="text-surface-700">{draft.cc}</span></p>}
              <p><span className="text-surface-400">Subject:</span> <span className="font-medium text-surface-800">{draft.subject || '—'}</span></p>
            </div>
            <div className="whitespace-pre-wrap px-4 py-3 text-[13px] leading-relaxed text-surface-700">{draft.body || '—'}</div>
            {draft.attachments.length > 0 && (
              <div className="border-t border-surface-100 px-4 py-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">Attachments</p>
                <ul className="flex flex-wrap gap-2">
                  {draft.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-2.5 py-1 text-[12px] text-surface-700">
                      <FileText className="h-3.5 w-3.5 text-brand-500" /> {a.name} <span className="text-surface-400">({a.type})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-xl border border-surface-200 px-4 py-3 text-[13px] sm:grid-cols-2">
            {email.customerName && <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{email.customerName}</span></p>}
            <p><span className="text-surface-400">Classification:</span> <StatusBadge tone={INBOX_CLASSIFICATION[email.classification].tone} label={INBOX_CLASSIFICATION[email.classification].label} dot={false} /></p>
            {draft.relatedDoc && <p><span className="text-surface-400">Related document:</span> <span className="font-medium text-surface-800">{draft.relatedDoc}</span></p>}
            {typeof draft.amount === 'number' && <p><span className="text-surface-400">Amount:</span> <span className="font-medium text-surface-800">{formatINR(draft.amount)}</span></p>}
          </div>

          {blockers.length > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-rose-700"><AlertTriangle className="h-4 w-4" /> Unresolved warnings — cannot send</p>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12px] text-rose-600">
                {blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-700">
              <ShieldCheck className="h-4 w-4" /> All checks passed. This email is ready for approval and sending.
            </div>
          )}
        </div>
      </Modal>
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
