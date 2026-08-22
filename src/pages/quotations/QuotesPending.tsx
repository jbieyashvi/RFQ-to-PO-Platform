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
import type { InboxEmail, Quotation } from '@/types';
import { classNames } from '@/lib/format';
import {
  inquiryIdOfEmail,
  inquiryNumberFor,
  inquiryNumberForEmail,
  isUnquotedInquiry,
} from '@/lib/inquiry';
import { inboxUrl } from '@/lib/inboxContext';
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

// One row = one inquiry whose quotation has not gone out yet. There is no
// separate Inquiry module, so this queue holds BOTH shapes an inquiry can be
// in: a brand-new enquiry that has not been quoted at all (no quotation, no
// number, no value) and an enquiry whose quotation exists but is still pending
// send. `q` is what tells them apart.
interface PendingRow {
  /** Stable identity — the quotation id, or the enquiry email id when unquoted. */
  key: string;
  /** The quotation, once one exists. null while the inquiry is still unquoted. */
  q: Quotation | null;
  /** The enquiry mail this row opens, when it is already in the inbox. */
  emailId: string | null;
  inquiryNo: string;
  /** null until a quotation has been generated for this inquiry. */
  quotationNo: string | null;
  partyId: string | null;
  customerName: string;
  customerCode: string;
  officeId: string;
  owner: string; // '' → Unassigned
  /** null until the quotation carries priced line items. */
  value: number | null;
  queryCreatedAt: string; // ISO
  dueAt: string; // ISO
  state: DueState;
  overdueLabel?: string; // e.g. "Overdue by 3h"
}

// Due Date + its derived state, shared by both row shapes so the overdue /
// due-soon thresholds stay identical whichever way the row was built.
function dueFields(dueMs: number): Pick<PendingRow, 'dueAt' | 'state' | 'overdueLabel'> {
  const dueAt = new Date(dueMs).toISOString();
  const left = dueMs - NOW.getTime();
  if (left <= 0) return { dueAt, state: 'overdue', overdueLabel: overdueLabel(-left) };
  if (left <= DUE_SOON_WINDOW) return { dueAt, state: 'due_soon' };
  return { dueAt, state: 'upcoming' };
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

  // The enquiry mail behind each inquiry — the mail "Open" lands on. Resolved
  // through inquiryIdOfEmail rather than by document number, because the RFQ of
  // a pending inquiry deliberately carries NO quotation number. Earliest mail
  // wins, so the queue opens the original RFQ and not a later clarification.
  const enquiryByInquiry = useMemo(() => {
    const map = new Map<string, InboxEmail>();
    for (const e of emails) {
      if (e.sent || e.classification !== 'inquiry') continue;
      const id = inquiryIdOfEmail(e, quotations, salesOrders);
      if (!id) continue;
      const prev = map.get(id);
      if (!prev || e.receivedAt < prev.receivedAt) map.set(id, e);
    }
    return map;
  }, [emails, quotations, salesOrders]);

  // Newly received enquiries that have not been quoted at all. A new inquiry
  // belongs in this queue from the moment it arrives — waiting for a quotation
  // to exist would hide exactly the work this page is meant to surface.
  const unquoted = useMemo(
    () =>
      emails.filter((e) => inScope(e.officeId) && isUnquotedInquiry(e, quotations, salesOrders)),
    [emails, quotations, salesOrders, inScope]
  );

  // Base pending queue (scoped), enriched into view-model rows.
  const rows = useMemo<PendingRow[]>(() => {
    const pending = quotations
      .filter((q) => q.workState === 'pending_send' && inScope(q.officeId))
      .sort((a, b) => (a.id < b.id ? -1 : 1));

    const quoted: PendingRow[] = pending.map((q, i) => {
      const dueMs = NOW.getTime() + DUE_OFFSET_MINUTES[i % DUE_OFFSET_MINUTES.length] * 60 * 1000;
      return {
        key: q.id,
        q,
        emailId: enquiryByInquiry.get(q.id)?.id ?? null,
        inquiryNo: inquiryNumberFor(q),
        quotationNo: q.number,
        partyId: q.partyId,
        customerName: q.customerName,
        customerCode: q.customerCode,
        officeId: q.officeId,
        owner: i === UNASSIGNED_AT ? '' : q.owner,
        // An unpriced draft has no value yet — showing ₹0 would read as free.
        value: q.items.length ? q.value : null,
        queryCreatedAt: new Date(dueMs - DAY).toISOString(),
        ...dueFields(dueMs),
      };
    });

    // Unquoted enquiries follow the documented rule directly: Due Date =
    // Inquiry Received + exactly 24h, against the same fixed "now".
    const fresh: PendingRow[] = unquoted.map((e) => ({
      key: e.id,
      q: null,
      emailId: e.id,
      inquiryNo: inquiryNumberForEmail(e),
      quotationNo: null,
      partyId: e.partyId ?? null,
      customerName: e.customerName ?? e.senderName,
      customerCode: e.customerCode ?? '',
      officeId: e.officeId,
      owner: e.owner,
      value: null,
      queryCreatedAt: e.receivedAt,
      ...dueFields(new Date(e.receivedAt).getTime() + DAY),
    }));

    return [...fresh, ...quoted];
  }, [quotations, inScope, enquiryByInquiry, unquoted]);

  const overdueCount = rows.filter((r) => r.state === 'overdue').length;

  const ownerOptions = useMemo(() => {
    const names = Array.from(new Set(rows.filter((r) => r.owner).map((r) => r.owner))).sort();
    const opts = names.map((n) => ({ value: n, label: n }));
    if (rows.some((r) => !r.owner)) opts.push({ value: 'unassigned', label: 'Unassigned' });
    return opts;
  }, [rows]);

  const locationOptions = useMemo(() => {
    const ids = Array.from(new Set(rows.map((r) => r.officeId)));
    return ids
      .map((id) => ({ value: id, label: officeName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (location && r.officeId !== location) return false;
        if (ownerFilter === 'unassigned' && r.owner) return false;
        if (ownerFilter && ownerFilter !== 'unassigned' && r.owner !== ownerFilter) return false;
        // An inquiry with no quotation yet has no value to bucket, so it falls
        // out of every SPECIFIC bucket rather than counting as "Below ₹1L".
        if (valueBucket && (r.value === null || !inValueBucket(r.value, valueBucket))) return false;
        if (dueState === 'overdue' && r.state !== 'overdue') return false;
        if (dueState === 'due_soon' && r.state !== 'due_soon') return false;
        if (
          s &&
          !`${r.inquiryNo} ${r.quotationNo ?? ''} ${r.customerName} ${r.customerCode}`
            .toLowerCase()
            .includes(s)
        )
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

  // Open the inquiry's Global Inbox conversation — email + customer + inquiry,
  // every id taken from THIS row. Deliberately NO quote-send mode and no `qtn`:
  // Open always lands on the enquiry and its AI Requirement Extraction review,
  // never on a ready-made quotation workspace. The quotation is what the review
  // produces, through Generate Quote.
  const openInbox = (r: PendingRow) => {
    let emailId = r.emailId;
    if (!emailId && r.q) {
      // A pending quotation with no enquiry mail in this session — raise the
      // enquiry it stands for, as a plain RFQ with nothing pre-confirmed.
      emailId = `em-inq-${r.q.id}`;
      const id = emailId;
      if (!emails.some((e) => e.id === id)) addEmail(buildInquiryEmail(r.q, r, id));
    }
    if (!emailId) return;
    navigate(inboxUrl({ emailId, customerId: r.partyId, inquiryId: r.q?.id ?? null }));
  };

  // The customer's RFQ, exactly as it would have arrived: itemised, unconfirmed
  // and with no outgoing draft. Pre-confirming the extraction or pre-writing the
  // quotation mail here would skip the review this page exists to route into.
  const buildInquiryEmail = (q: Quotation, r: PendingRow, id: string): InboxEmail => {
    const party = parties.find((p) => p.id === q.partyId);
    const from = party?.email ?? 'procurement@customer.com';
    const items = q.items.map((it) => `  • ${it.description} — ${it.quantity} ${it.unit}`).join('\n');
    return {
      id,
      senderName: party?.contactPerson ?? q.customerName,
      senderEmail: from,
      recipient: officeEmail(q.officeId),
      cc: [],
      subject: `Enquiry ${r.inquiryNo} — request for quotation`,
      receivedAt: r.queryCreatedAt.slice(0, 19),
      body: `Dear Flowtech team,\n\nPlease share your best quotation against our enquiry ${r.inquiryNo} for the following requirement:\n\n${items}\n\nKindly include GST, delivery schedule and payment terms in your offer.\n\nRegards,\n${party?.contactPerson ?? 'Procurement'}\n${q.customerName}`,
      thread: [],
      classification: 'inquiry',
      aiConfidence: 93,
      read: true,
      needsReview: false,
      officeId: q.officeId,
      owner: q.owner,
      partyId: q.partyId,
      customerName: q.customerName,
      customerCode: q.customerCode,
      inquiryId: q.id,
      inquiryNo: r.inquiryNo,
      extraction: [
        { key: 'customer', label: 'Customer / Party', value: q.customerName, confidence: 'high', required: true },
        { key: 'inquiryNo', label: 'Inquiry Number', value: r.inquiryNo, confidence: 'high', required: true },
        { key: 'product', label: 'Products / Items', value: q.items.map((it) => it.description).join('; '), confidence: 'high', required: true },
        { key: 'quantity', label: 'Quantity', value: q.items.map((it) => `${it.quantity} ${it.unit}`).join('; '), confidence: 'high', required: true },
        { key: 'requestedDate', label: 'Requested Date', value: q.deliveryTerms, confidence: 'medium' },
      ],
      // Nothing pre-confirmed and nothing pre-drafted: the line-item review in
      // the inbox is the only thing that can clear this enquiry.
      extractionConfirmed: false,
      draftSaved: false,
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
          {r.quotationNo ? (
            <p className="truncate text-[11px] text-surface-400">{r.quotationNo}</p>
          ) : (
            <p className="truncate text-[11px] italic text-surface-400">Quotation not generated</p>
          )}
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      width: '146px',
      truncate: true,
      title: (r) => r.customerName,
      sortValue: (r) => r.customerName,
      render: (r) => (
        <div className="min-w-0 leading-tight">
          <p className="truncate font-medium text-surface-800">{r.customerName}</p>
          <p className="truncate text-[11px] text-surface-400">{r.customerCode}</p>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      width: '114px',
      truncate: true,
      title: (r) => officeName(r.officeId),
      sortValue: (r) => officeName(r.officeId),
      render: (r) => (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-surface-700">{officeName(r.officeId)}</p>
          <p className="truncate text-[11px] text-surface-400">{officeCode(r.officeId)}</p>
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
      sortValue: (r) => r.value ?? -1,
      render: (r) =>
        r.value === null ? (
          <span className="text-surface-400" title="Value is set when the quotation is generated">—</span>
        ) : (
          <span className="font-medium text-surface-800">{compactINR(r.value)}</span>
        ),
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
        title: 'No matching inquiries',
        message: 'Try adjusting the search or filters.',
        action: (
          <Button size="sm" variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        ),
      }
    : { title: 'Nothing pending', message: 'Every inquiry has been quoted and sent. 🎉' };

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="Quotes Pending to be Sent"
          description="Every new inquiry lands here until its quotation is sent. Open one to review the extracted line items, generate the quote and send it."
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
        description="Every new inquiry lands here until its quotation is sent. Open one to review the extracted line items, generate the quote and send it."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Pending to be Sent' }]}
      />

      {overdueCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] text-rose-700">
          <AlertCircle className="h-4 w-4 flex-none" />
          <span className="font-medium">
            {overdueCount} inquir{overdueCount > 1 ? 'ies are' : 'y is'} overdue.
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
            rowKey={(r) => r.key}
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
                <MobileCard key={r.key} row={r} onOpen={() => openInbox(r)} canOpen={canOpen} />
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
          <p className="truncate text-[12px] text-surface-500">{row.customerName}</p>
          <p className="truncate text-[11px] text-surface-400">
            {row.quotationNo ?? <span className="italic">Quotation not generated</span>}
          </p>
        </div>
        <span className="flex-none font-semibold text-surface-800">
          {row.value === null ? <span className="text-surface-400">—</span> : compactINR(row.value)}
        </span>
      </div>
      <div className="space-y-1.5 rounded-lg bg-surface-50 px-3 py-2">
        <Field label="Location">{officeName(row.officeId)}</Field>
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
