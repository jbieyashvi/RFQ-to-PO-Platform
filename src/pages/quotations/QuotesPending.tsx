import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Pencil, AlertCircle, AlertTriangle, Upload, Mail, Activity } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  StatusBadge,
  SearchInput,
  FilterSelect,
  Pagination,
  Modal,
  SelectField,
  TextField,
  TextAreaField,
  FileUpload,
  RowActionMenu,
  type Column,
  type RowAction,
  type UploadedFile,
} from '@/components/ui';
import { QuotationDetailsDrawer } from '@/components/QuotationDetails';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { QUOTATION_DELIVERY } from '@/lib/labels';
import type { InboxEmail, Quotation } from '@/types';
import { ageLabel, classNames, daysBetween, formatDate, formatINR } from '@/lib/format';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

const TODAY = '2026-08-13';

function officeEmail(officeId: string) {
  const city = officeName(officeId).split(' ')[0].toLowerCase();
  return `sales.${city}@nexustrade.in`;
}

const DELIVERY_FILTER_OPTIONS = [
  { value: 'not_sent', label: 'Not Sent' },
  { value: 'draft_ready', label: 'Draft Ready' },
  { value: 'awaiting_approval', label: 'Awaiting Approval' },
  { value: 'send_failed', label: 'Send Failed' },
];

const PRIMARY_LABEL: Record<string, string> = {
  not_sent: 'Prepare Email',
  draft_ready: 'Review & Send',
  awaiting_approval: 'Review',
  send_failed: 'Retry',
};

export default function QuotesPending() {
  const { quotations, parties, emails, role, can, currentUser, updateQuotation, addEmail, addToast } = useApp();
  const inScope = useOfficeScope();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [deliveryFilter, setDeliveryFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [active, setActive] = useState<Quotation | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [external, setExternal] = useState<Quotation | null>(null);
  const loading = useSimulatedLoading([]);

  const base = useMemo(
    () => quotations.filter((q) => q.workState === 'pending_send' && inScope(q.officeId)),
    [quotations, inScope]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return base.filter((q) => {
      if (office && q.officeId !== office) return false;
      if (deliveryFilter && q.deliveryState !== deliveryFilter) return false;
      if (overdueOnly && daysBetween(q.createdDate) <= 1) return false;
      if (s && !`${q.number} ${q.customerName} ${q.customerCode} ${q.owner}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [base, search, office, deliveryFilter, overdueOnly]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const overdueCount = base.filter((q) => daysBetween(q.createdDate) > 1).length;
  const hasFilters = !!search || !!office || !!deliveryFilter || overdueOnly;
  const clearFilters = () => { setSearch(''); setOffice(''); setDeliveryFilter(''); setOverdueOnly(false); };

  const openDrawer = (q: Quotation, tab = 'overview') => { setActiveTab(tab); setActive(q); };
  const openEmailDraft = (q: Quotation) => {
    const existing = emails.find((e) => e.quotationSendId === q.id && !e.sent);
    if (existing) navigate(`/inbox?email=${existing.id}`);
    else reviewAndSend(q);
  };

  // PRIMARY: open the Global Inbox composer with the quotation & customer linked, prefilled.
  const reviewAndSend = (q: Quotation) => {
    const party = parties.find((p) => p.id === q.partyId);
    const from = officeEmail(q.officeId);
    const to = party?.email ?? '';
    const email: InboxEmail = {
      id: `em-send-${q.id}-${Date.now()}`,
      senderName: q.customerName,
      senderEmail: to || 'customer@example.com',
      recipient: from,
      cc: [],
      subject: `Outbound: Quotation ${q.number} — ${q.customerName}`,
      receivedAt: '2026-08-13T12:30:00',
      body: `This is an outbound quotation prepared from “Quotes Pending to be Sent”.\n\nQuotation: ${q.number}\nCustomer: ${q.customerName} (${q.customerCode})\nSales Office: ${officeName(q.officeId)}\nValue: ${formatINR(q.value)}\n\nReview the composed email on the right, confirm the attached quotation, then Approve & Send. Nothing leaves the platform until you approve.`,
      thread: [],
      attachments: [],
      classification: 'inquiry',
      aiConfidence: 96,
      read: true,
      needsReview: false,
      officeId: q.officeId,
      owner: q.owner,
      partyId: q.partyId,
      customerName: q.customerName,
      customerCode: q.customerCode,
      linkedQuotation: q.number,
      quotationSendId: q.id,
      requiredAttachment: true,
      extraction: [
        { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
        { key: 'quotation', label: 'Quotation Number', value: q.number, confidence: 'high', required: true },
        { key: 'amount', label: 'Quotation Value', value: formatINR(q.value), confidence: 'high' },
      ],
      extractionConfirmed: true,
      draft: {
        from,
        to,
        cc: '',
        subject: `Quotation ${q.number} from Nexus RFQ`,
        body: `Dear ${party?.contactPerson ?? 'Sir/Madam'},\n\nThank you for your enquiry. Please find attached our quotation ${q.number} for your kind review.\n\nGrand total: ${formatINR(q.value)} (inclusive of applicable GST).\nPayment terms: ${q.paymentTerms}.\nDelivery: ${q.deliveryTerms}.\n\nThis quotation is valid for 30 days. We look forward to your confirmation.\n\nWarm regards,\n${q.owner}\nNexus RFQ — ${officeName(q.officeId)}`,
        attachments: [{ id: `qa-${q.id}`, name: `${q.number.replace(/\//g, '-')}.pdf`, size: '186 KB', type: 'PDF' }],
        relatedDoc: q.number,
        amount: q.value,
        aiGenerated: true,
      },
      draftSaved: true,
      sent: false,
    };
    addEmail(email);
    updateQuotation(q.id, {
      deliveryState: 'awaiting_approval',
      sendFailureReason: undefined,
      lastUpdated: TODAY,
      activity: [...q.activity, { id: `act-${Date.now()}`, date: '2026-08-13T12:30:00', actor: currentUser.fullName, action: 'Opened Review & Send (email)', detail: `Awaiting approval to send ${q.number}` }],
    });
    navigate(`/inbox?email=${email.id}`);
  };

  const columns: Column<Quotation>[] = [
    {
      key: 'quote',
      header: 'Quote & Customer',
      sticky: 'left',
      sortValue: (r) => r.number,
      render: (r) => (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-semibold text-surface-800">{r.number}</p>
          <p className="truncate text-surface-600" title={r.customerName}>{r.customerName}</p>
          <p className="truncate text-[11px] text-surface-400">{r.customerCode}</p>
        </div>
      ),
    },
    {
      key: 'office',
      header: 'Office / Owner',
      sortValue: (r) => officeName(r.officeId),
      render: (r) => (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-surface-700" title={officeName(r.officeId)}>{officeName(r.officeId)}</p>
          <p className="truncate text-[11px] text-surface-400" title={r.owner}>{r.owner}</p>
        </div>
      ),
    },
    { key: 'value', header: 'Value', width: '92px', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    {
      key: 'pending',
      header: 'Pending Since',
      width: '124px',
      sortValue: (r) => daysBetween(r.createdDate),
      render: (r) => {
        const over = daysBetween(r.createdDate) > 1;
        return (
          <span className={classNames('font-medium', over ? 'text-rose-600' : 'text-surface-600')} title={`Created ${formatDate(r.createdDate)}`}>
            {ageLabel(r.createdDate)}
          </span>
        );
      },
    },
    {
      key: 'delivery',
      header: 'Delivery Status',
      width: '150px',
      sortValue: (r) => r.deliveryState,
      render: (r) => {
        const meta = QUOTATION_DELIVERY[r.deliveryState];
        if (r.deliveryState === 'send_failed') {
          return (
            <span className="inline-flex items-center gap-1.5" title={r.sendFailureReason}>
              <StatusBadge tone={meta.tone} label={meta.label} dot={false} />
              <AlertTriangle className="h-3.5 w-3.5 flex-none text-rose-500" />
            </span>
          );
        }
        return <StatusBadge tone={meta.tone} label={meta.label} dot={false} />;
      },
    },
    { key: 'review', header: 'Review Date', width: '96px', sortValue: (r) => r.reviewDate, render: (r) => <span className="text-surface-600">{formatDate(r.reviewDate, { short: true })}</span> },
    {
      key: 'actions',
      header: 'Action',
      width: '146px',
      align: 'right',
      sticky: 'right',
      render: (r) => {
        const canEdit = can('quotations', 'edit');
        const menu: RowAction[] = [{ label: 'View Quotation', icon: <Eye className="h-4 w-4" />, onClick: () => openDrawer(r, 'overview') }];
        if (canEdit) {
          menu.push({ label: 'Edit Quotation', icon: <Pencil className="h-4 w-4" />, onClick: () => openDrawer(r, 'overview') });
          menu.push({ label: 'Open Email Draft', icon: <Mail className="h-4 w-4" />, onClick: () => openEmailDraft(r) });
          menu.push({ label: 'Mark as Sent Externally', icon: <Upload className="h-4 w-4" />, onClick: () => setExternal(r) });
        }
        menu.push({ label: 'View Activity', icon: <Activity className="h-4 w-4" />, onClick: () => openDrawer(r, 'activity') });
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canEdit && (
              <Button
                size="sm"
                variant="primary"
                className="!px-2.5"
                onClick={() => reviewAndSend(r)}
                title={r.deliveryState === 'send_failed' ? 'Retry — previous send failed' : 'Open Global Inbox to review & send'}
              >
                {PRIMARY_LABEL[r.deliveryState] ?? 'Review & Send'}
              </Button>
            )}
            <RowActionMenu actions={menu} label={`Actions for ${r.number}`} />
          </div>
        );
      },
    },
  ];

  // State-specific empty content
  const empty = (() => {
    if (base.length === 0)
      return { title: 'Nothing pending', message: 'Every quotation has been sent or marked sent externally. 🎉' };
    if (deliveryFilter === 'send_failed')
      return { title: 'No failed sends', message: 'No pending quotation currently has a failed send.' };
    if (overdueOnly)
      return { title: 'No overdue quotations', message: 'Nothing is overdue by more than 24 hours.' };
    if (hasFilters)
      return {
        title: 'No matching quotations',
        message: 'Try adjusting the search or filters.',
        action: <Button size="sm" variant="secondary" onClick={clearFilters}>Clear filters</Button>,
      };
    return { title: 'Nothing pending', message: 'Every quotation has been sent.' };
  })();

  return (
    <>
      <PageHeader
        title="Quotes Pending to be Sent"
        description="Review, approve, and send pending quotations to customers."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Pending to be Sent' }]}
      />

      {overdueCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] text-rose-700">
          <AlertCircle className="h-4 w-4 flex-none" />
          <span className="font-medium">
            {overdueCount} quotation{overdueCount > 1 ? 's' : ''} overdue by more than 24 hours
          </span>
          {!overdueOnly && (
            <button onClick={() => setOverdueOnly(true)} className="ml-auto flex-none text-xs font-semibold underline-offset-2 hover:underline">
              View overdue only
            </button>
          )}
        </div>
      )}

      <div className="card">
        {/* Compact filter toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-100 p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search quotation, customer, owner…" className="w-full sm:w-64" />
          {role === 'super_admin' && (
            <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />
          )}
          <FilterSelect value={deliveryFilter} onChange={setDeliveryFilter} placeholder="All Delivery States" options={DELIVERY_FILTER_OPTIONS} />
          <button
            onClick={() => setOverdueOnly((v) => !v)}
            aria-pressed={overdueOnly}
            className={classNames(
              'h-9 rounded-lg border px-3 text-sm font-medium transition-colors',
              overdueOnly ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-surface-200 text-surface-600 hover:bg-surface-50'
            )}
          >
            Overdue only
          </button>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs font-semibold text-surface-500 hover:text-brand-600 hover:underline">
              Clear
            </button>
          )}
          <span className="ml-auto text-xs text-surface-500">
            <span className="font-semibold text-surface-800">{filtered.length}</span> pending
          </span>
        </div>

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => openDrawer(r, 'overview')}
          emptyTitle={empty.title}
          emptyMessage={empty.message}
          emptyAction={empty.action}
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <QuotationDetailsDrawer quotation={active} initialTab={activeTab} onClose={() => setActive(null)} />

      {external && (
        <MarkExternalModal
          quotation={external}
          onClose={() => setExternal(null)}
          onConfirm={(payload) => {
            updateQuotation(external.id, {
              deliveryState: 'sent_externally',
              workState: 'sent',
              sendChannel: payload.channel,
              sendNote: payload.note || undefined,
              sentAt: payload.sentAt,
              sentBy: currentUser.fullName,
              sendFailureReason: undefined,
              lastUpdated: TODAY,
              activity: [
                ...external.activity,
                { id: `act-${Date.now()}`, date: payload.sentAt, actor: currentUser.fullName, action: `Marked sent externally via ${payload.channel}`, detail: payload.note || `${external.number} sent outside the platform` },
              ],
            });
            addToast({ type: 'success', title: 'Marked as sent externally', message: `${external.number} recorded as sent via ${payload.channel}.` });
            setExternal(null);
          }}
        />
      )}
    </>
  );
}

// ---------- Mark as Sent Externally ----------
function MarkExternalModal({
  quotation,
  onClose,
  onConfirm,
}: {
  quotation: Quotation;
  onClose: () => void;
  onConfirm: (p: { channel: string; sentAt: string; note: string; proof: UploadedFile[] }) => void;
}) {
  const [channel, setChannel] = useState('Email');
  const [date, setDate] = useState(TODAY);
  const [time, setTime] = useState('12:00');
  const [note, setNote] = useState('');
  const [proof, setProof] = useState<UploadedFile[]>([]);
  const [error, setError] = useState('');

  const submit = () => {
    if (!date || !time) {
      setError('Sent date and time are required.');
      return;
    }
    onConfirm({ channel, sentAt: `${date}T${time}:00`, note, proof });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Mark as Sent Externally"
      subtitle={`${quotation.number} · ${quotation.customerName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={<Upload className="h-4 w-4" />} onClick={submit}>Confirm Sent Externally</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-[13px] text-surface-600">
          Use this when the quotation was sent to the customer <span className="font-medium">outside the platform</span>. This does not send any email — it records a manual delivery event.
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField label="Channel" required value={channel} onChange={(e) => setChannel(e.target.value)} options={[{ value: 'Email', label: 'Email' }, { value: 'WhatsApp', label: 'WhatsApp' }, { value: 'Other', label: 'Other' }]} />
          <TextField label="Sent Date" required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="Sent Time" required type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <TextAreaField label="Note (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Shared PDF over WhatsApp with the procurement contact." />
        <div>
          <label className="label">Proof / Attachment (optional)</label>
          <FileUpload files={proof} onChange={setProof} label="Attach a screenshot or sent copy" multiple={false} />
        </div>
        {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
      </div>
    </Modal>
  );
}
