import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ArrowLeft, MailOpen } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { SearchInput, FilterSelect, EmptyState } from '@/components/ui';
import { Tabs } from '@/components/ui/misc';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { OWNERS } from '@/data/users';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import type { EmailClassification, InboxEmail } from '@/types';
import { classNames } from '@/lib/format';
import { confidenceBucket } from './helpers';
import { EmailList } from './EmailList';
import { EmailCenter } from './EmailCenter';
import { EmailActionPanel } from './EmailActionPanel';

type Tab = 'all' | 'needs_review' | 'drafts' | 'sent';

export default function GlobalInbox() {
  const { emails, role, updateEmail } = useApp();
  const inScope = useOfficeScope();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('');
  const [office, setOffice] = useState('');
  const [owner, setOwner] = useState('');
  const [readState, setReadState] = useState('');
  const [confidence, setConfidence] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');

  const scoped = useMemo(() => emails.filter((e) => inScope(e.officeId)), [emails, inScope]);

  const tabCounts = useMemo(
    () => ({
      all: scoped.length,
      needs_review: scoped.filter((e) => e.needsReview && !e.sent).length,
      drafts: scoped.filter((e) => e.draftSaved && !e.sent).length,
      sent: scoped.filter((e) => e.sent).length,
    }),
    [scoped]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return scoped
      .filter((e) => {
        if (tab === 'needs_review' && !(e.needsReview && !e.sent)) return false;
        if (tab === 'drafts' && !(e.draftSaved && !e.sent)) return false;
        if (tab === 'sent' && !e.sent) return false;
        if (classification && e.classification !== classification) return false;
        if (office && e.officeId !== office) return false;
        if (owner && e.owner !== owner) return false;
        if (readState === 'unread' && (e.read || e.sent)) return false;
        if (readState === 'read' && !e.read && !e.sent) return false;
        if (confidence && confidenceBucket(e.aiConfidence) !== confidence) return false;
        const d = (e.sent && e.sentAt ? e.sentAt : e.receivedAt).slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        if (
          s &&
          !`${e.senderName} ${e.senderEmail} ${e.subject} ${e.customerName ?? ''} ${e.customerCode ?? ''} ${e.linkedQuotation ?? ''} ${e.linkedPO ?? ''} ${e.linkedSO ?? ''}`
            .toLowerCase()
            .includes(s)
        )
          return false;
        return true;
      })
      .sort((a, b) => ((a.sent && a.sentAt ? a.sentAt : a.receivedAt) < (b.sent && b.sentAt ? b.sentAt : b.receivedAt) ? 1 : -1));
  }, [scoped, tab, search, classification, office, owner, readState, confidence, dateFrom, dateTo]);

  // Deep-link: ?email=<id> (used by "Review & Send Email" from Quotes Pending)
  useEffect(() => {
    const id = params.get('email');
    if (id && emails.some((e) => e.id === id)) {
      setTab('all');
      setSelectedId(id);
      setMobileView('detail');
      const e = emails.find((x) => x.id === id);
      if (e && !e.read) updateEmail(id, { read: true });
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a valid selection
  useEffect(() => {
    if (selectedId && filtered.some((e) => e.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  const selected: InboxEmail | null = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId]
  );

  const onSelect = (id: string) => {
    setSelectedId(id);
    setMobileView('detail');
    const e = emails.find((x) => x.id === id);
    if (e && !e.read) updateEmail(id, { read: true });
  };

  const hasFilters = search || classification || office || owner || readState || confidence || dateFrom || dateTo;
  const clearFilters = () => {
    setSearch(''); setClassification(''); setOffice(''); setOwner(''); setReadState(''); setConfidence(''); setDateFrom(''); setDateTo('');
  };

  return (
    <>
      <PageHeader
        title="Global Inbox"
        description="AI classifies, extracts and drafts. Every outgoing email is human-reviewed and approved before sending."
        crumbs={[{ label: 'Global Inbox' }]}
      />

      <div className="card mb-4">
        {/* Tabs */}
        <div className="px-4 pt-2">
          <Tabs
            active={tab}
            onChange={(k) => setTab(k as Tab)}
            tabs={[
              { key: 'all', label: 'All Emails', count: tabCounts.all },
              { key: 'needs_review', label: 'Needs Review', count: tabCounts.needs_review },
              { key: 'drafts', label: 'Drafts', count: tabCounts.drafts },
              { key: 'sent', label: 'Sent', count: tabCounts.sent },
            ]}
          />
        </div>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-t border-surface-100 p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search sender, subject, customer, QTN / PO no…" className="w-full sm:w-80" />
          <FilterSelect value={classification} onChange={setClassification} placeholder="All classifications" options={(Object.keys(INBOX_CLASSIFICATION) as EmailClassification[]).map((c) => ({ value: c, label: INBOX_CLASSIFICATION[c].label }))} />
          <FilterSelect value={confidence} onChange={setConfidence} placeholder="Any AI confidence" options={[{ value: 'high', label: 'High confidence' }, { value: 'medium', label: 'Medium confidence' }, { value: 'low', label: 'Low confidence' }]} />
          <FilterSelect value={readState} onChange={setReadState} placeholder="Read & Unread" options={[{ value: 'unread', label: 'Unread' }, { value: 'read', label: 'Read' }]} />
          {role === 'super_admin' && <FilterSelect value={office} onChange={setOffice} placeholder="All offices" options={OFFICES.map((o) => ({ value: o.id, label: o.name }))} />}
          <FilterSelect value={owner} onChange={setOwner} placeholder="All owners" options={OWNERS.map((o) => ({ value: o, label: o }))} />
          <input type="date" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input h-9 w-auto py-1.5 text-sm" title="From date" />
          <input type="date" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input h-9 w-auto py-1.5 text-sm" title="To date" />
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs font-semibold text-surface-500 hover:text-brand-600 hover:underline">Clear filters</button>
          )}
          <span className="ml-auto text-xs text-surface-500"><span className="font-semibold text-surface-800">{filtered.length}</span> email{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Three-panel workspace */}
      <div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-268px)] lg:min-h-[520px] lg:grid-cols-[336px_minmax(0,1fr)_400px]">
        {/* Left: list */}
        <div className={classNames('card overflow-hidden lg:flex lg:flex-col', mobileView === 'detail' && 'hidden lg:flex')}>
          <div className="flex-1 overflow-y-auto">
            <EmailList emails={filtered} selectedId={selectedId} onSelect={onSelect} />
          </div>
        </div>

        {/* Center + Right */}
        {selected ? (
          <>
            <div className={classNames('card overflow-hidden lg:flex lg:flex-col', mobileView === 'list' && 'hidden lg:flex')}>
              <button
                onClick={() => setMobileView('list')}
                className="flex flex-none items-center gap-1.5 border-b border-surface-100 px-4 py-2 text-[13px] font-medium text-brand-600 lg:hidden"
              >
                <ArrowLeft className="h-4 w-4" /> Back to list
              </button>
              <div className="min-h-0 flex-1">
                <EmailCenter email={selected} />
              </div>
            </div>
            <div className={classNames('card overflow-hidden lg:flex lg:flex-col', mobileView === 'list' && 'hidden lg:flex')}>
              <div className="min-h-0 flex-1">
                <EmailActionPanel email={selected} />
              </div>
            </div>
          </>
        ) : (
          <div className="card hidden items-center justify-center lg:col-span-2 lg:flex">
            <EmptyState icon={<MailOpen className="h-7 w-7" />} title="No email selected" message="Select an email from the list to view its details, AI extraction and the reply composer." />
          </div>
        )}
      </div>

      {/* subtle icon reference so Inbox import is used when list is empty on mobile */}
      {filtered.length === 0 && mobileView === 'list' && (
        <div className="mt-4 flex justify-center text-surface-300 lg:hidden">
          <Inbox className="h-6 w-6" />
        </div>
      )}
    </>
  );
}
