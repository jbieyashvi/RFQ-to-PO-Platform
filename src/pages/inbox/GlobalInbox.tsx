import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ArrowLeft, Building2, FileText, RefreshCw, ClipboardCheck, FilePenLine, Link2, SlidersHorizontal, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { SearchInput, FilterSelect, FilterBar, type FilterChip } from '@/components/ui';
import { Tabs } from '@/components/ui/misc';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { OWNERS } from '@/data/users';
import { inquiryById, inquiryEmailsOf, inquiryIdOfEmail } from '@/lib/inquiry';
import { inboxParams, type InboxMode } from '@/lib/inboxContext';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import type { EmailClassification, InboxEmail } from '@/types';
import { classNames } from '@/lib/format';
import { EmailList, EmailIconRail } from './EmailList';
import { SoGenerationDrawer } from './SoGenerationDrawer';
import { EmailActionPanel } from './EmailActionPanel';
import { InboxCenterPanel } from './InboxCenterPanel';
import { InquiryHeader } from './InquiryHeader';
import { QuoteToolsPanel } from './QuoteToolsPanel';
import { RevisionQuotePanel } from './RevisionQuotePanel';
import { PoVerificationPanel } from './PoVerificationPanel';
import { PoAssociationPanel } from './PoAssociationPanel';
import { SoRevisionPanel } from './SoRevisionPanel';
import {
  associationEmailPatch,
  buildVerificationSalesOrder,
  findQuotationByNumber,
  quotationRefOf,
  verificationSoId,
} from '@/lib/poAssociation';

type Tab = 'all' | 'needs_review' | 'drafts';

export default function GlobalInbox() {
  const { emails, updateEmail, quotations, salesOrders, parties, addSalesOrder, addToast, sidebarCollapsed, setSidebarCollapsed } = useApp();
  // Office scope still applies in the background (a user only sees emails for
  // offices they may access) — but there is no office FILTER on this screen.
  const inScope = useOfficeScope();
  const noOffice = useNoOfficeAssigned();
  const [params, setParams] = useSearchParams();

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [classification, setClassification] = useState('');
  const [owner, setOwner] = useState('');
  const [readState, setReadState] = useState('');
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
    const mode = params.get('mode') as InboxMode | null;
    const emailId = params.get('email');
    const qtnId = params.get('qtn');
    return mode === 'quote-send' && emailId && qtnId ? { emailId, qtnId } : null;
  });

  // ---- The two inbox modes -------------------------------------------------
  //   1. Direct /inbox — NOTHING selected: just the Gmail-style list of every
  //      classified company email. No conversation, no workspace, no inquiry.
  //   2. An email is open (clicked in the list, or a workflow deep link) — the
  //      three-panel workspace: the selected customer's emails on the left, the
  //      conversation in the centre, its Quote / PO / SO workspace on the right.
  //      "Back to All Emails" returns to mode 1.
  //
  // Everything about mode 2 — company scope, inquiry, workflow — is derived
  // from the OPEN EMAIL, never from the query string alone. That is what keeps
  // one link honest: the ids in the route always describe one record, so the
  // inbox can never load one inquiry's email under another inquiry's id.
  const inquiryIdOf = useMemo(
    () => (e: InboxEmail) => inquiryIdOfEmail(e, quotations, salesOrders),
    [quotations, salesOrders]
  );

  // Bumped whenever a right-hand workspace PREPARES the centre composer (adds a
  // revised/corrected quote, drafts a PO-correction request). The centre panel
  // watches it to pull the freshly written draft in and scroll/focus itself.
  const [focusTick, setFocusTick] = useState(0);
  const onPrepared = () => setFocusTick((t) => t + 1);

  // SO Generation drawer + the manual/automatic email-list minimise. Opening
  // the drawer collapses the list to its icon rail so the selected thread stays
  // visible beside the drawer; closing restores whatever the user had before.
  const [soDrawerOpen, setSoDrawerOpen] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const prevListCollapsedRef = useRef(false);
  const openSoDrawer = () => {
    prevListCollapsedRef.current = listCollapsed;
    setListCollapsed(true);
    setSoDrawerOpen(true);
  };
  const closeSoDrawer = () => {
    setSoDrawerOpen(false);
    setListCollapsed(prevListCollapsedRef.current);
  };

  // Changing conversation while the drawer is open closes it (its form state
  // belongs to the previous email's Sales Order) and restores the list.
  useEffect(() => {
    if (soDrawerOpen) closeSoDrawer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Auto-optimise the workspace: collapse the app sidebar to its icon rail while
  // the inbox is open, then restore the user's previous state on leaving.
  const restoreSidebarRef = useRef(sidebarCollapsed);
  useEffect(() => {
    const restore = restoreSidebarRef.current;
    setSidebarCollapsed(true);
    return () => setSidebarCollapsed(restore);
  }, [setSidebarCollapsed]);

  const scoped = useMemo(() => emails.filter((e) => inScope(e.officeId)), [emails, inScope]);

  // The open conversation — the anchor of the whole contextual mode.
  const selected: InboxEmail | null = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId]
  );

  // Company scope: the customer of the OPEN email. Reading it off the email
  // (rather than off ?customerId) is what makes a mismatched link impossible —
  // the left panel always belongs to the conversation in the centre.
  const customerScopeId = selected?.partyId ?? null;
  const customer = useMemo(
    () => (customerScopeId ? parties.find((p) => p.id === customerScopeId) ?? null : null),
    [customerScopeId, parties]
  );

  // Inquiry context: likewise the inquiry of the OPEN email, so the header can
  // never describe a different record than the message below it.
  const inquiryScopeId = selected ? inquiryIdOf(selected) : null;
  const inquiry = useMemo(
    () => (inquiryScopeId ? inquiryById(inquiryScopeId, quotations) : null),
    [inquiryScopeId, quotations]
  );

  // Everything the LEFT panel may show: all companies on direct /inbox, only
  // the selected customer's emails in contextual mode. The tabs, the filters
  // and the list all count from this — never from the global total.
  const listScope = useMemo(
    () => (customerScopeId ? scoped.filter((e) => e.partyId === customerScopeId) : scoped),
    [scoped, customerScopeId]
  );

  const tabCounts = useMemo(
    () => ({
      // "All Emails" is the full history the user can access — sent emails
      // included (for audit), so there is no separate Sent tab.
      all: listScope.length,
      needs_review: listScope.filter((e) => e.needsReview && !e.sent).length,
      drafts: listScope.filter((e) => e.draftSaved && !e.sent).length,
    }),
    [listScope]
  );

  // The classified list — narrowed by the company while a conversation is open,
  // never by the inquiry (the company's whole mail stays reachable).
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return listScope
      .filter((e) => {
        if (tab === 'needs_review' && !(e.needsReview && !e.sent)) return false;
        if (tab === 'drafts' && !(e.draftSaved && !e.sent)) return false;
        if (classification && e.classification !== classification) return false;
        if (owner && e.owner !== owner) return false;
        if (readState === 'unread' && (e.read || e.sent)) return false;
        if (readState === 'read' && !e.read && !e.sent) return false;
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
  }, [listScope, tab, search, classification, owner, readState, dateFrom, dateTo]);

  // The open email's inquiry, used only to MARK its messages in the left list
  // (they are the company's own emails — never a second list of their own).
  const inquiryEmailIds = useMemo(
    () =>
      new Set(
        (inquiryScopeId ? inquiryEmailsOf(inquiryScopeId, scoped, quotations, salesOrders) : []).map((e) => e.id)
      ),
    [inquiryScopeId, scoped, quotations, salesOrders]
  );

  // Deep-link: ?email=<id> (+ optional ?mode=quote-send|quote-revision|
  // po-verification & qtn/po params) — used by "Review & Send Email" from Quotes
  // Pending, "Open in Inbox" from Quote Revisions, and "Verify" from PO
  // Verification. The params are intentionally LEFT in the URL so a reload lands
  // back on the same conversation with the same business context.
  useEffect(() => {
    const id = params.get('email');
    if (id && emails.some((e) => e.id === id)) {
      setTab('all');
      setSelectedId(id);
      setMobileView('detail');
      const e = emails.find((x) => x.id === id);
      if (e && !e.read) updateEmail(id, { read: true });
    } else if (id) {
      // The link points at an email this session does not have — the prototype
      // reseeds its data on every load, so the draft a workflow created before
      // a refresh is gone. Fall back to the direct inbox rather than leave the
      // route describing a conversation that is not on screen.
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-select when the ?email deep-link changes on an ALREADY-mounted inbox —
  // e.g. escalating a Sales Order revision to a Quote revision replaces the
  // search params in place (no remount), so the mount effect above never
  // re-fires. This keeps the selected conversation in sync with the URL.
  useEffect(() => {
    const id = params.get('email');
    if (id && id !== selectedId && emails.some((e) => e.id === id)) {
      setTab('all');
      setSelectedId(id);
      setMobileView('detail');
      const e = emails.find((x) => x.id === id);
      if (e && !e.read) updateEmail(id, { read: true });
    }
    // ?customerId and ?inquiryId are NOT applied from the route — they are read
    // back off the opened email below, so a link whose ids came from different
    // records can never put the inbox in a state its own email contradicts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Nothing is ever auto-selected: direct /inbox opens on the list alone, and a
  // selection only drops when the email itself disappears from the data. The
  // tabs and filters reshape the list; they never change the open conversation.
  useEffect(() => {
    if (selectedId && !emails.some((e) => e.id === selectedId)) setSelectedId(null);
  }, [emails, selectedId]);

  // Quote-send tools appear ONLY on the specific deep-linked email, and only
  // when its passed quotation really belongs to that email's own record.
  const isQuoteSend = !!quoteSend && !!selected && selected.id === quoteSend.emailId;
  const quoteSendQuotation = useMemo(() => {
    if (!isQuoteSend || !quoteSend) return null;
    const q = quotations.find((x) => x.id === quoteSend.qtnId) ?? null;
    if (!q) return null;
    // Guard §4: never let a quotation belonging to another customer be opened.
    if (selected?.partyId && q.partyId !== selected.partyId) return null;
    // …and never a quotation from a DIFFERENT inquiry of the same customer:
    // ?email=em-002&qtn=qtn-032 would otherwise put one inquiry's email beside
    // another inquiry's quotation. The email's own inquiry always wins.
    if (inquiryScopeId && q.id !== inquiryScopeId) return null;
    return q;
  }, [isQuoteSend, quoteSend, quotations, selected, inquiryScopeId]);

  const showQuoteTools = isQuoteSend && !!quoteSendQuotation;

  // A ?mode=quote-send whose quotation was rejected above is not carried around
  // as dead context — it is dropped, and the route is rewritten without it.
  useEffect(() => {
    if (isQuoteSend && !quoteSendQuotation) setQuoteSend(null);
  }, [isQuoteSend, quoteSendQuotation]);

  // Business context for the revision and PO-verification workflows is derived
  // directly from the selected email's own workflow ids, so it survives reloads
  // and manual navigation without depending on the deep-link query.
  const revisionQuotation = useMemo(
    () => (selected?.revisionSendId ? quotations.find((q) => q.id === selected.revisionSendId) ?? null : null),
    [selected, quotations]
  );
  const poSalesOrder = useMemo(
    () => (selected?.poVerifyId ? salesOrders.find((s) => s.id === selected.poVerifyId) ?? null : null),
    [selected, salesOrders]
  );
  const poQuote = useMemo(
    () => (poSalesOrder ? quotations.find((q) => q.id === poSalesOrder.quotationId) ?? null : null),
    [poSalesOrder, quotations]
  );
  // Sales Order Revision context — the SO being revised and its linked quotation.
  const soRevisionSalesOrder = useMemo(
    () => (selected?.soRevisionId ? salesOrders.find((s) => s.id === selected.soRevisionId) ?? null : null),
    [selected, salesOrders]
  );
  const soRevisionQuote = useMemo(
    () => (soRevisionSalesOrder ? quotations.find((q) => q.id === soRevisionSalesOrder.quotationId) ?? null : null),
    [soRevisionSalesOrder, quotations]
  );

  const isRevision = !showQuoteTools && !!selected?.revisionSendId;
  const isPoVerify = !showQuoteTools && !isRevision && !!selected?.poVerifyId;
  const isSoRevision = !showQuoteTools && !isRevision && !isPoVerify && !!selected?.soRevisionId && !!soRevisionSalesOrder;
  // A Purchase Order email with no verification SO yet — the quotation
  // association workflow (auto-match by number below, manual pick otherwise).
  const isPoAssociate =
    !showQuoteTools && !isRevision && !isPoVerify && !isSoRevision &&
    selected?.classification === 'purchase_order' && !selected?.poVerifyId;

  // Any dedicated business workflow occupying the right panel.
  const isWorkflowMode = showQuoteTools || isRevision || isPoVerify || isSoRevision || isPoAssociate;

  // Keep the URL describing the current conversation + its workflow so a reload
  // restores exactly what the user is looking at. Every param is derived from
  // the SAME email — the same context object the "Open" buttons build (see
  // src/lib/inboxContext.ts) — so the route can never mix two records' ids.
  const urlFor = (e: InboxEmail): Record<string, string> => {
    const ctx = { emailId: e.id, customerId: e.partyId ?? null, inquiryId: inquiryIdOf(e) };
    if (quoteSend && e.id === quoteSend.emailId)
      return inboxParams({ ...ctx, mode: 'quote-send', qtn: quoteSend.qtnId });
    if (e.revisionSendId) return inboxParams({ ...ctx, mode: 'quote-revision', qtn: e.revisionSendId });
    if (e.poVerifyId) {
      const so = salesOrders.find((s) => s.id === e.poVerifyId);
      return inboxParams({ ...ctx, mode: 'po-verification', po: so?.poNumber, qtn: so?.quotationNumber });
    }
    if (e.soRevisionId) {
      const so = salesOrders.find((s) => s.id === e.soRevisionId);
      return inboxParams({ ...ctx, mode: 'so-revision', so: so?.number });
    }
    return inboxParams(ctx);
  };

  // Normalise the WHOLE route to the OPEN EMAIL's own context, so every param
  // — customer, inquiry, mode and business document — describes the one record
  // in the centre. A deep link that paired one record's ids with another's
  // (?email=em-002&inquiryId=qtn-032) is corrected here on arrival: the inbox
  // never adopts the wrong inquiry, so it never silently switches away from one.
  useEffect(() => {
    if (!selected) return;
    const want = urlFor(selected);
    const cur: Record<string, string> = {};
    params.forEach((v, k) => { cur[k] = v; });
    const keys = new Set([...Object.keys(cur), ...Object.keys(want)]);
    const drift = [...keys].filter((k) => cur[k] !== want[k]);
    if (!drift.length) return;
    const wrong = drift.filter((k) => cur[k] !== undefined && want[k] !== undefined);
    if (wrong.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[inbox] link context does not match ${selected.id}: ` +
          wrong.map((k) => `${k}=${cur[k]} → ${want[k]}`).join(', ')
      );
    }
    setParams(want, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, customerScopeId, inquiryScopeId, quoteSend, salesOrders, params, setParams]);

  // LAYOUT ONLY: a workflow conversation that belongs to NO inquiry opens with
  // the email list collapsed to its icon rail, giving the saved width to the
  // thread and the business workspace. Inside an inquiry the full list always
  // stays open — the inbox is never traded away for a single conversation. The
  // collapse is remembered as "automatic" so leaving workflow mode restores the
  // list; a manual toggle (Show / Hide Emails) always wins over it.
  const autoCollapsedRef = useRef(false);
  const workflowEmailRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    if (isWorkflowMode) {
      if (workflowEmailRef.current !== selected.id) {
        // The email is marked as handled either way, so that later dropping the
        // grouping ("Back to All Emails") on the SAME conversation never
        // collapses the list the user just asked to go back to.
        workflowEmailRef.current = selected.id;
        // Read the inquiry off the SELECTED email, not off the grouping state:
        // the state lands one render later, and by then the list would already
        // have been collapsed for an email that does belong to an inquiry.
        if (!inquiryScopeId) {
          autoCollapsedRef.current = true;
          setListCollapsed(true);
        }
      }
    } else {
      workflowEmailRef.current = null;
      if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        setListCollapsed(false);
      }
    }
  }, [selected, isWorkflowMode, inquiryScopeId]);

  const toggleList = () => {
    autoCollapsedRef.current = false;
    setListCollapsed((v) => !v);
  };

  // Automatic association by quotation number: if the number cited in the PO
  // exists in the register (for the same customer), associate it and open the
  // PO vs Quote verification thread directly. Customer name alone NEVER
  // auto-associates — without an exact number match the manual panel shows.
  const autoAssociatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selected || selected.classification !== 'purchase_order' || selected.poVerifyId) return;
    const ref = quotationRefOf(selected);
    if (!ref) return;
    const quote = findQuotationByNumber(ref, quotations, selected.partyId);
    if (!quote) return;
    const soId = verificationSoId(selected.id);
    // Guards the StrictMode double-run and re-selection of the same email.
    if (autoAssociatedRef.current.has(soId)) return;
    autoAssociatedRef.current.add(soId);
    let so = salesOrders.find((s) => s.id === soId);
    if (!so) {
      so = buildVerificationSalesOrder({
        email: selected,
        quote,
        parties,
        salesOrders,
        association: { kind: 'number_match', by: 'System (AI)' },
      });
      addSalesOrder(so);
    }
    updateEmail(selected.id, associationEmailPatch(selected, quote, so));
    addToast({
      type: 'info',
      title: 'Quotation matched',
      message: `${quote.number} matched by the quotation number cited in ${selected.linkedPO ?? 'the PO'} — verification opened.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, quotations, salesOrders]);

  // "Back to All Emails" — leave the workspace for the direct Global Inbox:
  // no conversation, no company scope, no workspace, just the Gmail-style list
  // of every classified email again.
  const exitToInbox = () => {
    setSelectedId(null);
    setQuoteSend(null);
    setMobileView('list');
    setParams({}, { replace: true });
  };

  const onSelect = (id: string) => {
    setSelectedId(id);
    setMobileView('detail');
    const e = emails.find((x) => x.id === id);
    if (e) {
      setParams(urlFor(e), { replace: true });
      if (!e.read) updateEmail(id, { read: true });
    }
  };

  const clearFilters = () => {
    setSearch(''); setClassification(''); setOwner(''); setReadState(''); setDateFrom(''); setDateTo('');
  };

  // Read/Unread, Owner and the date range live inside the "More Filters" popover;
  // the count keeps the button honest about how many are active behind it.
  const moreCount = (readState ? 1 : 0) + (owner ? 1 : 0) + (dateFrom || dateTo ? 1 : 0);

  // Active filters render as small removable chips beneath the toolbar.
  const chips: FilterChip[] = [];
  if (search) chips.push({ key: 'q', label: `Search: “${search}”`, onRemove: () => setSearch('') });
  if (classification)
    chips.push({ key: 'c', label: `Type: ${INBOX_CLASSIFICATION[classification as EmailClassification].label}`, onRemove: () => setClassification('') });
  if (readState) chips.push({ key: 'r', label: readState === 'unread' ? 'Unread' : 'Read', onRemove: () => setReadState('') });
  if (owner) chips.push({ key: 'o', label: `Owner: ${owner}`, onRemove: () => setOwner('') });
  if (dateFrom || dateTo)
    chips.push({ key: 'd', label: `Date: ${dateFrom || '…'} → ${dateTo || '…'}`, onRemove: () => { setDateFrom(''); setDateTo(''); } });

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="Global Inbox"
          description="AI classifies, extracts and drafts. Every outgoing email is human-reviewed and approved before sending."
          crumbs={[{ label: 'Global Inbox' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Global Inbox"
        description="AI classifies, extracts and drafts. Every outgoing email is human-reviewed and approved before sending."
        crumbs={[{ label: 'Global Inbox' }]}
      />

      {/* The inbox toolbar is always present. Direct /inbox lists the
          classified emails of every company; contextual mode narrows the list
          to the selected customer (tabs, filters and counts follow it). The
          inquiry grouping stays additive on top — a bundle above the
          conversation, never a replacement for the list. */}
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
        {/* Filters — default toolbar is Search · Classification · More Filters.
            Read/Unread, Owner and the date range live in the popover to keep the
            bar short; active filters surface as removable chips below. */}
        <div className="border-t border-surface-100 px-3 py-2.5">
          <FilterBar
            chips={chips}
            onClearAll={chips.length ? clearFilters : undefined}
            right={
              <span className="text-[12px] text-surface-500">
                <span className="font-semibold text-surface-800">{filtered.length}</span> email{filtered.length === 1 ? '' : 's'}
              </span>
            }
          >
            <SearchInput value={search} onChange={setSearch} placeholder="Search sender, subject, customer, QTN / PO no…" className="w-full sm:w-72" />
            <FilterSelect value={classification} onChange={setClassification} placeholder="All classifications" options={(Object.keys(INBOX_CLASSIFICATION) as EmailClassification[]).map((c) => ({ value: c, label: INBOX_CLASSIFICATION[c].label }))} />
            <MoreFiltersPopover
              count={moreCount}
              readState={readState}
              onReadState={setReadState}
              owner={owner}
              onOwner={setOwner}
              dateFrom={dateFrom}
              onDateFrom={setDateFrom}
              dateTo={dateTo}
              onDateTo={setDateTo}
            />
          </FilterBar>
        </div>
      </div>

      {/* MODE 1 — direct /inbox: one full-width column, the Gmail-style list of
          every classified email and nothing else.
          MODE 2 — an email is open: the connected three-panel workspace — one
          surface, vertical dividers, no gaps. The fr ratios (0.55 / 0.95 / 1 ≈
          22% / 38% / 40%) make the right business-workspace panel — the primary
          task area — widest: narrow list · read+compose · widest quote/action
          tools. Enabled at ≥1180px; below that we fall back to progressive
          list → detail navigation so the panels never squeeze or scroll
          sideways. */}
      <div
        className={classNames(
          'grid grid-cols-1 gap-4',
          'min-[1180px]:h-[calc(100vh-250px)] min-[1180px]:min-h-[520px] min-[1180px]:gap-0',
          'min-[1180px]:overflow-hidden min-[1180px]:rounded-xl min-[1180px]:border min-[1180px]:border-surface-200 min-[1180px]:bg-white min-[1180px]:shadow-card',
          // Collapsed → the left column shrinks to a 56px icon rail so the
          // thread + workspace keep maximum width beside the SO drawer.
          !selected
            ? 'min-[1180px]:grid-cols-1'
            : listCollapsed
            ? 'min-[1180px]:grid-cols-[56px_minmax(320px,0.95fr)_minmax(340px,1fr)]'
            : 'min-[1180px]:grid-cols-[minmax(220px,0.55fr)_minmax(320px,0.95fr)_minmax(340px,1fr)]'
        )}
      >
        {/* Left: email list — narrowest, compact, subtly muted, divider on right.
            Collapsible to a compact icon rail (auto while the SO Generation
            drawer is open; manually via the toggle). Collapse only exists at
            desktop widths — mobile always gets the full list. */}
        <div
          className={classNames(
            'card overflow-hidden min-[1180px]:flex min-[1180px]:flex-col',
            'min-[1180px]:rounded-none min-[1180px]:border-0 min-[1180px]:shadow-none',
            selected
              ? 'min-[1180px]:border-r min-[1180px]:border-surface-200 min-[1180px]:bg-surface-50/40'
              : 'min-[1180px]:bg-white',
            mobileView === 'detail' && 'hidden min-[1180px]:flex'
          )}
        >
          <div
            className={classNames(
              'hidden flex-none items-center border-b border-surface-100 px-2 py-1.5',
              selected ? 'min-[1180px]:flex' : 'min-[1180px]:hidden',
              listCollapsed ? 'justify-center' : 'justify-between'
            )}
          >
            {listCollapsed ? (
              /* "Show Emails (n)" — the expand control for the collapsed rail */
              <button
                onClick={toggleList}
                title={customer ? `Show ${customer.companyName} emails (${filtered.length})` : `Show Emails (${filtered.length})`}
                aria-label={customer ? `Show ${customer.companyName} emails (${filtered.length})` : `Show Emails (${filtered.length})`}
                aria-expanded={false}
                className="flex w-full flex-col items-center gap-0.5 rounded-lg py-1 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600"
              >
                <PanelLeftOpen className="h-4 w-4" />
                <span className="rounded-full bg-surface-200/80 px-1.5 text-[10px] font-semibold leading-4 text-surface-600">
                  {filtered.length}
                </span>
              </button>
            ) : (
              <>
                {/* Contextual mode names the company the list belongs to and
                    counts ITS emails — never the global total. */}
                <span
                  className={classNames(
                    'min-w-0 truncate pl-2 text-[11px] font-semibold uppercase tracking-wide',
                    customer ? 'text-brand-700' : 'text-surface-400'
                  )}
                  title={customer ? `${customer.companyName} — ${filtered.length} emails` : undefined}
                >
                  {customer
                    ? `${customer.companyName} — ${filtered.length} Email${filtered.length === 1 ? '' : 's'}`
                    : `${filtered.length} email${filtered.length === 1 ? '' : 's'}`}
                </span>
                <button
                  onClick={toggleList}
                  title="Hide Emails"
                  aria-label="Hide Emails"
                  aria-expanded
                  className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
          {/* Contextual mode — the way back to the direct Global Inbox: it
              closes the conversation and its workspace and widens the list back
              to every company. Kept on every width (the header above is
              desktop-only), so opening an email is never a one-way door. */}
          {selected && (
            <div className="flex-none border-b border-brand-100 bg-brand-50/60">
              {customer && (
                <div className="flex items-center gap-1.5 px-3 pt-1.5 min-[1180px]:hidden">
                  <Building2 className="h-3.5 w-3.5 flex-none text-brand-600" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-surface-800">
                    {customer.companyName} — {filtered.length} Email{filtered.length === 1 ? '' : 's'}
                  </span>
                </div>
              )}
              <button
                onClick={exitToInbox}
                title="Back to All Emails — the full Global Inbox"
                aria-label="Back to All Emails"
                className={classNames(
                  'flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 transition-colors hover:bg-brand-100/60',
                  listCollapsed && 'min-[1180px]:justify-center min-[1180px]:px-0'
                )}
              >
                <ArrowLeft className="h-3.5 w-3.5 flex-none" />
                <span className={classNames('truncate', listCollapsed && 'min-[1180px]:hidden')}>
                  Back to All Emails
                </span>
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listCollapsed ? (
              <>
                <div className="hidden min-[1180px]:block">
                  <EmailIconRail emails={filtered} selectedId={selectedId} onSelect={onSelect} />
                </div>
                <div className="min-[1180px]:hidden">
                  <EmailList emails={filtered} selectedId={selectedId} onSelect={onSelect} inquiryIds={inquiryEmailIds} />
                </div>
              </>
            ) : (
              <EmailList emails={filtered} selectedId={selectedId} onSelect={onSelect} inquiryIds={inquiryEmailIds} />
            )}
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
              {/* Which inquiry this conversation belongs to — identity only.
                  Its other emails are already in the left panel (this
                  customer's mail), so they are never listed again here. */}
              {inquiry && <InquiryHeader inquiry={inquiry} />}
              {showQuoteTools && (
                <div className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-[12px] font-medium text-brand-700">
                  <FileText className="h-3.5 w-3.5" /> Quote-send mode — {quoteSendQuotation!.number}
                </div>
              )}
              {isRevision && (
                <div className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-[12px] font-medium text-brand-700">
                  <RefreshCw className="h-3.5 w-3.5" /> Quote revision — {revisionQuotation?.number ?? selected.linkedQuotation ?? ''}
                </div>
              )}
              {isPoVerify && (
                <div className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-[12px] font-medium text-brand-700">
                  <ClipboardCheck className="h-3.5 w-3.5" /> PO vs Quote verification — {poSalesOrder?.poNumber ?? selected.linkedPO ?? ''}
                </div>
              )}
              {isSoRevision && (
                <div className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-[12px] font-medium text-brand-700">
                  <FilePenLine className="h-3.5 w-3.5" /> Sales Order revision — {soRevisionSalesOrder?.number ?? selected.linkedSO ?? ''}
                </div>
              )}
              {isPoAssociate && (
                <div className="flex flex-none items-center gap-1.5 border-b border-amber-200 bg-amber-50/70 px-4 py-2 text-[12px] font-medium text-amber-700">
                  <Link2 className="h-3.5 w-3.5" /> Purchase Order received — quotation association required
                </div>
              )}
              <div className="min-h-0 flex-1">
                {showQuoteTools ? (
                  <InboxCenterPanel email={selected} mode="quote-send" quotation={quoteSendQuotation} focusTick={focusTick} />
                ) : isRevision ? (
                  <InboxCenterPanel email={selected} mode="revision" quotation={revisionQuotation} focusTick={focusTick} />
                ) : isPoVerify ? (
                  <InboxCenterPanel email={selected} mode="po-verify" salesOrder={poSalesOrder} quotation={poQuote} focusTick={focusTick} />
                ) : isSoRevision ? (
                  <InboxCenterPanel email={selected} mode="so-revision" salesOrder={soRevisionSalesOrder} quotation={soRevisionQuote} focusTick={focusTick} />
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
                  <QuoteToolsPanel email={selected} quotation={quoteSendQuotation!} onPrepared={onPrepared} />
                ) : isRevision ? (
                  <RevisionQuotePanel email={selected} onPrepared={onPrepared} />
                ) : isPoVerify ? (
                  <PoVerificationPanel email={selected} onPrepared={onPrepared} onGenerateSo={openSoDrawer} />
                ) : isSoRevision ? (
                  <SoRevisionPanel email={selected} salesOrder={soRevisionSalesOrder!} onPrepared={onPrepared} />
                ) : isPoAssociate ? (
                  <PoAssociationPanel email={selected} />
                ) : (
                  <EmailActionPanel email={selected} />
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* SO Generation drawer — full-height right drawer (~65% on desktop,
          full-screen on tablet/mobile) over the inbox. Conditionally mounted so
          its form state initialises fresh from the selected Sales Order. */}
      {soDrawerOpen && isPoVerify && poSalesOrder && selected && (
        <SoGenerationDrawer
          email={selected}
          so={poSalesOrder}
          quote={poQuote}
          onPrepared={onPrepared}
          onClose={closeSoDrawer}
        />
      )}

      {/* subtle icon reference so Inbox import is used when list is empty on mobile */}
      {filtered.length === 0 && mobileView === 'list' && (
        <div className="mt-4 flex justify-center text-surface-300 lg:hidden">
          <Inbox className="h-6 w-6" />
        </div>
      )}
    </>
  );
}

/**
 * "More Filters" — a compact popover that keeps the secondary inbox filters
 * (Read/Unread, Owner, date range) out of the default toolbar. Rendered in a
 * portal so it never gets clipped by the card, with click-outside + Escape to
 * close, mirroring the RowActionMenu pattern used elsewhere.
 */
function MoreFiltersPopover({
  count,
  readState,
  onReadState,
  owner,
  onOwner,
  dateFrom,
  onDateFrom,
  dateTo,
  onDateTo,
}: {
  count: number;
  readState: string;
  onReadState: (v: string) => void;
  owner: string;
  onOwner: (v: string) => void;
  dateFrom: string;
  onDateFrom: (v: string) => void;
  dateTo: string;
  onDateTo: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const menuW = 288;
    const left = Math.max(8, Math.min(b.left, window.innerWidth - menuW - 8));
    setPos({ top: b.bottom + 6, left });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={classNames(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-2.5 text-[12px] font-medium shadow-sm transition-colors hover:bg-surface-50 focus:outline-none focus:ring-2 focus:ring-brand-500/20',
          count > 0 ? 'border-brand-300 text-brand-700' : 'border-surface-200 text-surface-600'
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        More Filters
        {count > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white">{count}</span>
        )}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label="More filters"
            style={{ top: pos.top, left: pos.left, width: 288 }}
            className="fixed z-50 space-y-3 rounded-xl border border-surface-200 bg-white p-3.5 shadow-pop animate-slide-up"
          >
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">Status</label>
              <FilterSelect className="w-full" value={readState} onChange={onReadState} placeholder="Read & Unread" options={[{ value: 'unread', label: 'Unread' }, { value: 'read', label: 'Read' }]} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">Owner</label>
              <FilterSelect className="w-full" value={owner} onChange={onOwner} placeholder="All owners" options={OWNERS.map((o) => ({ value: o, label: o }))} />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-surface-400">Date range</label>
              <div className="flex items-center gap-1.5">
                <input type="date" aria-label="From date" value={dateFrom} onChange={(e) => onDateFrom(e.target.value)} className="input h-8 flex-1 py-1 text-[12px]" title="From date" />
                <span className="text-surface-400">→</span>
                <input type="date" aria-label="To date" value={dateTo} onChange={(e) => onDateTo(e.target.value)} className="input h-8 flex-1 py-1 text-[12px]" title="To date" />
              </div>
            </div>
            {count > 0 && (
              <button
                onClick={() => { onReadState(''); onOwner(''); onDateFrom(''); onDateTo(''); }}
                className="text-[11px] font-semibold text-surface-500 hover:text-brand-600 hover:underline"
              >
                Reset these filters
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
