import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Inbox, ArrowLeft, Building2, FileText, RefreshCw, ClipboardCheck, FilePenLine, Link2, Mails, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import { SearchInput, FilterSelect, FilterBar, type FilterChip } from '@/components/ui';
import { Tabs } from '@/components/ui/misc';
import { useApp, useOfficeScope, useNoOfficeAssigned } from '@/context/AppContext';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { OWNERS } from '@/data/users';
import { draftQuotationForEnquiry, inquiryById, inquiryEmailsOf, inquiryIdOfEmail } from '@/lib/inquiry';
import { inboxParams, type InboxMode } from '@/lib/inboxContext';
import { INBOX_CLASSIFICATION } from '@/lib/labels';
import type { EmailClassification, InboxEmail } from '@/types';
import { classNames } from '@/lib/format';
import { EmailList, EmailIconRail } from './EmailList';
import { SoGenerationDrawer } from './SoGenerationDrawer';
import { EmailActionPanel } from './EmailActionPanel';
import { QuotationBuilderModal } from './QuotationBuilderModal';
import { ComposePopup } from './ComposePopup';
import { requirementExtraction } from '@/lib/requirementExtraction';
import { TODAY_ISO } from '@/lib/quotationWorkflow';
import { InboxCenterPanel } from './InboxCenterPanel';
import { InquiryHeader } from './InquiryHeader';
import { QuoteToolsPanel } from './QuoteToolsPanel';
import { RevisionQuotePanel } from './RevisionQuotePanel';
import { PoVerificationPanel } from './PoVerificationPanel';
import { PoAssociationPanel } from './PoAssociationPanel';
import { SoRevisionPanel } from './SoRevisionPanel';
import { RequirementExtractionPanel } from './RequirementExtractionPanel';
import {
  associationEmailPatch,
  buildVerificationSalesOrder,
  findQuotationByNumber,
  quotationRefOf,
  verificationSoId,
} from '@/lib/poAssociation';

type Tab = 'all' | 'needs_review' | 'drafts';

export default function GlobalInbox() {
  const { emails, updateEmail, quotations, salesOrders, parties, addQuotation, addSalesOrder, addToast, currentUser, sidebarCollapsed, setSidebarCollapsed } = useApp();
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
  // The company email list as an overlay, for widths that cannot spare a third
  // column. It is never the ONLY way to the list at desktop sizes — there it is
  // a real column — and never a silent replacement: the button that opens it is
  // always on screen (see "Company Emails (n)" below).
  const [emailDrawerOpen, setEmailDrawerOpen] = useState(false);

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

  // Quote builder + compose window. Both sit OVER the workspace rather than
  // replacing it, so the company list, the selected thread and the inquiry
  // context stay exactly where they were underneath.
  const [builderQtnId, setBuilderQtnId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

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

  // The builder and the compose window hold the previous email's quotation and
  // draft, so changing conversation closes them rather than re-pointing them.
  useEffect(() => {
    setBuilderQtnId(null);
    setComposeOpen(false);
  }, [selectedId]);

  // Auto-optimise the workspace: collapse the app sidebar to its icon rail while
  // the inbox is open, then restore the user's previous state on leaving.
  const restoreSidebarRef = useRef(sidebarCollapsed);
  useEffect(() => {
    const restore = restoreSidebarRef.current;
    setSidebarCollapsed(true);
    return () => setSidebarCollapsed(restore);
  }, [setSidebarCollapsed]);

  // The workspace is laid out from the width it ACTUALLY has, not from the
  // viewport: the app sidebar, the page gutters and the user's own zoom all
  // change how much room the three panels get. Measuring means the left column
  // survives wherever it fits and becomes a drawer only when it genuinely
  // cannot — never because a viewport breakpoint guessed wrong.
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  useLayoutEffect(() => {
    const el = workspaceRef.current;
    if (!el) return;
    setWorkspaceWidth(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([entry]) => setWorkspaceWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  // The quotation the enquiry is quoted on — the inquiry id IS the quotation
  // id, so Generate Quote never needs a lookup screen to find its record.
  const inquiryQuotation = useMemo(
    () => (inquiryScopeId ? quotations.find((q) => q.id === inquiryScopeId) ?? null : null),
    [inquiryScopeId, quotations]
  );

  // The confirmed reading of the enquiry — the lines the quotation starts from.
  const inquiryExtraction = useMemo(
    () => (selected ? requirementExtraction(selected, quotations, salesOrders) : null),
    [selected, quotations, salesOrders]
  );

  const builderQuotation = useMemo(
    () => (builderQtnId ? quotations.find((q) => q.id === builderQtnId) ?? null : null),
    [builderQtnId, quotations]
  );

  // Generate Quote. A brand-new enquiry has no quotation yet, so quoting it
  // CREATES one and links the email to it — the enquiry keeps its identity and
  // the draft shows up in Quotes Pending to be Sent from that moment.
  const openQuoteBuilder = () => {
    if (!selected) return;
    if (inquiryQuotation) {
      setBuilderQtnId(inquiryQuotation.id);
      return;
    }
    const draft = draftQuotationForEnquiry(selected, quotations, currentUser.fullName, TODAY_ISO);
    if (!draft) {
      addToast({
        type: 'error',
        title: 'No customer on this email',
        message: 'Associate a customer before a quotation can be raised against it.',
      });
      return;
    }
    addQuotation(draft);
    updateEmail(selected.id, { inquiryId: draft.id, linkedQuotation: draft.number });
    setBuilderQtnId(draft.id);
  };

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

  // A plain Inquiry email — the right panel adds the AI Requirement Extraction
  // reading above the usual Business Action, so the line-level gaps are visible
  // before anyone starts a quotation from them.
  const isInquiry = !isWorkflowMode && selected?.classification === 'inquiry';

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
    setEmailDrawerOpen(false);
    // The rail is a three-panel affordance; the direct inbox is always the
    // full-width list, never a column of icons with no way to expand it.
    autoCollapsedRef.current = false;
    setListCollapsed(false);
    setParams({}, { replace: true });
  };

  const onSelect = (id: string) => {
    setSelectedId(id);
    setEmailDrawerOpen(false);
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

  // ---- Responsive tiers for the contextual workspace ----------------------
  // The panels never squeeze below a readable size and never scroll sideways;
  // instead the layout steps down a tier at a time, and the company email list
  // is the LAST thing to go — and even then only into a drawer that announces
  // itself.
  //   3 panels ≥ 880px  — list · conversation · workspace (the full layout,
  //                       reached at a 1024px viewport). From 1040px it widens
  //                       to the target sizes: list 260–300 · conversation
  //                       ≥400 · workspace 380–460.
  //   2 panels ≥ 700px  — conversation · workspace; the list moves to the
  //                       "Company Emails (n)" drawer.
  //   1 panel  < 700px  — conversation above workspace; list still in the
  //                       drawer.
  const panels = !selected ? 1 : workspaceWidth >= 880 ? 3 : workspaceWidth >= 700 ? 2 : 1;
  // The list is a column only in the full layout; otherwise it is the drawer,
  // reachable from a button that is always visible beside the conversation.
  const listAsColumn = !selected || panels === 3;
  const listAsDrawer = !!selected && panels < 3;
  // A connected, edge-to-edge surface (viewport height, 1px dividers, no gaps):
  // the full-height list on direct /inbox and every side-by-side workspace.
  // Only the narrow stacked tier falls back to separate cards.
  const connected = !selected || panels >= 2;
  // Desktop split: Company Emails 22% · Email Thread 40% · Action Workspace 38%.
  // The list keeps a 230px floor so the ratio never makes it unreadable at the
  // bottom of the three-panel tier; above ~1050px the split is exactly 22/40/38.
  const gridColumns = !selected
    ? undefined
    : panels === 3
    ? `${listCollapsed ? '56px' : 'minmax(230px, 22fr)'} minmax(0, 40fr) minmax(0, 38fr)`
    : panels === 2
    ? 'minmax(320px, 1fr) minmax(300px, 380px)'
    : undefined;

  // The drawer never outlives the width that needed it, and Escape closes it.
  useEffect(() => {
    if (!listAsDrawer) setEmailDrawerOpen(false);
  }, [listAsDrawer]);
  useEffect(() => {
    if (!emailDrawerOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setEmailDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [emailDrawerOpen]);

  if (noOffice) {
    return (
      <div className="px-4 py-4 sm:px-6">
        <PageHeader
          title="Global Inbox"
          description="AI classifies, extracts and drafts. Every outgoing email is human-reviewed and approved before sending."
          crumbs={[{ label: 'Global Inbox' }]}
        />
        <NoOfficeAssigned />
      </div>
    );
  }

  // The shell renders /inbox full-bleed, so the page owns its own gutters: a
  // slim title block, the toolbar edge to edge, and a workspace that takes the
  // rest of the viewport height (the app header is 56px tall).
  return (
    <div className="flex h-[calc(100vh-56px)] min-h-[560px] flex-col leading-[1.4]">
      <div className="flex-none px-4 pt-3">
        <PageHeader
          dense
          title="Global Inbox"
          description="AI classifies, extracts and drafts. Every outgoing email is human-reviewed and approved before sending."
          crumbs={[{ label: 'Global Inbox' }]}
        />
      </div>

      {/* The inbox toolbar is always present. Direct /inbox lists the
          classified emails of every company; contextual mode narrows the list
          to the selected customer (tabs, filters and counts follow it). The
          inquiry grouping stays additive on top — a bundle above the
          conversation, never a replacement for the list. */}
      <div className="flex-none border-y border-surface-200 bg-white">
        {/* Tabs */}
        <div className="px-4">
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
        <div className="px-4 py-2">
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
          MODE 2 — an email is open: the connected workspace — one surface,
          vertical dividers, no gaps — laid out from the width it measures (see
          the tiers above): list · conversation · business workspace whenever
          three panels fit, otherwise the list steps into its drawer so the
          remaining panels keep a readable width instead of squeezing. */}
      <div
        ref={workspaceRef}
        style={gridColumns ? { gridTemplateColumns: gridColumns } : undefined}
        className={classNames(
          'grid min-h-0 flex-1 grid-cols-1 bg-white',
          connected ? 'gap-0 overflow-hidden' : 'gap-3 overflow-y-auto p-3'
        )}
      >
        {/* Left: the email list — every company on direct /inbox, the selected
            customer's mail in contextual mode. It is a real column whenever
            three panels fit; below that it lives in the drawer instead (and is
            reached from the "Company Emails (n)" button in the centre). Inside
            the full layout it can still be collapsed to a 56px icon rail, so
            the conversation + workspace keep their width beside the SO drawer. */}
        {listAsColumn && (
          <div
            className={classNames(
              'card flex flex-col overflow-hidden',
              connected && 'rounded-none border-0 shadow-none',
              connected && selected && 'border-r border-surface-200 bg-surface-50/40'
            )}
          >
            <div
              className={classNames(
                'flex-none items-center border-b border-surface-100 px-2 py-1.5',
                selected ? 'flex' : 'hidden',
                listCollapsed ? 'justify-center' : 'justify-between'
              )}
            >
              {listCollapsed ? (
                /* The expand control for the collapsed rail — it names what it
                   holds ("Company Emails") and how many, so the list is never
                   reduced to an unlabelled strip of icons. */
                <button
                  onClick={toggleList}
                  title={`Company Emails (${filtered.length})${customer ? ` — ${customer.companyName}` : ''}`}
                  aria-label={`Company Emails (${filtered.length})`}
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
            {/* The way back to the direct Global Inbox: it closes the
                conversation and its workspace and widens the list back to every
                company, so opening an email is never a one-way door. */}
            {selected && (
              <div className="flex-none border-b border-brand-100 bg-brand-50/60">
                <button
                  onClick={exitToInbox}
                  title="Back to All Emails — the full Global Inbox"
                  aria-label="Back to All Emails"
                  className={classNames(
                    'flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 transition-colors hover:bg-brand-100/60',
                    listCollapsed && 'justify-center px-0'
                  )}
                >
                  <ArrowLeft className="h-3.5 w-3.5 flex-none" />
                  <span className={classNames('truncate', listCollapsed && 'hidden')}>Back to All Emails</span>
                </button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {listCollapsed && selected ? (
                <EmailIconRail emails={filtered} selectedId={selectedId} onSelect={onSelect} />
              ) : (
                <EmailList emails={filtered} selectedId={selectedId} onSelect={onSelect} inquiryIds={inquiryEmailIds} />
              )}
            </div>
          </div>
        )}

        {/* Center + Right */}
        {selected ? (
          <>
            {/* Center: reading panel — comfortable width, divider on right */}
            <div
              className={classNames(
                'card flex flex-col overflow-hidden',
                connected
                  ? 'rounded-none border-0 border-r border-surface-200 bg-white shadow-none'
                  : // Stacked tier: the thread keeps a workable height of its
                    // own and scrolls inside it, rather than being clipped.
                    'h-[520px]'
              )}
            >
              {/* The list's stand-in whenever it is not a column. It sits at the
                  top of the conversation, states the company and the count, and
                  opens the drawer — the list is moved, never hidden. */}
              {listAsDrawer && (
                <div className="flex flex-none items-center gap-2 border-b border-surface-100 bg-surface-50/70 px-3 py-2">
                  <button
                    onClick={() => setEmailDrawerOpen(true)}
                    aria-haspopup="dialog"
                    aria-expanded={emailDrawerOpen}
                    title={customer ? `${customer.companyName} — ${filtered.length} emails` : undefined}
                    className="flex min-w-0 items-center gap-1.5 rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-50"
                  >
                    <Mails className="h-3.5 w-3.5 flex-none" />
                    <span className="truncate">Company Emails ({filtered.length})</span>
                  </button>
                  {customer && (
                    <span className="min-w-0 flex-1 truncate text-[12px] text-surface-600">{customer.companyName}</span>
                  )}
                  <button
                    onClick={exitToInbox}
                    title="Back to All Emails — the full Global Inbox"
                    className="flex flex-none items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-700 transition-colors hover:text-brand-800"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> All Emails
                  </button>
                </div>
              )}
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
                'card flex flex-col overflow-hidden',
                connected && 'rounded-none border-0 bg-white shadow-none'
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
                ) : isInquiry ? (
                  <div className={classNames('flex flex-col', connected ? 'h-full' : 'h-[560px]')}>
                    <div className="min-h-0 flex-1">
                      <RequirementExtractionPanel email={selected} />
                    </div>
                    <div className="max-h-[45%] flex-none overflow-y-auto border-t border-surface-200">
                      <EmailActionPanel
                        email={selected}
                        onGenerateQuote={openQuoteBuilder}
                        onCompose={() => setComposeOpen(true)}
                      />
                    </div>
                  </div>
                ) : (
                  <EmailActionPanel email={selected} onCompose={() => setComposeOpen(true)} />
                )}
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Generate Quote — the editable quotation, opened OVER the inbox. Only
          mounted while open so it seeds fresh from the confirmed extraction. */}
      {builderQuotation && selected && (
        <QuotationBuilderModal
          email={selected}
          quotation={builderQuotation}
          extraction={inquiryExtraction}
          onAddedToEmail={() => {
            // The quote is attached; the builder's job is done and the mail it
            // rides on is the next thing the user needs.
            setBuilderQtnId(null);
            setComposeOpen(true);
          }}
          onClose={() => setBuilderQtnId(null)}
        />
      )}

      {/* The compose window — the only surface that sends. Non-modal by design:
          the list and the thread behind it stay readable and clickable. */}
      {composeOpen && selected && (
        <ComposePopup
          email={selected}
          quotation={inquiryQuotation ?? builderQuotation}
          inquiryId={inquiryScopeId}
          onClose={() => setComposeOpen(false)}
        />
      )}

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

      {/* The company email list as an overlay, for the widths that cannot spare
          a third column. Same list, same selection, same "Back to All Emails" —
          only its container changes. */}
      {emailDrawerOpen && listAsDrawer && (
        <div className="fixed inset-0 z-40 flex" role="dialog" aria-modal="true" aria-label="Company emails">
          <div className="absolute inset-0 bg-surface-900/40" onClick={() => setEmailDrawerOpen(false)} />
          <div className="relative z-10 flex h-full w-[min(340px,88vw)] flex-col bg-white shadow-2xl">
            <div className="flex flex-none items-center gap-2 border-b border-surface-100 px-3 py-2.5">
              <Mails className="h-4 w-4 flex-none text-brand-600" />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-surface-900">
                Company Emails ({filtered.length})
              </span>
              <button
                onClick={() => setEmailDrawerOpen(false)}
                title="Close"
                aria-label="Close company emails"
                className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-100 hover:text-surface-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {customer && (
              <div className="flex flex-none items-center gap-1.5 border-b border-surface-100 px-3 py-1.5">
                <Building2 className="h-3.5 w-3.5 flex-none text-brand-600" />
                <span className="min-w-0 truncate text-[12px] text-surface-700">{customer.companyName}</span>
              </div>
            )}
            <button
              onClick={exitToInbox}
              className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700 transition-colors hover:bg-brand-100/60"
            >
              <ArrowLeft className="h-3.5 w-3.5 flex-none" /> Back to All Emails
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <EmailList emails={filtered} selectedId={selectedId} onSelect={onSelect} inquiryIds={inquiryEmailIds} />
            </div>
          </div>
        </div>
      )}

      {/* subtle icon reference so Inbox import is used when the list is empty */}
      {!selected && filtered.length === 0 && (
        <div className="flex flex-none justify-center py-3 text-surface-300">
          <Inbox className="h-6 w-6" />
        </div>
      )}
    </div>
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
