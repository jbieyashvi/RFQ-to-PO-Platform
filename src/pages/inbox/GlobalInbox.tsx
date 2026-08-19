import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ArrowLeft, MailOpen, FileText } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { SearchInput, FilterSelect, EmptyState } from '@/components/ui';
import { Tabs } from '@/components/ui/misc';
import { useApp, useOfficeScope } from '@/context/AppContext';
import { OWNERS } from '@/data/users';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import type { EmailClassification, InboxEmail } from '@/types';
import { classNames } from '@/lib/format';
import { confidenceBucket } from './helpers';
import { EmailList } from './EmailList';
import { EmailCenter } from './EmailCenter';
import { EmailActionPanel } from './EmailActionPanel';
import { InboxCenterPanel } from './InboxCenterPanel';
import { QuoteToolsPanel } from './QuoteToolsPanel';
import { RevisionQuotePanel } from './RevisionQuotePanel';
import { PoVerificationPanel } from './PoVerificationPanel';

type Tab = 'all' | 'needs_review' | 'drafts';

export default function GlobalInbox() {
  const { emails, updateEmail, quotations, sidebarCollapsed, setSidebarCollapsed } = useApp();
  // Office scope still applies in the background (a user only sees emails for
  // offices they may access) — but there is no office FILTER on this screen.
  const inScope = useOfficeScope();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('');
  const [owner, setOwner] = useState('');
  const [readState, setReadState] = useState('');
  const [confidence, setConfidence] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Initialise the selection from the deep-link (?email=<id>) so opening an
  // inquiry from "Quotes Pending" lands on the CORRECT conversation — not the
  // first email. Without this, the keep-valid effect below would overwrite a
  // late-set selection with filtered[0].
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const id = params.get('email');
    return id && emails.some((e) => e.id === id) ? id : null;
  });
  const [mobileView, setMobileView] = useState<'list' | 'detail'>(() =>
    params.get('email') ? 'detail' : 'list'
  );

  // Focused quote-send mode — carried in from "Quotes Pending" via
  // ?mode=quote-send&qtn=<quotationId>. It stays scoped to the ONE deep-linked
  // email + quotation, so browsing to other emails shows normal inbox tools.
  const [quoteSend, setQuoteSend] = useState<{ emailId: string; qtnId: string } | null>(() => {
    const mode = params.get('mode');
    const emailId = params.get('email');
    const qtnId = params.get('qtn');
    return mode === 'quote-send' && emailId && qtnId ? { emailId, qtnId } : null;
  });

  // Auto-optimise the workspace: collapse the app sidebar to its icon rail while
  // the inbox is open, then restore the user's previous state on leaving.
  const restoreSidebarRef = useRef(sidebarCollapsed);
  useEffect(() => {
    const restore = restoreSidebarRef.current;
    setSidebarCollapsed(true);
    return () => setSidebarCollapsed(restore);
  }, [setSidebarCollapsed]);

  const scoped = useMemo(() => emails.filter((e) => inScope(e.officeId)), [emails, inScope]);

  const tabCounts = useMemo(
    () => ({
      // "All Emails" is the full history the user can access — sent emails
      // included (for audit), so there is no separate Sent tab.
      all: scoped.length,
      needs_review: scoped.filter((e) => e.needsReview && !e.sent).length,
      drafts: scoped.filter((e) => e.draftSaved && !e.sent).length,
    }),
    [scoped]
  );

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return scoped
      .filter((e) => {
        if (tab === 'needs_review' && !(e.needsReview && !e.sent)) return false;
        if (tab === 'drafts' && !(e.draftSaved && !e.sent)) return false;
        if (classification && e.classification !== classification) return false;
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
  }, [scoped, tab, search, classification, owner, readState, confidence, dateFrom, dateTo]);

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

  // Quote-send tools appear ONLY on the specific deep-linked email, and only
  // when its passed quotation is resolvable and scoped to the same customer.
  const isQuoteSend = !!quoteSend && !!selected && selected.id === quoteSend.emailId;
  const quoteSendQuotation = useMemo(() => {
    if (!isQuoteSend || !quoteSend) return null;
    const q = quotations.find((x) => x.id === quoteSend.qtnId) ?? null;
    // Guard §4: never let a quotation belonging to another customer be opened.
    if (q && selected?.partyId && q.partyId !== selected.partyId) return null;
    return q;
  }, [isQuoteSend, quoteSend, quotations, selected]);

  const showQuoteTools = isQuoteSend && !!quoteSendQuotation;

  const onSelect = (id: string) => {
    setSelectedId(id);
    setMobileView('detail');
    const e = emails.find((x) => x.id === id);
    if (e && !e.read) updateEmail(id, { read: true });
  };

  const hasFilters = search || classification || owner || readState || confidence || dateFrom || dateTo;
  const clearFilters = () => {
    setSearch(''); setClassification(''); setOwner(''); setReadState(''); setConfidence(''); setDateFrom(''); setDateTo('');
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
            ]}
          />
        </div>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 border-t border-surface-100 p-3">
          <SearchInput value={search} onChange={setSearch} placeholder="Search sender, subject, customer, QTN / PO no…" className="w-full sm:w-80" />
          <FilterSelect value={classification} onChange={setClassification} placeholder="All classifications" options={(Object.keys(INBOX_CLASSIFICATION) as EmailClassification[]).map((c) => ({ value: c, label: INBOX_CLASSIFICATION[c].label }))} />
          <FilterSelect value={confidence} onChange={setConfidence} placeholder="Any AI confidence" options={[{ value: 'high', label: 'High confidence' }, { value: 'medium', label: 'Medium confidence' }, { value: 'low', label: 'Low confidence' }]} />
          <FilterSelect value={readState} onChange={setReadState} placeholder="Read & Unread" options={[{ value: 'unread', label: 'Unread' }, { value: 'read', label: 'Read' }]} />
          <FilterSelect value={owner} onChange={setOwner} placeholder="All owners" options={OWNERS.map((o) => ({ value: o, label: o }))} />
          <input type="date" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input h-9 w-auto py-1.5 text-sm" title="From date" />
          <input type="date" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input h-9 w-auto py-1.5 text-sm" title="To date" />
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs font-semibold text-surface-500 hover:text-brand-600 hover:underline">Clear filters</button>
          )}
          <span className="ml-auto text-xs text-surface-500"><span className="font-semibold text-surface-800">{filtered.length}</span> email{filtered.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Connected three-panel workspace — one surface, vertical dividers, no
          gaps. The fr ratios (0.55 / 1 / 0.95 ≈ 22% / 40% / 38%) put the
          reading + writing centre panel widest, matching the PM layout: narrow
          list · widest read+compose · quote/action tools. Enabled at ≥1180px;
          below that we fall back to progressive list → detail navigation so the
          panels never squeeze or scroll sideways. */}
      <div
        className={classNames(
          'grid grid-cols-1 gap-4',
          'min-[1180px]:h-[calc(100vh-268px)] min-[1180px]:min-h-[520px] min-[1180px]:gap-0',
          'min-[1180px]:overflow-hidden min-[1180px]:rounded-xl min-[1180px]:border min-[1180px]:border-surface-200 min-[1180px]:bg-white min-[1180px]:shadow-card',
          'min-[1180px]:grid-cols-[minmax(220px,0.55fr)_minmax(330px,1fr)_minmax(310px,0.95fr)]'
        )}
      >
        {/* Left: email list — narrowest, compact, subtly muted, divider on right */}
        <div
          className={classNames(
            'card overflow-hidden min-[1180px]:flex min-[1180px]:flex-col',
            'min-[1180px]:rounded-none min-[1180px]:border-0 min-[1180px]:border-r min-[1180px]:border-surface-200 min-[1180px]:bg-surface-50/40 min-[1180px]:shadow-none',
            mobileView === 'detail' && 'hidden min-[1180px]:flex'
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmailList emails={filtered} selectedId={selectedId} onSelect={onSelect} />
          </div>
        </div>

        {/* Center + Right */}
        {selected ? (
          <>
            {/* Center: reading panel — comfortable width, divider on right */}
            <div
              className={classNames(
                'card overflow-hidden min-[1180px]:flex min-[1180px]:flex-col',
                'min-[1180px]:rounded-none min-[1180px]:border-0 min-[1180px]:border-r min-[1180px]:border-surface-200 min-[1180px]:bg-white min-[1180px]:shadow-none',
                mobileView === 'list' && 'hidden min-[1180px]:flex'
              )}
            >
              <button
                onClick={() => setMobileView('list')}
                className="flex flex-none items-center gap-1.5 border-b border-surface-100 px-4 py-2 text-[13px] font-medium text-brand-600 min-[1180px]:hidden"
              >
                <ArrowLeft className="h-4 w-4" /> Back to list
              </button>
              {showQuoteTools && (
                <div className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-[12px] font-medium text-brand-700">
                  <FileText className="h-3.5 w-3.5" /> Quote-send mode — {quoteSendQuotation!.number}
                </div>
              )}
              <div className="min-h-0 flex-1">
                {showQuoteTools ? (
                  <InboxCenterPanel email={selected} quoteSend quotation={quoteSendQuotation} />
                ) : selected.revisionSendId || selected.poVerifyId ? (
                  <EmailCenter email={selected} />
                ) : (
                  <InboxCenterPanel email={selected} />
                )}
              </div>
            </div>
            {/* Right: quote tools / business action — dedicated workflow surface */}
            <div
              className={classNames(
                'card overflow-hidden min-[1180px]:flex min-[1180px]:flex-col',
                'min-[1180px]:rounded-none min-[1180px]:border-0 min-[1180px]:bg-white min-[1180px]:shadow-none',
                mobileView === 'list' && 'hidden min-[1180px]:flex'
              )}
            >
              <div className="min-h-0 flex-1">
                {showQuoteTools ? (
                  <QuoteToolsPanel email={selected} quotation={quoteSendQuotation!} />
                ) : selected.revisionSendId ? (
                  <RevisionQuotePanel email={selected} />
                ) : selected.poVerifyId ? (
                  <PoVerificationPanel email={selected} />
                ) : (
                  <EmailActionPanel email={selected} />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="card hidden items-center justify-center min-[1180px]:col-span-2 min-[1180px]:flex min-[1180px]:rounded-none min-[1180px]:border-0 min-[1180px]:shadow-none">
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
