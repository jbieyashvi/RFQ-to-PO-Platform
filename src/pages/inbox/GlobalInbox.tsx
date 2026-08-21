import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ArrowLeft, Building2, MailOpen, FileText, RefreshCw, ClipboardCheck, FilePenLine, Link2, SlidersHorizontal, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { SearchInput, FilterSelect, FilterBar, EmptyState, type FilterChip } from '@/components/ui';
import { Tabs } from '@/components/ui/misc';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { OWNERS } from '@/data/users';
import { inquiryById, inquiryEmailsOf, inquiryIdOfEmail } from '@/lib/inquiry';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import type { EmailClassification, InboxEmail } from '@/types';
import { classNames } from '@/lib/format';
import { EmailList, EmailIconRail } from './EmailList';
import { SoGenerationDrawer } from './SoGenerationDrawer';
import { EmailActionPanel } from './EmailActionPanel';
import { InboxCenterPanel } from './InboxCenterPanel';
import { InquiryBundle } from './InquiryBundle';
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
    const mode = params.get('mode');
    const emailId = params.get('email');
    const qtnId = params.get('qtn');
    return mode === 'quote-send' && emailId && qtnId ? { emailId, qtnId } : null;
  });

  // ---- Inquiry grouping ---------------------------------------------------
  // The full classified inbox on the left NEVER goes away. On top of it, the
  // emails of ONE inquiry are bundled together: whenever an email is selected —
  // or the inbox is opened from a workflow deep link — every message carrying
  // the same inquiryId is gathered into a compact inquiry header + its own
  // small list above the conversation, however many separate email threads they
  // arrived in (RFQ, quotation, revision ask, Purchase Order, Sales Order).
  //
  // The inquiry is keyed by the quotation behind the enquiry and carried in
  // ?inquiryId, so the context survives a reload and every move between its
  // messages. "Back to All Emails" drops the grouping.
  const inquiryIdOf = useMemo(
    () => (e: InboxEmail) => inquiryIdOfEmail(e, quotations, salesOrders),
    [quotations, salesOrders]
  );

  // ?inquiryId is the route-level inquiry context (?inq is the older spelling,
  // still accepted so existing links keep working).
  const [inquiryId, setInquiryId] = useState<string | null>(
    () => params.get('inquiryId') ?? params.get('inq')
  );

  // ---- Company (customer) scope -------------------------------------------
  // The inbox has exactly two modes:
  //   1. Direct /inbox — the classified emails of ALL companies.
  //   2. Contextual / workflow mode — opened from a quote, PO or SO workflow
  //      (or a ?customerId deep link): the LEFT panel narrows to the selected
  //      customer, so the whole company conversation (inquiry, quote revision,
  //      purchase order, sales order query) is at hand and no other customer's
  //      mail is in the way. "Back to All Companies" returns to mode 1.
  const [customerId, setCustomerId] = useState<string | null>(() => params.get('customerId'));

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

  // The company the inbox is currently scoped to (contextual mode). An id that
  // no longer resolves to a party simply falls back to the global inbox.
  const customer = useMemo(
    () => (customerId ? parties.find((p) => p.id === customerId) ?? null : null),
    [customerId, parties]
  );
  const customerScopeId = customer?.id ?? null;

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

  // The inquiry currently grouped. An id that no longer resolves to a quotation
  // simply shows no bundle — the inbox itself is unaffected.
  const inquiry = useMemo(() => (inquiryId ? inquiryById(inquiryId, quotations) : null), [inquiryId, quotations]);
  const inquiryScopeId = inquiry?.id ?? null;

  // The classified list — narrowed by the company in contextual mode, never by
  // the inquiry (the inquiry is grouped in the centre, not cut out of the list).
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

  // The bundle: every email of this inquiry the user can access, oldest first —
  // office scope applies, inbox tabs/filters deliberately do not (the bundle is
  // the whole inquiry, not the filtered slice of it).
  const inquiryEmails = useMemo(
    () => (inquiryScopeId ? inquiryEmailsOf(inquiryScopeId, scoped, quotations, salesOrders) : []),
    [inquiryScopeId, scoped, quotations, salesOrders]
  );
  const inquiryEmailIds = useMemo(() => new Set(inquiryEmails.map((e) => e.id)), [inquiryEmails]);

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
    // An explicit inquiry in the route wins (in-place escalations and deep
    // links). A missing param never drops the grouping — leaving it is explicit,
    // see exitInquiry — and the selection effect below re-derives it anyway.
    const inq = params.get('inquiryId') ?? params.get('inq');
    if (inq) setInquiryId(inq);
    // Same for the company scope: an explicit ?customerId in the route puts the
    // inbox in contextual mode; its absence never silently drops the scope
    // (leaving it is explicit — see exitCustomer).
    const cust = params.get('customerId');
    if (cust) setCustomerId(cust);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Keep a valid selection. An email reached through the inquiry bundle counts
  // as valid even when the inbox tabs/filters would hide it — the bundle is the
  // whole inquiry, so opening one of its messages must never bounce the
  // selection back to the top of the filtered list.
  useEffect(() => {
    if (selectedId && (filtered.some((e) => e.id === selectedId) || inquiryEmailIds.has(selectedId))) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId, inquiryEmailIds]);

  const selected: InboxEmail | null = useMemo(
    () => emails.find((e) => e.id === selectedId) ?? null,
    [emails, selectedId]
  );

  // Selecting ANY email groups its inquiry — that is the whole point: a message
  // is never shown alone when it belongs to a wider inquiry. Selecting an email
  // that belongs to no inquiry (an unassociated PO, a cold enquiry) clears the
  // grouping. Keyed on the resolved id so "Back to All Emails" is not undone
  // while the same conversation stays open.
  const selectedInquiryId = selected ? inquiryIdOf(selected) : null;
  useEffect(() => {
    setInquiryId(selectedInquiryId);
  }, [selectedInquiryId]);

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

  // Entering contextual mode: opening a quotation / PO / SO workflow scopes the
  // left panel to that email's company. Keyed on the email whose workflow did
  // it, so "Back to All Companies" is not immediately undone while the same
  // conversation stays open, and so browsing the company's other (non-workflow)
  // emails keeps the scope until the user leaves it deliberately.
  const workflowCustomerRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    if (isWorkflowMode) {
      if (workflowCustomerRef.current !== selected.id) {
        workflowCustomerRef.current = selected.id;
        if (selected.partyId) setCustomerId(selected.partyId);
      }
    } else {
      workflowCustomerRef.current = null;
    }
  }, [selected, isWorkflowMode]);

  // Keep ?customerId and ?inquiryId in the route so a reload — or a link shared
  // with a colleague — lands back in the same company scope and inquiry, even
  // when the context was entered from a workflow that only linked ?email.
  useEffect(() => {
    const curCustomer = params.get('customerId') ?? null;
    const curInquiry = params.get('inquiryId') ?? null;
    if (curCustomer === customerScopeId && curInquiry === inquiryScopeId) return;
    const next = new URLSearchParams(params);
    if (customerScopeId) next.set('customerId', customerScopeId);
    else next.delete('customerId');
    if (inquiryScopeId) next.set('inquiryId', inquiryScopeId);
    else next.delete('inquiryId');
    next.delete('inq');
    setParams(next, { replace: true });
  }, [customerScopeId, inquiryScopeId, params, setParams]);

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
        if (!selectedInquiryId) {
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
  }, [selected, isWorkflowMode, selectedInquiryId]);

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

  // Keep the URL describing the current conversation + its workflow so a reload
  // restores exactly what the user is looking at.
  const urlFor = (e: InboxEmail, opts?: { inquiry?: boolean; customer?: boolean }): Record<string, string> => {
    // ?inquiryId keeps the inquiry context in the route rather than depending on
    // ?email alone, so a reload restores the bundle even when the next message
    // came in through a completely different email thread. ?customerId is the
    // company scope of the left panel — together they are the contextual mode.
    const id = (opts?.inquiry ?? true) ? inquiryIdOf(e) : null;
    const inq: Record<string, string> = id ? { inquiryId: id } : {};
    if ((opts?.customer ?? true) && customerScopeId) inq.customerId = customerScopeId;
    if (quoteSend && e.id === quoteSend.emailId) return { ...inq, mode: 'quote-send', email: e.id, qtn: quoteSend.qtnId };
    if (e.revisionSendId) return { ...inq, mode: 'quote-revision', email: e.id, qtn: e.revisionSendId };
    if (e.poVerifyId) {
      const so = salesOrders.find((s) => s.id === e.poVerifyId);
      return { ...inq, mode: 'po-verification', email: e.id, po: so?.poNumber ?? '', qtn: so?.quotationNumber ?? '' };
    }
    if (e.soRevisionId) {
      const so = salesOrders.find((s) => s.id === e.soRevisionId);
      return { ...inq, mode: 'so-revision', email: e.id, so: so?.number ?? '' };
    }
    return { ...inq, email: e.id };
  };

  // "Back to All Emails" — drop the inquiry grouping. The full list on the left
  // never moved, so this only removes the bundle and its route context; the
  // conversation stays open and its workflow panel is unchanged (those are
  // derived from the email itself, never from the query).
  const exitInquiry = () => {
    setInquiryId(null);
    setParams(selected ? urlFor(selected, { inquiry: false }) : {}, { replace: true });
  };

  // "Back to All Companies" — leave contextual mode for the direct Global
  // Inbox: the left panel widens back to every company and the inquiry grouping
  // goes with it. The conversation stays open and every workflow action on it
  // is untouched (they are derived from the email, never from the query).
  const exitCustomer = () => {
    setCustomerId(null);
    setInquiryId(null);
    workflowCustomerRef.current = selected?.id ?? null;
    setParams(selected ? urlFor(selected, { inquiry: false, customer: false }) : {}, { replace: true });
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

      {/* Connected three-panel workspace — one surface, vertical dividers, no
          gaps. The fr ratios (0.55 / 0.95 / 1 ≈ 22% / 38% / 40%) make the right
          business-workspace panel — the primary task area — widest: narrow
          list · read+compose · widest quote/action tools. Enabled at ≥1180px;
          below that we fall back to progressive list → detail navigation so the
          panels never squeeze or scroll sideways. */}
      <div
        className={classNames(
          'grid grid-cols-1 gap-4',
          'min-[1180px]:h-[calc(100vh-250px)] min-[1180px]:min-h-[520px] min-[1180px]:gap-0',
          'min-[1180px]:overflow-hidden min-[1180px]:rounded-xl min-[1180px]:border min-[1180px]:border-surface-200 min-[1180px]:bg-white min-[1180px]:shadow-card',
          // Collapsed → the left column shrinks to a 56px icon rail so the
          // thread + workspace keep maximum width beside the SO drawer.
          listCollapsed
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
            'min-[1180px]:rounded-none min-[1180px]:border-0 min-[1180px]:border-r min-[1180px]:border-surface-200 min-[1180px]:bg-surface-50/40 min-[1180px]:shadow-none',
            mobileView === 'detail' && 'hidden min-[1180px]:flex'
          )}
        >
          <div
            className={classNames(
              'hidden flex-none items-center border-b border-surface-100 px-2 py-1.5 min-[1180px]:flex',
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
          {/* Contextual mode — the way back to the direct Global Inbox. Kept on
              every width (the header above is desktop-only), so the company
              scope is never a one-way door. */}
          {customer && (
            <div className="flex-none border-b border-brand-100 bg-brand-50/60">
              <div className="flex items-center gap-1.5 px-3 pt-1.5 min-[1180px]:hidden">
                <Building2 className="h-3.5 w-3.5 flex-none text-brand-600" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-surface-800">
                  {customer.companyName} — {filtered.length} Email{filtered.length === 1 ? '' : 's'}
                </span>
              </div>
              <button
                onClick={exitCustomer}
                title="Back to All Companies — the full Global Inbox"
                aria-label="Back to All Companies"
                className={classNames(
                  'flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 transition-colors hover:bg-brand-100/60',
                  listCollapsed && 'min-[1180px]:justify-center min-[1180px]:px-0'
                )}
              >
                <ArrowLeft className="h-3.5 w-3.5 flex-none" />
                <span className={classNames('truncate', listCollapsed && 'min-[1180px]:hidden')}>
                  Back to All Companies
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
              {/* Inquiry bundle — compact header + this inquiry's own emails,
                  grouped across every thread they arrived in. */}
              {inquiry && inquiryEmails.length > 0 && (
                <InquiryBundle
                  inquiry={inquiry}
                  emails={inquiryEmails}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onExit={exitInquiry}
                />
              )}
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
        ) : (
          <div className="card hidden items-center justify-center min-[1180px]:col-span-2 min-[1180px]:flex min-[1180px]:rounded-none min-[1180px]:border-0 min-[1180px]:shadow-none">
            <EmptyState icon={<MailOpen className="h-7 w-7" />} title="No email selected" message="Select an email from the list to view its details, AI extraction and the reply composer." />
          </div>
        )}
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
