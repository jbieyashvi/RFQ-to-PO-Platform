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
import { classNames, compactINR } from '@/lib/format';
import { inquiryNumberFor } from '@/lib/inquiry';
import { usePaginated, useSimulatedLoading } from '@/lib/hooks';
import {
  DAY,
  NOW,
  REV_DUE_OFFSET_MINUTES,
  REV_UNASSIGNED_AT,
  buildRequestedChanges,
  dueStateFor,
  fmtDate,
  fmtDateTime,
  fmtTime,
  type DueState,
} from '@/lib/revisionQueue';

interface RevisionRow {
  q: Quotation;
  inquiryNo: string;
  owner: string; // '' → Unassigned
  requestedAt: string; // ISO — when the customer's revision request entered the queue
  dueAt: string; // ISO — requestedAt + exactly 24h
  state: DueState;
  overdueLabel?: string;
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

function officeEmail(officeId: string) {
  const city = officeName(officeId).split(' ')[0].toLowerCase();
  return `sales.${city}@flowtech-instruments.com`;
}

export default function QuotesRevisions() {
  const { quotations, parties, emails, can, addEmail } = useApp();
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const navigate = useNavigate();
  const loading = useSimulatedLoading([]);

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [location, setLocation] = useState('');
  const [valueBucket, setValueBucket] = useState('');
  const [dueState, setDueState] = useState('');

  // Base revision queue (scoped), enriched into view-model rows.
  const rows = useMemo<RevisionRow[]>(() => {
    const queue = quotations
      .filter((q) => q.workState === 'needs_revision' && inScope(q.officeId))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    return queue.map((q, i) => {
      const dueMs = NOW.getTime() + REV_DUE_OFFSET_MINUTES[i % REV_DUE_OFFSET_MINUTES.length] * 60 * 1000;
      const dueAt = new Date(dueMs);
      const requestedAt = new Date(dueMs - DAY);
      const { state, overdueLabel } = dueStateFor(dueMs);
      return {
        q,
        inquiryNo: inquiryNumberFor(q),
        owner: i === REV_UNASSIGNED_AT ? '' : q.owner,
        requestedAt: requestedAt.toISOString(),
        dueAt: dueAt.toISOString(),
        state,
        overdueLabel,
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

  // Open the revision's linked Global Inbox conversation — selecting the CORRECT
  // customer-revision email for THIS inquiry (not the first inbox email). Nothing
  // is sent; the Quote Generator opens for human review before "Send Revised Quote".
  const openInbox = (r: RevisionRow) => {
    const q = r.q;
    const existing = emails.find((e) => e.revisionSendId === q.id && !e.sent);
    if (existing) {
      navigate(`/inbox?mode=quote-revision&qtn=${q.id}&email=${existing.id}`);
      return;
    }
    const id = `em-rev-${q.id}`;
    if (!emails.some((e) => e.id === id)) addEmail(buildRevisionEmail(q, r, id));
    navigate(`/inbox?mode=quote-revision&qtn=${q.id}&email=${id}`);
  };

  const buildRevisionEmail = (q: Quotation, r: RevisionRow, id: string): InboxEmail => {
    const party = parties.find((p) => p.id === q.partyId);
    const to = party?.email ?? 'procurement@customer.com';
    const from = officeEmail(q.officeId);
    const changes = buildRequestedChanges(q, rows.findIndex((x) => x.q.id === q.id));
    const changeLines = changes.map((c) => `• ${c.label}: ${c.oldValue} → ${c.newValue}`).join('\n');
    const contact = party?.contactPerson ?? 'Procurement';
    return {
      id,
      senderName: contact,
      senderEmail: to,
      recipient: from,
      cc: [],
      subject: `RE: Quotation ${q.number} — revision requested (${r.inquiryNo})`,
      receivedAt: r.requestedAt.slice(0, 19),
      body: `Dear ${q.owner.split(' ')[0]},\n\nThank you for quotation ${q.number}. Before we can release the PO, we need the following changes:\n\n${changeLines}\n\nPlease share a revised quotation reflecting the above. Rest of the scope stays unchanged.\n\nRegards,\n${contact}\n${q.customerName}`,
      thread: [
        { id: `th-${q.id}-1`, from: q.owner, date: `${q.quoteDate}T16:45:00`, snippet: `Sharing our quotation ${q.number} for your review…` },
      ],
      classification: 'quotation_revision',
      aiConfidence: 92,
      read: true,
      needsReview: true,
      officeId: q.officeId,
      owner: q.owner,
      partyId: q.partyId,
      customerName: q.customerName,
      customerCode: q.customerCode,
      linkedQuotation: q.number,
      revisionSendId: q.id,
      inquiryNo: r.inquiryNo,
      queueLabel: 'Quote Needs Revision',
      requestedChanges: changes,
      reviewDate: q.reviewDate,
      extraction: [
        { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
        { key: 'inquiry', label: 'Inquiry Number', value: r.inquiryNo, confidence: 'high', required: true },
        { key: 'quotation', label: 'Quotation Number', value: q.number, confidence: 'high', required: true },
        { key: 'changes', label: 'Changes Requested', value: changes.map((c) => c.label).join('; '), confidence: 'high', required: true },
      ],
      extractionConfirmed: true,
      draftSaved: false,
      sent: false,
    };
  };

  const canOpen = can('quotations', 'view');

  const columns: Column<RevisionRow>[] = [
    {
      key: 'inquiry',
      header: 'Inquiry No.',
      sticky: 'left',
      width: '176px',
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
      width: '150px',
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
      key: 'requested',
      header: 'Revision Requested',
      width: '124px',
      sortValue: (r) => r.requestedAt,
      render: (r) => (
        <div className="leading-tight">
          <p className="whitespace-nowrap text-surface-700">{fmtDate(r.requestedAt)}</p>
          <p className="text-[11px] text-surface-400">{fmtTime(r.requestedAt)}</p>
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
        title: 'No matching revisions',
        message: 'Try adjusting the search or filters.',
        action: (
          <Button size="sm" variant="secondary" onClick={clearFilters}>
            Clear filters
          </Button>
        ),
      }
    : { title: 'No revisions pending', message: 'Every customer-requested change has been resolved. 🎉' };

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="Quotes Needing Revision"
          description="Customer-requested quotation changes awaiting review and resubmission."
          crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Needing Revision' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Quotes Needing Revision"
        description="Customer-requested quotation changes awaiting review and resubmission."
        crumbs={[{ label: 'Sales Quotations' }, { label: 'Quotes Needing Revision' }]}
      />

      {overdueCount > 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[13px] text-rose-700">
          <AlertCircle className="h-4 w-4 flex-none" />
          <span className="font-medium">
            {overdueCount} quotation revision{overdueCount > 1 ? 's are' : ' is'} overdue.
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
            <span className="font-semibold text-surface-800">{filtered.length}</span> to revise
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

        {!loading && total > pageSize && (
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

function DueCell({ row }: { row: RevisionRow }) {
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

function MobileCard({ row, onOpen, canOpen }: { row: RevisionRow; onOpen: () => void; canOpen: boolean }) {
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
        <Field label="Revision Requested">{fmtDateTime(row.requestedAt)}</Field>
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
