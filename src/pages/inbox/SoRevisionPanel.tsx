import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  CircleSlash,
  FilePenLine,
  FileSpreadsheet,
  FileWarning,
  History,
  Mail,
  Paperclip,
} from 'lucide-react';
import type { InboxEmail, Quotation, SalesOrder, VerificationField } from '@/types';
import { Button, Modal, StatusBadge, TextAreaField } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { officeName } from '@/data/offices';
import { classNames, formatDate, formatDateTime } from '@/lib/format';
import { revisionReceivedAtOf, slaDueAt } from '@/lib/sla';
import { REVISION_STATE } from '@/lib/labels';
import { inboxUrl } from '@/lib/inboxContext';
import { SoRevisionModal } from './SoRevisionModal';

// Prototype "today" — kept consistent with the rest of the app's seeded data.
const TODAY_ISO = '2026-08-13';

/**
 * RIGHT panel for a "Sales Order Revision" conversation.
 *
 * This is the decision surface, not the editor: what the customer asked for,
 * against which confirmed Sales Order, and the three ways the request can be
 * resolved —
 *   1. Revise Sales Order — opens the full-width revised-SO editor.
 *   2. No Revision Required — closes the request, SO untouched.
 *   3. Quote Revision Required — escalates to the linked quotation revision.
 * The revised order itself is edited in {@link SoRevisionModal} and sent from
 * the Gmail-style compose popup; nothing is sent from here.
 */
export function SoRevisionPanel({
  email,
  salesOrder,
  onCompose,
}: {
  email: InboxEmail;
  salesOrder: SalesOrder;
  onCompose?: () => void;
}) {
  const {
    parties,
    quotations,
    emails,
    updateSalesOrder,
    updateQuotation,
    updateEmail,
    addEmail,
    addToast,
    currentUser,
    can,
  } = useApp();
  const navigate = useNavigate();

  const so = salesOrder;
  const canRevise = can('sales_orders', 'edit');
  const party = parties.find((p) => p.id === so.partyId);

  // The revised-SO editor — a large scrollable modal, opened on demand.
  const [editing, setEditing] = useState(false);
  // "No Revision Required" — optional resolution note captured in a small modal.
  const [noRevOpen, setNoRevOpen] = useState(false);
  const [noRevNote, setNoRevNote] = useState('');
  // "Quote Revision Required" — confirm escalation to a quotation revision.
  const [escalateOpen, setEscalateOpen] = useState(false);

  const nextRevNum = so.revisionNumber + 1;

  // ---- Action 2: No Revision Required ---------------------------------------
  // Close the revision request WITHOUT touching the SO. The SO record and its
  // versions are left exactly as-is; only the revision request is resolved and
  // dropped from the active queue (clearing revisionState removes it from
  // /sales-orders/revisions). An optional resolution note is recorded for audit.
  const resolveNoRevision = () => {
    const note = noRevNote.trim();
    const at = `${TODAY_ISO}T13:05:00`;
    updateSalesOrder(so.id, {
      revisionState: undefined,
      revisionDraft: undefined,
      revisionNotes: undefined,
      revisionResolution: { kind: 'no_revision', note: note || undefined, by: currentUser.fullName, at },
      // The SO was already acknowledged before the query; leave it settled.
      status: so.status === 'revision_required' ? 'so_sent' : so.status,
      activity: [
        ...so.activity,
        {
          id: `act-${so.id}-norev-${Date.now()}`,
          date: at,
          actor: currentUser.fullName,
          action: 'Revision request resolved — No Revision Required',
          detail: note || 'No changes needed; original Sales Order stands.',
        },
      ],
    });
    updateEmail(email.id, { needsReview: false, queueLabel: 'Revision resolved' });
    setNoRevOpen(false);
    setNoRevNote('');
    addToast({
      type: 'success',
      title: 'Marked as No Revision Required',
      message: `${so.number} left unchanged and removed from the revision queue.`,
    });
  };

  // ---- Action 3: Quote Revision Required (major / price change) --------------
  // Escalate to a quotation revision. The linked quote is flagged for revision,
  // its Global Inbox thread is opened, the PO is marked stale (awaiting an
  // updated PO) and SO generation is re-gated behind a fresh PO-vs-Quote match.
  const linkedQuote = quotations.find((q) => q.id === so.quotationId) ?? null;
  const buildQuoteRevisionEmail = (q: Quotation, id: string): InboxEmail => {
    const to = party?.email ?? so.customerEmail ?? 'procurement@customer.com';
    const city = officeName(q.officeId).split(' ')[0].toLowerCase();
    const from = `sales.${city}@flowtech-instruments.com`;
    const changes = email.requestedChanges ?? [];
    const changeLines = changes.length
      ? changes.map((c) => `• ${c.label}: ${c.oldValue} → ${c.newValue}`).join('\n')
      : `• ${so.revisionReason ?? 'Commercial change requested against the confirmed order.'}`;
    const contact = party?.contactPerson ?? so.customerName.split(' ')[0] ?? 'Procurement';
    return {
      id,
      senderName: contact,
      senderEmail: to,
      recipient: from,
      cc: [],
      subject: `RE: Quotation ${q.number} — revision required (SO ${so.number})`,
      receivedAt: `${TODAY_ISO}T13:00:00`,
      body:
        `Dear ${q.owner.split(' ')[0]},\n\n` +
        `Following our confirmed order ${so.number} (PO ${so.poNumber}), the following change to quotation ${q.number} is required before we can proceed:\n\n` +
        `${changeLines}\n\n` +
        `Please share a revised quotation reflecting the above; we will issue an updated PO against it.\n\nRegards,\n${contact}\n${so.customerName}`,
      thread: [
        { id: `th-${q.id}-so-${so.id}`, from: q.owner, date: `${q.quoteDate}T16:45:00`, snippet: `Original quotation ${q.number} shared for review…` },
      ],
      classification: 'quotation_revision',
      aiConfidence: 90,
      read: true,
      needsReview: true,
      officeId: q.officeId,
      owner: q.owner,
      partyId: q.partyId,
      customerName: q.customerName,
      customerCode: q.customerCode,
      linkedQuotation: q.number,
      revisionSendId: q.id,
      inquiryId: q.id,
      queueLabel: 'Quote Needs Revision',
      requestedChanges: email.requestedChanges,
      reviewDate: q.reviewDate,
      extraction: [
        { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
        { key: 'quotation', label: 'Quotation Number', value: q.number, confidence: 'high', required: true },
        { key: 'linkedSo', label: 'Raised from SO', value: so.number, confidence: 'high', required: true },
      ],
      extractionConfirmed: true,
      draftSaved: false,
      sent: false,
    };
  };

  const escalateToQuoteRevision = () => {
    if (!linkedQuote) {
      addToast({ type: 'error', title: 'No linked quotation', message: 'This Sales Order has no linked quotation to revise.' });
      setEscalateOpen(false);
      return;
    }
    const q = linkedQuote;
    const at = `${TODAY_ISO}T13:05:00`;

    // 1. Flag the quotation for revision (drives /quotations/revisions).
    updateQuotation(q.id, { workState: 'needs_revision' });

    // 2. Re-gate SO generation: the confirmed PO is now stale and must be
    //    re-issued against the revised quote. Reset every verification field to
    //    "updated PO awaited" so allResolved() is false and the record reads
    //    Mismatch Found until a fresh PO-vs-Quote match is achieved.
    const resetFields: VerificationField[] = (so.verificationFields ?? []).map((f) => ({
      ...f,
      resolution: 'awaiting_po' as const,
    }));
    updateSalesOrder(so.id, {
      revisionState: undefined,
      revisionDraft: undefined,
      revisionResolution: { kind: 'quote_revision', note: so.revisionReason, by: currentUser.fullName, at },
      soGenerated: false,
      verificationStatus: 'mismatch',
      verificationFields: resetFields.length ? resetFields : so.verificationFields,
      status: so.status === 'revision_required' ? so.status : 'revision_required',
      activity: [
        ...so.activity,
        {
          id: `act-${so.id}-esc-${Date.now()}`,
          date: at,
          actor: currentUser.fullName,
          action: 'Escalated to Quote Revision',
          detail: `Quotation ${q.number} flagged for revision; updated PO awaited before SO generation.`,
        },
      ],
    });

    // 3. Resolve the SO-revision request email (it has been escalated).
    updateEmail(email.id, { needsReview: false, queueLabel: 'Escalated to quote revision' });

    // 4. Open the linked quotation's revision thread in the Global Inbox.
    const existing = emails.find(
      (e) => e.revisionSendId === q.id && !e.sent && (!e.partyId || e.partyId === q.partyId)
    );
    const targetId = existing?.id ?? `em-rev-${q.id}`;
    if (!existing && !emails.some((e) => e.id === targetId)) {
      addEmail(buildQuoteRevisionEmail(q, targetId));
    }
    setEscalateOpen(false);
    addToast({
      type: 'info',
      title: 'Quote revision required',
      message: `Opened quotation ${q.number}. Send the revised quote, then await the updated PO.`,
    });
    // One context object, every id taken from THIS quotation record.
    navigate(inboxUrl({ emailId: targetId, customerId: q.partyId, inquiryId: q.id, mode: 'quote-revision', qtn: q.id }));
  };

  const attachedRev = email.attachedSalesOrder?.soNumber === so.number && email.composeIntent === 'so-revise';
  const stateMeta = so.revisionState ? REVISION_STATE[so.revisionState] : null;
  const resolution = so.revisionResolution;
  const open = !resolution;

  return (
    <div className="flex h-full flex-col">
      {/* Compact one-line context banner */}
      <div className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-[12px] text-brand-700">
        <FilePenLine className="h-3.5 w-3.5 flex-none" />
        <span className="truncate">
          {resolution?.kind === 'no_revision' ? (
            <>Revision request on <span className="font-semibold">{so.number}</span> — resolved, no revision required.</>
          ) : resolution?.kind === 'quote_revision' ? (
            <>Revision request on <span className="font-semibold">{so.number}</span> — escalated to a quote revision.</>
          ) : (
            <>Revision request on <span className="font-semibold">{so.number}</span> — choose how to resolve it.</>
          )}
        </span>
      </div>

      {/* Independently-scrolling workspace body */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {/* Header meta */}
        <div className="overflow-hidden rounded-xl border border-surface-200">
          <div className="flex items-center justify-between border-b border-surface-100 bg-surface-50/70 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
              <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> {so.number}
            </span>
            {stateMeta && <StatusBadge tone={stateMeta.tone} label={stateMeta.label} dot />}
          </div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px] sm:grid-cols-2">
            <p><span className="text-surface-400">Current revision:</span> <span className="font-medium text-surface-800">Rev {so.revisionNumber}{so.revisionNumber === 0 ? ' (Original)' : ''}{open ? ` → preparing Rev ${nextRevNum}` : ''}</span></p>
            <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
            <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
            <p><span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-800">{so.revisionOwner ?? so.owner}</span></p>
            <p><span className="text-surface-400">Linked PO:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
            <p><span className="text-surface-400">Linked quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
            {(() => {
              const receivedAt = revisionReceivedAtOf(so);
              if (!receivedAt) {
                return <p><span className="text-surface-400">Requested date:</span> <span className="font-medium text-surface-800">{so.revisionRequestedDate ? formatDate(so.revisionRequestedDate, { short: true }) : '—'}</span></p>;
              }
              return (
                <>
                  <p><span className="text-surface-400">Received at:</span> <span className="font-medium text-surface-800">{formatDateTime(receivedAt)}</span></p>
                  <p><span className="text-surface-400">Due date:</span> <span className="font-medium text-surface-800">{formatDateTime(slaDueAt(receivedAt))}</span></p>
                </>
              );
            })()}
            {so.revisionReason && <p className="sm:col-span-2"><span className="text-surface-400">Reason:</span> <span className="font-medium text-surface-800">{so.revisionReason}</span></p>}
          </div>
        </div>

        {/* Requested changes — read-only here; they are applied in the editor. */}
        {(email.requestedChanges?.length ?? 0) > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
            <span className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700">
              <History className="h-3.5 w-3.5" /> Requested changes
            </span>
            <ul className="space-y-1">
              {email.requestedChanges!.map((c) => (
                <li key={c.id} className="flex items-center gap-1.5 text-[11.5px] text-surface-700">
                  <span className="font-medium text-surface-800">{c.label}:</span>
                  <span className="text-surface-400 line-through">{c.oldValue}</span>
                  <ArrowRight className="h-3 w-3 text-amber-500" />
                  <span className="font-semibold text-emerald-700">{c.newValue}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Resolved — No Revision Required */}
        {resolution?.kind === 'no_revision' && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> No revision required — request resolved
            </div>
            <p className="mt-1.5 text-[12px] text-surface-600">
              The original Sales Order stands unchanged. This request has been removed from the active revision queue.
            </p>
            {resolution.note && (
              <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-[12px] text-surface-700">
                <span className="font-medium text-surface-500">Resolution note:</span> {resolution.note}
              </p>
            )}
            <p className="mt-2 text-[11px] text-surface-400">
              Resolved by {resolution.by} · {formatDate(resolution.at, { short: true })}
            </p>
          </div>
        )}

        {/* Resolved — escalated to a quote revision */}
        {resolution?.kind === 'quote_revision' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-700">
              <FileWarning className="h-4 w-4" /> Escalated — quote revision required
            </div>
            <p className="mt-1.5 text-[12px] text-surface-600">
              Quotation {so.quotationNumber ?? '—'} is being revised. The current PO is on hold and SO generation stays
              blocked until the revised quote and a new PO are fully verified.
            </p>
            <p className="mt-2 text-[11px] text-surface-400">
              Escalated by {resolution.by} · {formatDate(resolution.at, { short: true })}
            </p>
          </div>
        )}

        {/* A revised SO is already attached to the reply — the compose window is
            where it goes out. */}
        {open && attachedRev && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-700">
              <Paperclip className="h-4 w-4 flex-none" /> Revised SO attached to the reply
            </div>
            <p className="mt-1 text-[12px] text-surface-600">
              {email.attachedSalesOrder?.fileName} · {email.attachedSalesOrder?.revisionLabel ?? `Rev ${nextRevNum}`}. Send it
              from the compose window.
            </p>
            <Button variant="primary" size="sm" className="mt-2.5 w-full" leftIcon={<Mail className="h-3.5 w-3.5" />} onClick={onCompose}>
              Open the compose window
            </Button>
          </div>
        )}

        {/* A saved but not-yet-attached draft — pick it back up where it was. */}
        {open && !attachedRev && so.revisionDraft && (
          <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold text-brand-700">
              <FilePenLine className="h-4 w-4 flex-none" /> Revision draft in progress
            </div>
            <p className="mt-1 text-[12px] text-surface-600">{so.revisionNotes ?? `A Rev ${nextRevNum} draft is saved and not yet attached to the reply.`}</p>
            <Button variant="primary" size="sm" className="mt-2.5 w-full" leftIcon={<FilePenLine className="h-3.5 w-3.5" />} onClick={() => setEditing(true)} disabled={!canRevise}>
              Continue editing the revised SO
            </Button>
          </div>
        )}

        {/* The three ways to resolve an SO revision request */}
        {open && (
          <div className="space-y-2.5">
            <p className="text-[11.5px] font-semibold uppercase tracking-[0.03em] text-surface-400">
              How do you want to resolve this request?
            </p>
            <ActionCard
              icon={<FilePenLine className="h-4 w-4" />}
              tone="brand"
              title="Revise Sales Order"
              tag="Minor revision"
              desc="Edit the existing SO in the full-width editor, apply the requested item, delivery and commercial changes, then attach the revised SO to the reply."
              cta={so.revisionDraft ? 'Open SO Editor' : 'Revise Sales Order'}
              onClick={() => setEditing(true)}
              disabled={!canRevise}
            />
            <ActionCard
              icon={<CircleSlash className="h-4 w-4" />}
              tone="emerald"
              title="No Revision Required"
              tag="Close request"
              desc="Close the request without changing the SO. The original order stays exactly as acknowledged and drops out of the revision queue."
              cta="Mark as No Revision Required"
              onClick={() => setNoRevOpen(true)}
              disabled={!canRevise}
            />
            <ActionCard
              icon={<FileWarning className="h-4 w-4" />}
              tone="amber"
              title="Quote Revision Required"
              tag="Major / price change"
              desc={linkedQuote
                ? `Escalate to a revision of quotation ${linkedQuote.number}. The current PO is marked stale; SO generation re-opens only after the updated PO re-matches the revised quote.`
                : 'No linked quotation is available to revise for this Sales Order.'}
              cta="Quote Revision Required"
              onClick={() => setEscalateOpen(true)}
              disabled={!canRevise || !linkedQuote}
            />
            {!canRevise && <p className="text-center text-[11px] font-medium text-rose-600">Sales Order edit permission required.</p>}
          </div>
        )}
      </div>

      {/* Revise Sales Order — the editor, at full width. */}
      {editing && (
        <SoRevisionModal
          email={email}
          salesOrder={so}
          onAddedToEmail={() => {
            setEditing(false);
            onCompose?.();
          }}
          onClose={() => setEditing(false)}
        />
      )}

      {/* No Revision Required — optional resolution note */}
      <Modal
        open={noRevOpen}
        onClose={() => setNoRevOpen(false)}
        size="sm"
        title="Mark as No Revision Required"
        subtitle={`${so.number} · ${so.customerName}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNoRevOpen(false)}>Cancel</Button>
            <Button variant="primary" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={resolveNoRevision}>
              Mark as Resolved
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[12.5px] text-surface-600">
            The original Sales Order will be kept <span className="font-medium text-surface-800">unchanged</span> and this
            request will be removed from the active revision queue. No revised SO is sent.
          </p>
          <TextAreaField
            label="Resolution note (optional)"
            rows={3}
            value={noRevNote}
            onChange={(e) => setNoRevNote(e.target.value)}
            placeholder="e.g. Customer confirmed on call that the confirmed order is correct as-is."
            className="text-[13px]"
          />
        </div>
      </Modal>

      {/* Quote Revision Required — confirm escalation */}
      <Modal
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        size="sm"
        title="Quote Revision Required"
        subtitle={linkedQuote ? `Quotation ${linkedQuote.number} · ${so.customerName}` : so.customerName}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEscalateOpen(false)}>Cancel</Button>
            <Button variant="primary" leftIcon={<FileWarning className="h-4 w-4" />} onClick={escalateToQuoteRevision} disabled={!linkedQuote}>
              Open Quote Revision
            </Button>
          </div>
        }
      >
        <div className="space-y-2.5 text-[12.5px] text-surface-600">
          <p>This is a major change (e.g. price). It will:</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-500" /> Flag quotation <span className="font-medium text-surface-800">{linkedQuote?.number ?? '—'}</span> for revision and open its Global Inbox thread.</li>
            <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-500" /> Put the current PO on hold — an updated PO is required.</li>
            <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-500" /> Block SO generation until PO-vs-Quote verification fully matches again.</li>
          </ul>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One of the three revision-disposition cards.
// ---------------------------------------------------------------------------
function ActionCard({
  icon,
  tone,
  title,
  tag,
  desc,
  cta,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  tone: 'brand' | 'emerald' | 'amber';
  title: string;
  tag: string;
  desc: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const toneMap = {
    brand: { chip: 'bg-brand-50 text-brand-600', tag: 'bg-brand-50 text-brand-600 ring-brand-200' },
    emerald: { chip: 'bg-emerald-50 text-emerald-600', tag: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
    amber: { chip: 'bg-amber-50 text-amber-600', tag: 'bg-amber-50 text-amber-600 ring-amber-200' },
  }[tone];
  return (
    <div className="rounded-xl border border-surface-200 px-3.5 py-3">
      <div className="mb-1 flex items-center gap-2">
        <span className={classNames('flex h-6 w-6 flex-none items-center justify-center rounded-lg', toneMap.chip)}>{icon}</span>
        <span className="text-[13px] font-semibold text-surface-800">{title}</span>
        <span className={classNames('ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset', toneMap.tag)}>{tag}</span>
      </div>
      <p className="mb-2.5 text-[12px] leading-relaxed text-surface-500">{desc}</p>
      <Button variant="secondary" size="sm" className="w-full" onClick={onClick} disabled={disabled} leftIcon={icon}>
        {cta}
      </Button>
    </div>
  );
}
