import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Pencil, Send, AlertCircle, Upload, RotateCcw } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  StatusBadge,
  SearchInput,
  FilterBar,
  FilterSelect,
  Pagination,
  Modal,
  SelectField,
  TextField,
  TextAreaField,
  FileUpload,
  RowActionMenu,
  type Column,
  type FilterChip,
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

export default function QuotesPending() {
  const { quotations, parties, role, can, currentUser, updateQuotation, addEmail, addToast } = useApp();
  const inScope = useOfficeScope();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [office, setOffice] = useState('');
  const [active, setActive] = useState<Quotation | null>(null);
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
      if (s && !`${q.number} ${q.customerName} ${q.customerCode} ${q.owner}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [base, search, office]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const chips: FilterChip[] = [];
  if (office) chips.push({ key: 'o', label: `Office: ${officeName(office)}`, onRemove: () => setOffice('') });
  if (search) chips.push({ key: 'q', label: `Search: "${search}"`, onRemove: () => setSearch('') });

  const overdueCount = base.filter((q) => daysBetween(q.createdDate) > 1).length;

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
    { key: 'number', header: 'QTN No', width: '114px', sticky: 'left', sortValue: (r) => r.number, render: (r) => <span className="font-medium text-surface-800">{r.number}</span> },
    {
      key: 'customer',
      header: 'Customer',
      render: (r) => (
        <div className="min-w-0"><p className="truncate font-medium text-surface-800" title={r.customerName}>{r.customerName}</p><p className="truncate text-[11px] text-surface-400">{r.customerCode}</p></div>
      ),
    },
    { key: 'office', header: 'Sales Office', truncate: true, title: (r) => officeName(r.officeId), render: (r) => <span className="text-surface-600">{officeName(r.officeId)}</span> },
    { key: 'owner', header: 'Owner', width: '102px', truncate: true, title: (r) => r.owner, render: (r) => <span className="text-surface-600">{r.owner}</span> },
    { key: 'value', header: 'Value', width: '88px', align: 'right', sortValue: (r) => r.value, render: (r) => <span className="font-medium text-surface-800">{formatINR(r.value)}</span> },
    {
      key: 'age',
      header: 'Age',
      width: '76px',
      sortValue: (r) => daysBetween(r.createdDate),
      render: (r) => {
        const over = daysBetween(r.createdDate) > 1;
        return (
          <span className={classNames('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', over ? 'bg-rose-50 text-rose-600' : 'bg-surface-100 text-surface-500')} title={`Created ${formatDate(r.createdDate)}`}>
            {over && <AlertCircle className="h-3 w-3" />}
            {ageLabel(r.createdDate)}
          </span>
        );
      },
    },
    {
      key: 'delivery',
      header: 'Delivery',
      width: '136px',
      sortValue: (r) => r.deliveryState,
      render: (r) => (
        <div className="min-w-0">
          <StatusBadge tone={QUOTATION_DELIVERY[r.deliveryState].tone} label={QUOTATION_DELIVERY[r.deliveryState].label} />
          {r.deliveryState === 'send_failed' && r.sendFailureReason && (
            <p className="mt-0.5 truncate text-[10px] text-rose-500" title={r.sendFailureReason}>{r.sendFailureReason}</p>
          )}
        </div>
      ),
    },
    { key: 'review', header: 'Review', width: '84px', sortValue: (r) => r.reviewDate, render: (r) => <span className="text-surface-600">{formatDate(r.reviewDate, { short: true })}</span> },
    {
      key: 'actions',
      header: 'Actions',
      width: '158px',
      align: 'right',
      sticky: 'right',
      render: (r) => {
        const failed = r.deliveryState === 'send_failed';
        const menu: RowAction[] = [{ label: 'View Quotation', icon: <Eye className="h-4 w-4" />, onClick: () => setActive(r) }];
        if (can('quotations', 'edit')) {
          menu.push({ label: 'Prepare / Edit Quote', icon: <Pencil className="h-4 w-4" />, onClick: () => setActive(r) });
          menu.push({ label: 'Mark as Sent Externally', icon: <Upload className="h-4 w-4" />, onClick: () => setExternal(r) });
        }
        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {can('quotations', 'edit') && (
              <Button
                size="sm"
                variant={failed ? 'danger' : 'primary'}
                leftIcon={failed ? <RotateCcw className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                onClick={() => reviewAndSend(r)}
                title={failed ? 'Retry — previous send failed' : r.deliveryState === 'awaiting_approval' ? 'Continue review in Global Inbox' : 'Open Global Inbox to review & send'}
              >
                {failed ? 'Retry Send' : 'Review & Send'}
              </Button>
            )}
            <RowActionMenu actions={menu} label={`Actions for ${r.number}`} />
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Quotes Pending to be Sent"
        description="Quotations awaiting dispatch. “Sent” is a delivery state — separate from business Status (Open/Close/Receive) and Stage."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Pending to be Sent' }]}
      />

      {overdueCount > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-5 w-5 flex-none" />
          <span>
            <span className="font-semibold">{overdueCount} quotation{overdueCount > 1 ? 's' : ''}</span> pending for more than 24 hours — highlighted below.
          </span>
        </div>
      )}

      <div className="card">
        <div className="border-b border-surface-100 p-4">
          <FilterBar chips={chips} onClearAll={() => { setOffice(''); setSearch(''); }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full sm:w-72" />
            {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
          </FilterBar>
        </div>
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => setActive(r)}
          emptyTitle="Nothing pending"
          emptyMessage="All quotations have been sent or marked sent externally. 🎉"
        />
        {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />}
      </div>

      <QuotationDetailsDrawer quotation={active} onClose={() => setActive(null)} />

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
