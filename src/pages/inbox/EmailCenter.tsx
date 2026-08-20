import { useEffect, useState } from 'react';
import {
  Building2,
  UserRound,
  CheckCircle2,
  Pencil,
  Tags,
  ChevronDown,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react';
import type { EmailClassification, ExtractionField, InboxEmail } from '@/types';
import { StatusBadge, Button } from '@/components/ui';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import { officeName } from '@/data/offices';
import { classNames, formatDateTime } from '@/lib/format';
import { useApp } from '@/context/AppContext';
import { affectedFields, extractionState, unresolvedMandatory } from './helpers';

// A field needs attention when it is missing, a required field is empty, or the
// AI was uncertain (low confidence). Everything else renders neutrally — we no
// longer surface positive "High / Medium" confidence labels.
type FieldProblem = 'missing' | 'uncertain' | null;
function fieldProblem(f: ExtractionField): FieldProblem {
  if (f.confidence === 'missing' || (f.required && !f.value.trim())) return 'missing';
  if (f.confidence === 'low') return 'uncertain';
  return null;
}

const PROBLEM_STYLE: Record<'missing' | 'uncertain', { ring: string; tag: string; label: string }> = {
  missing: { ring: 'border-rose-300 bg-rose-50/60', tag: 'text-rose-600', label: 'Missing' },
  uncertain: { ring: 'border-amber-300 bg-amber-50/60', tag: 'text-amber-600', label: 'Check' },
};

export function EmailCenter({
  email,
  embedded,
  compact,
}: {
  email: InboxEmail;
  embedded?: boolean;
  // `compact` = the editable extracted fields live in the right-hand business
  // workspace (quote / PO / SO), so the centre shows ONLY the status row and
  // never duplicates the field cards.
  compact?: boolean;
}) {
  const { updateEmail, canInbox, addToast } = useApp();
  const cls = INBOX_CLASSIFICATION[email.classification];
  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  // Extraction detail disclosure. `open` = the field list is expanded; `editing`
  // = fields are editable inputs; `showAll` = reveal non-affected fields too.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Reset the disclosure whenever the selected email changes.
  useEffect(() => {
    setOpen(false);
    setEditing(false);
    setShowAll(false);
  }, [email.id]);

  const canEditExtraction = canInbox('edit_extraction');
  const canClassify = canInbox('classify');

  const state = extractionState(email);
  const affected = affectedFields(email);
  const unresolved = unresolvedMandatory(email);

  const setField = (idx: number, value: string) => {
    const extraction = email.extraction.map((f, i) => (i === idx ? { ...f, value, edited: true } : f));
    // Editing confirmed information sends the extraction back to "needs
    // confirmation" — a human must re-confirm the corrected data.
    const patch: Partial<InboxEmail> = { extraction };
    if (email.extractionConfirmed) {
      patch.extractionConfirmed = false;
      patch.needsReview = true;
    }
    updateEmail(email.id, patch);
  };

  const confirmExtraction = () => {
    const stillMissing = email.extraction.some((f) => f.required && !f.value.trim());
    if (stillMissing) {
      addToast({ type: 'warning', title: 'Cannot confirm', message: 'Fill all required fields marked Missing first.' });
      return;
    }
    updateEmail(email.id, { extractionConfirmed: true, needsReview: false });
    setEditing(false);
    setOpen(false);
    setShowAll(false);
    addToast({ type: 'success', title: 'Extraction confirmed', message: 'AI-extracted fields marked as reviewed.' });
  };

  const reclassify = (c: EmailClassification) => {
    updateEmail(email.id, { classification: c });
    setReclassifyOpen(false);
    addToast({ type: 'success', title: 'Email reclassified', message: `Classification set to ${INBOX_CLASSIFICATION[c].label}.` });
  };

  // Which fields to show once expanded. In needs-review we surface only the
  // affected fields by default (with a toggle for the rest); a confirmed
  // "View details" shows everything.
  const showingAffectedOnly = state === 'needs_review' && !showAll && affected.length > 0;
  const visibleFields = showingAffectedOnly ? affected : email.extraction;
  const hiddenCount = email.extraction.length - affected.length;
  // Fields are editable when actively reviewing (needs-review) or the user chose
  // to edit a confirmed extraction.
  const fieldsEditable = canEditExtraction && (state === 'needs_review' || editing);

  return (
    // `embedded` renders the reader as flowing content (no own height / scroll)
    // so the centre panel can stack the email above the reply composer inside a
    // single shared scroll area. Standalone (dedicated workflows) keeps h-full.
    <div className={embedded ? '' : 'flex h-full flex-col'}>
      {/* Header */}
      <div className={classNames('border-b border-surface-100 px-5 py-4', !embedded && 'flex-none')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-[15px] font-semibold leading-snug text-surface-900">{email.subject}</h2>
          <div className="flex items-center gap-2">
            <StatusBadge tone={cls.tone} label={cls.label} />
            {canClassify && (
              <div className="relative">
                <Button variant="secondary" size="sm" leftIcon={<Tags className="h-3.5 w-3.5" />} rightIcon={<ChevronDown className="h-3.5 w-3.5" />} onClick={() => setReclassifyOpen((v) => !v)}>
                  Reclassify
                </Button>
                {reclassifyOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-surface-200 bg-white p-1.5 shadow-pop">
                    {(Object.keys(INBOX_CLASSIFICATION) as EmailClassification[]).map((c) => (
                      <button
                        key={c}
                        onClick={() => reclassify(c)}
                        className={classNames(
                          'flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[13px] hover:bg-surface-50',
                          c === email.classification ? 'font-medium text-brand-700' : 'text-surface-700'
                        )}
                      >
                        {INBOX_CLASSIFICATION[c].label}
                        {c === email.classification && <CheckCircle2 className="h-4 w-4 text-brand-600" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
          <p><span className="text-surface-400">From:</span> <span className="font-medium text-surface-700">{email.senderName}</span> &lt;{email.senderEmail}&gt;</p>
          <p><span className="text-surface-400">To:</span> <span className="text-surface-700">{email.recipient}</span></p>
          {email.cc.length > 0 && <p><span className="text-surface-400">Cc:</span> <span className="text-surface-700">{email.cc.join(', ')}</span></p>}
          <p><span className="text-surface-400">Received:</span> <span className="text-surface-700">{formatDateTime(email.receivedAt)}</span></p>
        </div>
      </div>

      {/* Body (scrolls with the composer below it when embedded) */}
      <div className={classNames('px-5 py-4', !embedded && 'flex-1 overflow-y-auto')}>
        {/* Body */}
        <div className="whitespace-pre-wrap text-[13px] leading-[1.5] text-surface-700">{email.body}</div>

        {/* Related details — one compact row combining office/owner/customer and
            the linked document references, instead of many large separate chips. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-surface-200 bg-surface-50/60 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">Related</span>
          <span className="inline-flex items-center gap-1 text-[12px] text-surface-600">
            <Building2 className="h-3 w-3 text-surface-400" /> {officeName(email.officeId)}
          </span>
          <span className="text-surface-300">·</span>
          <span className="inline-flex items-center gap-1 text-[12px] text-surface-600">
            <UserRound className="h-3 w-3 text-surface-400" /> {email.owner}
          </span>
          {email.customerName && (
            <>
              <span className="text-surface-300">·</span>
              <span className="text-[12px] font-medium text-surface-700">{email.customerName}{email.customerCode ? ` · ${email.customerCode}` : ''}</span>
            </>
          )}
          {email.inquiryNo && <span className="chip !py-0 !text-[11px] !text-amber-700 !bg-amber-50 !border-amber-200">Inquiry: {email.inquiryNo}</span>}
          {email.linkedQuotation && <span className="chip !py-0 !text-[11px] !text-brand-700 !bg-brand-50 !border-brand-200">Quote: {email.linkedQuotation}</span>}
          {email.linkedPO && <span className="chip !py-0 !text-[11px] !text-violet-700 !bg-violet-50 !border-violet-200">PO: {email.linkedPO}</span>}
          {email.linkedSO && <span className="chip !py-0 !text-[11px] !text-teal-700 !bg-teal-50 !border-teal-200">SO: {email.linkedSO}</span>}
        </div>

        {/* Thread */}
        {email.thread.length > 0 && (
          <div className="mt-4 rounded-xl border border-surface-200">
            <p className="flex items-center gap-1.5 border-b border-surface-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-surface-400">
              <MessageSquare className="h-3.5 w-3.5" /> Previous conversation ({email.thread.length})
            </p>
            <ul className="divide-y divide-surface-100">
              {email.thread.map((m) => (
                <li key={m.id} className="px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-surface-700">{m.from}</span>
                    <span className="text-[11px] text-surface-400">{formatDateTime(m.date)}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-surface-500">{m.snippet}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI Extraction — three states. State C (hidden) renders nothing. */}
        {state !== 'hidden' && (
          <div className="mt-5">
            {/* Compact status row (~48px) — the default resting state for A & B. */}
            <div
              className={classNames(
                'flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3.5 py-2',
                state === 'confirmed' ? 'border-emerald-200 bg-emerald-50/70' : 'border-amber-200 bg-amber-50/70'
              )}
            >
              {state === 'confirmed' ? (
                <CheckCircle2 className="h-4 w-4 flex-none text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 flex-none text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className={classNames('text-[13px] font-semibold', state === 'confirmed' ? 'text-emerald-800' : 'text-amber-800')}>
                  {state === 'confirmed' ? 'Extraction confirmed' : 'Extraction needs review'}
                </p>
                <p className={classNames('text-[12px]', state === 'confirmed' ? 'text-emerald-700/80' : 'text-amber-700/90')}>
                  {state === 'confirmed'
                    ? 'All required business details verified.'
                    : affected.length > 0
                    ? `${affected.length} field${affected.length === 1 ? '' : 's'} need attention before you can continue.`
                    : 'Review the extracted details and confirm to continue.'}
                </p>
              </div>

              {/* Compact mode (workflow): status only — editing lives in the right
                  workspace, so no expansion / duplicate cards here. */}
              {!compact && (
                state === 'confirmed' ? (
                  <button
                    onClick={() => setOpen((v) => !v)}
                    className="inline-flex flex-none items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100/70"
                  >
                    {open ? 'Hide details' : 'View details'}
                    <ChevronDown className={classNames('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
                  </button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-none"
                    onClick={() => { setOpen(true); setEditing(true); }}
                  >
                    Review &amp; Confirm
                  </Button>
                )
              )}
            </div>

            {/* Expanded field detail — only in non-compact centre panels. */}
            {!compact && open && (
              <div className="mt-2 rounded-xl border border-surface-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-100 px-3 py-2">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wide text-surface-500">
                    {showingAffectedOnly ? 'Fields needing attention' : 'Extracted details'}
                  </h3>
                  {state === 'confirmed' && canEditExtraction && !editing && (
                    <Button variant="secondary" size="sm" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(true)}>
                      Edit extracted details
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
                  {visibleFields.map((f) => {
                    const realIdx = email.extraction.indexOf(f);
                    const problem = fieldProblem(f);
                    const pstyle = problem ? PROBLEM_STYLE[problem] : null;
                    return (
                      <div key={f.key} className={classNames('rounded-lg border px-3 py-2', pstyle?.ring ?? 'border-surface-200')}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium uppercase tracking-wide text-surface-400">
                            {f.label}{f.required && <span className="text-rose-500"> *</span>}
                          </span>
                          {pstyle && <span className={classNames('text-[11px] font-semibold', pstyle.tag)}>{pstyle.label}</span>}
                        </div>
                        {fieldsEditable ? (
                          <input
                            value={f.value}
                            onChange={(e) => setField(realIdx, e.target.value)}
                            placeholder={problem === 'missing' ? 'Enter value…' : ''}
                            className="input py-1 text-[13px]"
                          />
                        ) : (
                          <p className={classNames('text-[13px]', f.value ? 'text-surface-800' : 'italic text-rose-500')}>
                            {f.value || 'Not provided'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Toggle to reveal / hide the non-affected fields in needs-review. */}
                {state === 'needs_review' && affected.length > 0 && hiddenCount > 0 && (
                  <div className="px-3 pb-2">
                    <button
                      onClick={() => setShowAll((v) => !v)}
                      className="text-[12px] font-medium text-brand-600 hover:underline"
                    >
                      {showAll ? 'Show only fields needing attention' : `Show all ${email.extraction.length} extracted fields`}
                    </button>
                  </div>
                )}

                {/* Confirm action — only while reviewing (never in State A). */}
                {state === 'needs_review' && canEditExtraction && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-100 bg-surface-50/60 px-3 py-2.5">
                    <p className={classNames('text-[11px]', unresolved.length > 0 ? 'text-amber-700' : 'text-surface-500')}>
                      {unresolved.length > 0
                        ? `Resolve required field(s): ${unresolved.join(', ')}`
                        : 'Confirm to unlock the related business action.'}
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                      onClick={confirmExtraction}
                      disabled={unresolved.length > 0}
                    >
                      Confirm Extraction
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
