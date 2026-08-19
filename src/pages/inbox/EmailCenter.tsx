import { useState } from 'react';
import {
  Paperclip,
  Download,
  Building2,
  UserRound,
  FileText,
  Sparkles,
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
import { classNames, downloadText, formatDateTime } from '@/lib/format';
import { useApp } from '@/context/AppContext';
import { unresolvedMandatory } from './helpers';

const fieldTone: Record<ExtractionField['confidence'], { ring: string; label: string; tone: string }> = {
  high: { ring: 'border-surface-200', label: 'High', tone: 'text-emerald-600' },
  medium: { ring: 'border-amber-300 bg-amber-50/50', label: 'Medium', tone: 'text-amber-600' },
  low: { ring: 'border-rose-300 bg-rose-50/50', label: 'Low · review', tone: 'text-rose-600' },
  missing: { ring: 'border-rose-300 bg-rose-50/50', label: 'Missing', tone: 'text-rose-600' },
};

export function EmailCenter({ email }: { email: InboxEmail }) {
  const { updateEmail, canInbox, addToast } = useApp();
  const cls = INBOX_CLASSIFICATION[email.classification];
  const [editing, setEditing] = useState(false);
  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  const canEditExtraction = canInbox('edit_extraction');
  const canClassify = canInbox('classify');
  const canDownload = canInbox('download_attachment');
  const unresolved = unresolvedMandatory(email);

  const setField = (idx: number, value: string) => {
    const extraction = email.extraction.map((f, i) => (i === idx ? { ...f, value, edited: true } : f));
    updateEmail(email.id, { extraction });
  };

  const confirmExtraction = () => {
    const stillMissing = email.extraction.some((f) => f.required && f.confidence === 'missing' && !f.value.trim());
    if (stillMissing) {
      addToast({ type: 'warning', title: 'Cannot confirm', message: 'Fill all required fields marked Missing first.' });
      return;
    }
    updateEmail(email.id, { extractionConfirmed: true, needsReview: false });
    setEditing(false);
    addToast({ type: 'success', title: 'Extraction confirmed', message: 'AI-extracted fields marked as reviewed.' });
  };

  const reclassify = (c: EmailClassification) => {
    updateEmail(email.id, { classification: c });
    setReclassifyOpen(false);
    addToast({ type: 'success', title: 'Email reclassified', message: `Classification set to ${INBOX_CLASSIFICATION[c].label}.` });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-none border-b border-surface-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-surface-900">{email.subject}</h2>
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

        <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          <p><span className="text-surface-400">From:</span> <span className="font-medium text-surface-700">{email.senderName}</span> &lt;{email.senderEmail}&gt;</p>
          <p><span className="text-surface-400">To:</span> <span className="text-surface-700">{email.recipient}</span></p>
          {email.cc.length > 0 && <p><span className="text-surface-400">Cc:</span> <span className="text-surface-700">{email.cc.join(', ')}</span></p>}
          <p><span className="text-surface-400">Received:</span> <span className="text-surface-700">{formatDateTime(email.receivedAt)}</span></p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="chip"><Building2 className="h-3 w-3" /> {officeName(email.officeId)}</span>
          <span className="chip"><UserRound className="h-3 w-3" /> {email.owner}</span>
          {email.customerName && <span className="chip">{email.customerName}{email.customerCode ? ` · ${email.customerCode}` : ''}</span>}
          {email.inquiryNo && <span className="chip !text-amber-700 !bg-amber-50 !border-amber-200">Inquiry: {email.inquiryNo}</span>}
          {email.linkedQuotation && <span className="chip !text-brand-700 !bg-brand-50 !border-brand-200">Quote: {email.linkedQuotation}</span>}
          {email.linkedPO && <span className="chip !text-violet-700 !bg-violet-50 !border-violet-200">PO: {email.linkedPO}</span>}
          {email.linkedSO && <span className="chip !text-teal-700 !bg-teal-50 !border-teal-200">SO: {email.linkedSO}</span>}
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Body */}
        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-surface-700">{email.body}</div>

        {/* Attachments */}
        {email.attachments.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-surface-400">
              <Paperclip className="h-3.5 w-3.5" /> Attachments
            </p>
            <ul className="flex flex-wrap gap-2">
              {email.attachments.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-lg border border-surface-200 px-3 py-2">
                  <FileText className="h-4 w-4 text-brand-500" />
                  <div>
                    <p className="text-[13px] font-medium text-surface-700">{a.name}</p>
                    <p className="text-[11px] text-surface-400">{a.type} · {a.size}</p>
                  </div>
                  {canDownload && (
                    <button
                      onClick={() => { downloadText(a.name.replace(/\.\w+$/, '.txt'), `Attachment: ${a.name}\nFrom email: ${email.subject}`); addToast({ type: 'info', title: 'Download started', message: a.name }); }}
                      aria-label={`Download ${a.name}`}
                      title="Download attachment"
                      className="ml-1 rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700"
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

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

        {/* AI Extraction */}
        <div className="mt-5 rounded-xl border border-surface-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-100 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Sparkles className="h-3.5 w-3.5" /></span>
              <h3 className="text-[13px] font-semibold text-surface-800">AI Extraction</h3>
              <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-surface-500">{email.aiConfidence}% confidence</span>
              {email.extractionConfirmed && <StatusBadge tone="green" dot={false} label="Confirmed" className="!text-[10px]" />}
            </div>
            {canEditExtraction && (
              <div className="flex items-center gap-1.5">
                <Button variant="secondary" size="sm" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing((v) => !v)}>
                  {editing ? 'Done' : 'Correct Details'}
                </Button>
                <Button variant="primary" size="sm" leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={confirmExtraction}>
                  Confirm Extraction
                </Button>
              </div>
            )}
          </div>

          {unresolved.length > 0 && (
            <div className="flex items-start gap-2 border-b border-rose-100 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>Mandatory review — resolve required field(s): <span className="font-semibold">{unresolved.join(', ')}</span>. Approval &amp; Send stays disabled until fixed.</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2">
            {email.extraction.map((f, idx) => {
              const meta = fieldTone[f.confidence];
              return (
                <div key={f.key} className={classNames('rounded-lg border px-3 py-2', meta.ring)}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-surface-400">
                      {f.label}{f.required && <span className="text-rose-500"> *</span>}
                    </span>
                    <span className={classNames('text-[10px] font-semibold', meta.tone)}>{meta.label}</span>
                  </div>
                  {editing && canEditExtraction ? (
                    <input
                      value={f.value}
                      onChange={(e) => setField(idx, e.target.value)}
                      placeholder={f.confidence === 'missing' ? 'Enter value…' : ''}
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
        </div>
      </div>
    </div>
  );
}
