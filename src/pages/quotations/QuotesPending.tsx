import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Inbox, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  DataTable,
  SearchInput,
  FilterSelect,
  Pagination,
  type Column,
} from '@/components/ui';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { officeName, officeCode } from '@/data/offices';
import { APP_NAME, emailSignature } from '@/lib/brand';
import type { InboxEmail, Quotation } from '@/types';
import { classNames } from '@/lib/format';
import { inquiryNumberFor } from '@/lib/inquiry';
import { emailBelongsToInquiry, inboxUrl } from '@/lib/inboxContext';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';

// ---------------------------------------------------------------------------
// Deterministic prototype clock. Due Date = Inquiry Received + exactly 24h, and
// overdue / due-soon / upcoming states are computed against this fixed "now"
// (Asia/Kolkata wall-clock) so the demo always shows a representative mix.
// ---------------------------------------------------------------------------
const NOW = new Date('2026-08-13T13:00:00');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const DUE_SOON_WINDOW = 4 * HOUR;

// Minutes between NOW and each pending inquiry's Due Date, cycled by position.
// Negative = already overdue; 0…240 = due within the next four hours; else upcoming.
const DUE_OFFSET_MINUTES = [-180, -2880, 150, 780, -480, 210, -7200, 1290, -60, 600];
// One inquiry in the queue is intentionally left Unassigned to exercise that state.
const UNASSIGNED_AT = 3;

type DueState = 'overdue' | 'due_soon' | 'upcoming';

interface PendingRow {
  q: Quotation;
  inquiryNo: string;
  owner: string; // '' → Unassigned
  queryCreatedAt: string; // ISO
  dueAt: string; // ISO
  state: DueState;
  overdueLabel?: string; // e.g. "Overdue by 3h"
}

const VALUE_BUCKETS = [
  { value: 'below1l', label: 'Below ₹1L' },
  { value: '1lto5l', label: '₹1L–₹5L' },
  { value: '5lto25l', label: '₹5L–₹25L' },
  { value: '25lto1cr', label: '₹25L–₹1Cr' },
  { value: 'above1cr', label: 'Above ₹1Cr' },
];

const DUE_STATE_OPTIONS = [
  { value: 'overdue', label: 'Overdue Only' },
  { value: 'due_soon', label: 'Due Soon' },
];

function inValueBucket(v: number, bucket: string): boolean {
  switch (bucket) {
    case 'below1l':
      return v < 100000;
    case '1lto5l':
      return v >= 100000 && v < 500000;
    case '5lto25l':
      return v >= 500000 && v < 2500000;
    case '25lto1cr':
      return v >= 2500000 && v < 10000000;
    case 'above1cr':
      return v >= 10000000;
    default:
      return true;
  }
}

// Compact Indian currency matching the PM prototype: ₹7.5L, ₹25L, ₹1.2Cr.
function compactINR(v: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (v >= 10000000) return `₹${trim(v / 10000000)}Cr`;
  if (v >= 100000) return `₹${trim(v / 100000)}L`;
  return `₹${new Intl.NumberFormat('en-IN').format(Math.round(v))}`;
}

// "01 Aug 2026" — Asia/Kolkata wall-clock date.
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "09:00 AM" — 12-hour time.
function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

// "01 Aug 2026, 09:00 AM" — single-line, used in mobile cards.
function fmtDateTime(iso: string): string {
  if (isNaN(new Date(iso).getTime())) return iso;
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

function overdueLabel(ms: number): string {
  const hours = Math.floor(ms / HOUR);
  if (hours < 24) return `Overdue by ${Math.max(1, hours)}h`;
  return `Overdue by ${Math.floor(hours / 24)}d`;
}

function officeEmail(officeId: string) {
  const city = officeName(officeId).split(' ')[0].toLowerCase();
  return `sales.${city}@flowtech-instruments.com`;
}

export default function QuotesPending() {
  const { quotations, salesOrders, parties, emails, can, addEmail } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const navigate = useNavigate();
  const loading = useSimulatedLoading([]);

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [location, setLocation] = useState('');
  const [valueBucket, setValueBucket] = useState('');
  const [dueState, setDueState] = useState('');

  // Base pending queue (scoped), enriched into view-model rows.
  const rows = useMemo<PendingRow[]>(() => {
    const pending = quotations
      .filter((q) => q.workState === 'pending_send' && inScope(q.officeId))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    return pending.map((q, i) => {
      const dueMs = NOW.getTime() + DUE_OFFSET_MINUTES[i % DUE_OFFSET_MINUTES.length] * 60 * 1000;
      const dueAt = new Date(dueMs);
      const queryCreatedAt = new Date(dueMs - DAY);
      const left = dueMs - NOW.getTime();
      let state: DueState = 'upcoming';
      let label: string | undefined;
      if (left <= 0) {
        state = 'overdue';
        label = overdueLabel(NOW.getTime() - dueMs);
      } else if (left <= DUE_SOON_WINDOW) {
        state = 'due_soon';
      }
      return {
        q,
        inquiryNo: inquiryNumberFor(q),
        owner: i === UNASSIGNED_AT ? '' : q.owner,
        queryCreatedAt: queryCreatedAt.toISOString(),
        dueAt: dueAt.toISOString(),
        state,
        overdueLabel: label,
      };
    });
  }, [quotations, inScope]);

  const overdueCount = rows.filter((r) => r.state === 'overdue').length;

  const ownerOptions = useMemo(() => {
    const names = Array.from(new Set(rows.filter((r) => r.owner).map((r) => r.owner))).sort();
    const opts = names.map((n) => ({ value: n, label: n }));
    if (rows.some((r) => !r.owner)) opts.push({ value: 'unassigned', label: 'Unassigned' });
    return opts;
  }, [rows]);

  const locationOptions = useMemo(() => {
    const ids = Array.from(new Set(rows.map((r) => r.q.officeId)));
    return ids
      .map((id) => ({ value: id, label: officeName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (location && r.q.officeId !== location) return false;
        if (ownerFilter === 'unassigned' && r.owner) return false;
        if (ownerFilter && ownerFilter !== 'unassigned' && r.owner !== ownerFilter) return false;
        if (valueBucket && !inValueBucket(r.q.value, valueBucket)) return false;
        if (dueState === 'overdue' && r.state !== 'overdue') return false;
        if (dueState === 'due_soon' && r.state !== 'due_soon') return false;
        if (s && !`${r.inquiryNo} ${r.q.customerName} ${r.q.customerCode}`.toLowerCase().includes(s))
          return false;
        return true;
      })
      // Overdue first, then upcoming by nearest Due Date (ascending due time).
      .sort((a, b) => (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));
  }, [rows, search, ownerFilter, location, valueBucket, dueState]);

  const { page, pageSize, setPage, setPageSize, pageRows, total } = usePaginated(filtered, 10);

  const hasFilters = !!search || !!ownerFilter || !!location || !!valueBucket || !!dueState;
  const clearFilters = () => {
    setSearch('');
    setOwnerFilter('');
    setLocation('');
    setValueBucket('');
    setDueState('');
  };

  // Open the inquiry's linked Global Inbox conversation in focused quote-send
  // mode — selecting the correct email for THIS inquiry and passing the QTN so
  // the inbox opens its quote tools. Nothing is sent; the composer stays for
  // human review. No quotation drawer opens on this page.
  const openInbox = (r: PendingRow) => {
    const q = r.q;
    // The candidate must RESOLVE to this inquiry — same customer, and a link
    // that walks back to this quotation. An email that merely cites a similar
    // number, or another customer's mail, is never opened as this inquiry.
    const existing = emails.find(
      (e) =>
        !e.sent &&
        (e.quotationSendId === q.id || e.linkedQuotation === q.number) &&
        emailBelongsToInquiry(e, q.id, quotations, salesOrders)
    );
    const emailId = existing?.id ?? `em-inq-${q.id}`;
    if (!existing && !emails.some((e) => e.id === emailId)) addEmail(buildInquiryEmail(q, r, emailId));
    // One context object, every id taken from THIS quotation record.
    navigate(inboxUrl({ emailId, customerId: q.partyId, inquiryId: q.id, mode: 'quote-send', qtn: q.id }));
  };

  const buildInquiryEmail = (q: Quotation, r: PendingRow, id: string): InboxEmail => {
    const party = parties.find((p) => p.id === q.partyId);
    const from = officeEmail(q.officeId);
    const to = party?.email ?? 'procurement@customer.com';
    return {
      id,
      senderName: party?.contactPerson ?? q.customerName,
      senderEmail: to,
      recipient: from,
      cc: [],
      subject: `Enquiry ${r.inquiryNo} — ${q.customerName}`,
      receivedAt: r.queryCreatedAt.slice(0, 19),
      body: `Dear Flowtech team,\n\nPlease share your quotation against our enquiry ${r.inquiryNo}. Kindly include GST, delivery and payment terms.\n\nRegards,\n${party?.contactPerson ?? 'Procurement'}\n${q.customerName}`,
      thread: [],
      classification: 'inquiry',
      aiConfidence: 95,
      read: true,
      needsReview: false,
      officeId: q.officeId,
      owner: q.owner,
      partyId: q.partyId,
      customerName: q.customerName,
      customerCode: q.customerCode,
      linkedQuotation: q.number,
      quotationSendId: q.id,
      inquiryId: q.id,
      inquiryNo: r.inquiryNo,
      extraction: [
        { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
        { key: 'inquiry', label: 'Inquiry Number', value: r.inquiryNo, confidence: 'high', required: true },
        { key: 'quotation', label: 'Quotation Number', value: q.number, confidence: 'high', required: true },
        { key: 'amount', label: 'Quotation Value', value: compactINR(q.value), confidence: 'high' },
      ],
      extractionConfirmed: true,
      draft: {
        from,
        to,
        cc: '',
        subject: `Quotation ${q.number} from ${APP_NAME}`,
        body: `Dear ${party?.contactPerson ?? 'Sir/Madam'},\n\nThank you for your enquiry ${r.inquiryNo}. Our quotation ${q.number} is ready for your kind review.\n\nGrand total: ${compactINR(q.value)} (inclusive of applicable GST).\nPayment terms: ${q.paymentTerms}.\nDelivery: ${q.deliveryTerms}.\n\nThis quotation is valid for 30 days. We look forward to your confirmation.\n\n${emailSignature(q.owner, officeName(q.officeId))}`,
        relatedDoc: q.number,
        amount: q.value,
        aiGenerated: true,
      },
      draftSaved: true,
      sent: false,
    };
  };

  const canOpen = can('quotations', 'view');

  const columns: Column<PendingRow>[] = [
    {
      key: 'inquiry',
      header: 'Inquiry No.',
      sticky: 'left',
      width: '170px',
      sortValue: (r) => r.inquiryNo,
      render: (r) => (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-semibold text-surface-800">{r.inquiryNo}</p>
          <p className="truncate text-[11px] text-surface-400">{r.q.number}</p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      width: '146px',
      truncate: true,
      title: (r) => r.q.customerName,
      sortValue: (r) => r.q.customerName,
      render: (r) => (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-medium text-surface-800">{r.q.customerName}</p>
          <p className="truncate text-[11px] text-surface-400">{r.q.customerCode}</p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      width: '114px',
      truncate: true,
      title: (r) => officeName(r.q.officeId),
      sortValue: (r) => officeName(r.q.officeId),
      render: (r) => (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-surface-700">{officeName(r.q.officeId)}</p>
          <p className="truncate text-[11px] text-surface-400">{officeCode(r.q.officeId)}</p>
        </div>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      width: '104px',
      truncate: true,
      title: (r) => r.owner || 'Unassigned',
      sortValue: (r) => r.owner || 'zzz',
      render: (r) =>
        r.owner ? (
          <span className="text-surface-700">{r.owner}</span>
        ) : (
          <span className="italic text-surface-400">Unassigned</span>
        ),
    },
    {
      key: 'value',
      header: 'Value',
      width: '78px',
      align: 'right',
      sortValue: (r) => r.q.value,
      render: (r) => <span className="font-medium text-surface-800">{compactINR(r.q.value)}</span>,
    },
    {
      key: 'created',
      header: 'Inquiry Received',
      width: '112px',
      sortValue: (r) => r.queryCreatedAt,
      render: (r) => (
        <div className="leading-tight">
          <p className="whitespace-nowrap text-surface-700">{fmtDate(r.queryCreatedAt)}</p>
          <p className="text-[11px] text-surface-400">{fmtTime(r.queryCreatedAt)}</p>
        </div>
      ),
    },
    {
      key: 'due',
      header: 'Due Date',
      width: '150px',
      sortValue: (r) => r.dueAt,
      render: (r) => <DueCell row={r} />,
    },
    {
      key: 'action',
      header: 'Action',
      width: '96px',
      align: 'right',
      sticky: 'right',
      render: (r) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="primary" leftIcon={<Inbox className="h-4 w-4" />} onClick={() => openInbox(r)} disabled={!canOpen}>
            Open
          </Button>
        </div>
      ),
    },
  ];

  const empty = hasFilters
    ? {
        title: 'No matching quotations',
        message: 'Try adjusting the search or filters.',
        action: (
          <Button size="sm" variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        ),
      }
    : { title: 'Nothing pending', message: 'Every quotation has been sent. 🎉' };

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="Quotes Pending to be Sent"
          description="Open each inquiry in the Global Inbox to review and send its quotation to the customer."
          crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Pending to be Sent' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Quotes Pending to be Sent"
        description="Open each inquiry in the Global Inbox to review and send its quotation to the customer."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Pending to be Sent' }]}
      />

      {overdueCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] text-rose-700">
          <AlertCircle className="h-4 w-4 flex-none" />
          <span className="font-medium">
            {overdueCount} quotation{overdueCount > 1 ? 's are' : ' is'} overdue.
          </span>
          {dueState !== 'overdue' && (
            <button
              onClick={() => setDueState('overdue')}
              className="ml-auto flex-none text-xs font-semibold underline-offset-2 hover:underline"
            >
              View overdue only
            </button>
          )}
        </div>
      )}

      <div className="card">
        {/* Compact filter toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-100 p-3">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search inquiry no. or customer…"
            className="w-full sm:w-64"
          />
          <FilterSelect value={ownerFilter} onChange={setOwnerFilter} placeholder="All Owners" options={ownerOptions} />
          <FilterSelect value={location} onChange={setLocation} placeholder="All Locations" options={locationOptions} />
          <FilterSelect value={valueBucket} onChange={setValueBucket} placeholder="All Values" options={VALUE_BUCKETS} />
          <FilterSelect value={dueState} onChange={setDueState} placeholder="All Due States" options={DUE_STATE_OPTIONS} />
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-xs font-semibold text-surface-500 hover:text-brand-600 hover:underline"
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-xs text-surface-500">
            <span className="font-semibold text-surface-800">{filtered.length}</span> pending
          </span>
        </div>

        {/* Desktop / tablet table */}
        <div className="hidden md:block">
          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.q.id}
            loading={loading}
            onRowClick={canOpen ? (r) => openInbox(r) : undefined}
            emptyTitle={empty.title}
            emptyMessage={empty.message}
            emptyAction={empty.action}
          />
        </div>

        {/* Mobile cards */}
        <div className="md:hidden">
          {pageRows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-surface-700">{empty.title}</p>
              <p className="mt-1 text-[13px] text-surface-500">{empty.message}</p>
              {empty.action && <div className="mt-3 flex justify-center">{empty.action}</div>}
            </div>
          ) : (
            <ul className="divide-y divide-surface-100">
              {pageRows.map((r) => (
                <MobileCard key={r.q.id} row={r} onOpen={() => openInbox(r)} canOpen={canOpen} />
              ))}
            </ul>
          )}
        </div>

        {!loading && total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>
    </>
  );
}

function DueCell({ row }: { row: PendingRow }) {
  const tone =
    row.state === 'overdue' ? 'text-rose-600' : row.state === 'due_soon' ? 'text-amber-600' : 'text-surface-700';
  return (
    <div className="leading-tight">
      <p className={classNames('whitespace-nowrap font-medium', tone)}>{fmtDate(row.dueAt)}</p>
      <p className={classNames('whitespace-nowrap text-[11px]', row.state === 'upcoming' ? 'text-surface-400' : tone)}>
        {fmtTime(row.dueAt)}
        {row.state === 'overdue' && ` · ${row.overdueLabel?.replace('Overdue by ', 'Overdue ')}`}
        {row.state === 'due_soon' && ' · Due Soon'}
      </p>
    </div>
  );
}

function MobileCard({ row, onOpen, canOpen }: { row: PendingRow; onOpen: () => void; canOpen: boolean }) {
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex-none text-[11px] font-medium uppercase tracking-wide text-surface-400">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] text-surface-700">{children}</span>
    </div>
  );
  return (
    <li className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-surface-800">{row.inquiryNo}</p>
          <p className="truncate text-[12px] text-surface-500">{row.q.customerName}</p>
        </div>
        <span className="flex-none font-semibold text-surface-800">{compactINR(row.q.value)}</span>
      </div>
      <div className="space-y-1.5 rounded-lg bg-surface-50 px-3 py-2">
        <Field label="Location">{officeName(row.q.officeId)}</Field>
        <Field label="Owner">
          {row.owner || <span className="italic text-surface-400">Unassigned</span>}
        </Field>
        <Field label="Inquiry Received">{fmtDateTime(row.queryCreatedAt)}</Field>
        <Field label="Due Date">
          <span
            className={classNames(
              'font-medium',
              row.state === 'overdue' ? 'text-rose-600' : row.state === 'due_soon' ? 'text-amber-600' : 'text-surface-700'
            )}
          >
            {fmtDateTime(row.dueAt)}
            {row.state === 'overdue' && ` · ${row.overdueLabel?.replace('Overdue by ', 'Overdue ')}`}
            {row.state === 'due_soon' && ' · Due Soon'}
          </span>
        </Field>
      </div>
      <Button size="sm" variant="primary" className="w-full" leftIcon={<Inbox className="h-4 w-4" />} onClick={onOpen} disabled={!canOpen}>
        Open
      </Button>
    </li>
  );
}
