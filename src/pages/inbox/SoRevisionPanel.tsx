import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  FileSpreadsheet,
  Eye,
  Save,
  Mail,
  Paperclip,
  User2,
  Boxes,
  Receipt,
  Calculator,
  History,
  FilePenLine,
  Wand2,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowLeft,
  Ban,
  CheckCircle2,
  CircleSlash,
  FileWarning,
  BadgeCheck,
} from 'lucide-react';
import type {
  CommercialTerms,
  InboxEmail,
  LineItem,
  Party,
  PaymentTerms,
  Quotation,
  SalesOrder,
  SalesOrderAttachment,
  SORevisionSnapshot,
  TechnicalSpecs,
  VerificationField,
} from '@/types';
import {
  Button,
  IconButton,
  Modal,
  StatusBadge,
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  InfoRow,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { ITEMS } from '@/data/masters';
import { emailSignature } from '@/lib/brand';
import { resolveSalesOrder, type ResolvedSalesOrder } from '@/lib/salesOrder';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
import { OWNERS, USERS } from '@/data/users';
import {
  amountInWords,
  classNames,
  computeTotals,
  formatDate,
  formatDateTime,
  formatINR,
  lineTotal,
} from '@/lib/format';
import { revisionReceivedAtOf, revisionSla, slaDueAt } from '@/lib/sla';
import {
  activeDeliveryOptions,
  defaultDeliveryOption,
  formatPaymentTerms,
  formatWarranty,
  paymentTotal,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';
import { applyProposed } from '@/lib/revisionQueue';
import { REVISION_STATE } from '@/lib/labels';
import { specsForLine, TECH_SPEC_FIELDS } from '@/lib/technicalSpecs';

// Prototype "today" — kept consistent with the rest of the app's seeded data.
const TODAY_ISO = '2026-08-13';
const DRAFT_TS = '2026-08-13T12:38:00';
const ATTACH_TS = '2026-08-13T12:42:00';

const clone = (it: LineItem): LineItem => ({ ...it });

// Parse a free-text payment phrase (e.g. "50% Advance, 50% Before Dispatch")
// into the four structured payment buckets. Returns null if nothing matched so
// the caller can leave the existing terms untouched.
function parsePaymentPhrase(text: string): PaymentTerms | null {
  const buckets: PaymentTerms = { advance: 0, beforeDispatch: 0, creditDays: 0, afterInstall: 0 };
  let matched = false;
  text.split(/,|;|\band\b/i).forEach((part) => {
    const pct = part.match(/(\d+(?:\.\d+)?)\s*%/);
    if (!pct) return;
    const val = Number(pct[1]);
    if (/install/i.test(part)) buckets.afterInstall += val;
    else if (/credit/i.test(part)) buckets.creditDays += val;
    else if (/dispatch|delivery|before/i.test(part)) buckets.beforeDispatch += val;
    else if (/advance/i.test(part)) buckets.advance += val;
    else return;
    matched = true;
  });
  return matched ? buckets : null;
}

// Clearer, spec-aligned labels for the four payment buckets.
const SO_PAYMENT_LABEL: Record<keyof PaymentTerms, string> = {
  advance: 'Advance %',
  beforeDispatch: 'Before Dispatch %',
  creditDays: 'Credit %',
  afterInstall: 'After Installation %',
};

// The editable revised-order form. Snapshot fields (items, payment, delivery,
// addresses) are versioned; the extended client/order fields ride along on the
// live SO record without minting a new SO number.
interface RevForm {
  billingAddress: string;
  shippingAddress: string;
  sameAsBilling: boolean;
  phone: string;
  email: string;
  gstin: string;
  kindAttentionName: string;
  kindAttentionEmail: string;
  poNumber: string;
  poDate: string;
  officeId: string;
  owner: string;
  officeAdmin: string;
  packingPct: number;
  deliveryTerms: string;
  warrantyYears: number;
  creditDays: number;
  payment: PaymentTerms;
  expectedDelivery: string;
}

// Prefill the revised form from the SO's current revision draft when present,
// otherwise from the immutable Original snapshot — never overwriting either.
function initRevForm(
  so: SalesOrder,
  base: SORevisionSnapshot,
  party: Party | undefined,
  ct: CommercialTerms
): RevForm {
  const taxable = computeTotals(base.items, 0).taxable;
  const derivedPacking = taxable > 0 ? Math.round((so.packingCharges / taxable) * 100) : ct.packingPct;
  return {
    billingAddress: base.billingAddress,
    shippingAddress: base.shippingAddress,
    sameAsBilling: false,
    phone: so.customerPhone ?? party?.phone ?? '',
    email: so.customerEmail ?? party?.email ?? '',
    gstin: party?.gstin ?? '',
    kindAttentionName: so.kindAttentionName ?? party?.contactPerson ?? '',
    kindAttentionEmail: so.kindAttentionEmail ?? party?.email ?? '',
    poNumber: so.poNumber,
    poDate: so.poDate,
    officeId: so.officeId,
    owner: so.revisionOwner ?? so.owner,
    officeAdmin: so.officeAdmin ?? '',
    packingPct: so.commercials?.packingPct ?? derivedPacking,
    deliveryTerms: base.deliveryTerms || defaultDeliveryOption(ct)?.name || '',
    warrantyYears: parseInt(so.warranty, 10) || ct.warrantyYears,
    creditDays: so.commercials?.creditDays ?? 0,
    payment: so.commercials?.payment ? { ...so.commercials.payment } : { ...ct.payment },
    expectedDelivery: base.deliveryDate ?? '',
  };
}

/**
 * RIGHT panel for a "Sales Order Revision" conversation — the Sales Order
 * Revision workspace. It mirrors the customer's revision request against the
 * confirmed Sales Order and lets the owner prepare a revised Sales Order
 * Acknowledgement. Everything happens INSIDE the Global Inbox:
 *   • Original Sales Order tab — read-only view of the confirmed order.
 *   • Revised Sales Order tab — the same five sections as Create SO Manually,
 *     prefilled from the current order, with per-item Technical Specifications
 *     and old → new change highlighting.
 * The panel only PREPARES the email: Save Revision Draft persists the working
 * snapshot, Add Revised SO to Email attaches the generated revised SO PDF and
 * prefills the centre composer. Nothing is sent from here — the final send is
 * the middle composer's, which promotes the draft to a new immutable version.
 */
export function SoRevisionPanel({
  email,
  salesOrder,
  onPrepared,
}: {
  email: InboxEmail;
  salesOrder: SalesOrder;
  onPrepared?: () => void;
}) {
  const {
    parties,
    items: catalog,
    commercialTerms,
    role,
    quotations,
    emails,
    updateSalesOrder,
    updateQuotation,
    updateEmail,
    addEmail,
    addToast,
    currentUser,
    can,
  } = useApp();
  const navigate = useNavigate();

  const so = salesOrder;
  const canRevise = can('sales_orders', 'edit');
  const party = parties.find((p) => p.id === so.partyId);

  // Which of the three revision dispositions the owner is working in. Default to
  // the editor when a minor revision is already in flight (a draft exists),
  // otherwise show the three-action chooser so the disposition is picked first.
  const [action, setAction] = useState<'choose' | 'revise'>(() =>
    so.revisionState === 'draft_in_progress' || so.revisionDraft ? 'revise' : 'choose'
  );
  // "No Revision Required" — optional resolution note captured in a small modal.
  const [noRevOpen, setNoRevOpen] = useState(false);
  const [noRevNote, setNoRevNote] = useState('');
  // "Quote Revision Required" — confirm escalation to a quotation revision.
  const [escalateOpen, setEscalateOpen] = useState(false);

  // Immutable Original snapshot (versions[0]) is the comparison baseline. The
  // revised working point starts from the saved draft when one exists.
  const original: SORevisionSnapshot = useMemo(
    () =>
      so.versions[0]?.snapshot ?? {
        items: so.items.map(clone),
        paymentTerms: so.paymentTerms,
        deliveryTerms: so.deliveryTerms,
        deliveryDate: so.deliveryDate,
        billingAddress: so.billingAddress,
        shippingAddress: so.shippingAddress,
      },
    [so]
  );
  const base = so.revisionDraft ?? original;
  const nextRevNum = so.revisionNumber + 1;

  const [tab, setTab] = useState<'original' | 'revised'>('revised');
  const [form, setForm] = useState<RevForm>(() => initRevForm(so, base, party, commercialTerms));
  // The values the form was prefilled with — the baseline for "did the owner
  // change this field this session". Commercial fields (esp. payment, which the
  // Original stores only as free text) are compared against this rather than the
  // Original's differently-formatted strings, so nothing is falsely highlighted
  // on load. Line items compare against the structured Original snapshot below.
  const initialForm = useMemo(() => initRevForm(so, base, party, commercialTerms), [so.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lines, setLines] = useState<LineItem[]>(() => base.items.map(clone));
  const [specs, setSpecs] = useState<Record<string, TechnicalSpecs>>(() => {
    const map: Record<string, TechnicalSpecs> = {};
    base.items.forEach((l) => (map[l.id] = specsForLine(l, catalog)));
    return map;
  });
  const [preview, setPreview] = useState<null | 'original' | 'revised'>(null);

  const set = <K extends keyof RevForm>(k: K, v: RevForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const deliveryChoices = useMemo(() => activeDeliveryOptions(commercialTerms), [commercialTerms]);
  const officeAdmins = useMemo(() => {
    const inOffice = USERS.filter((u) => u.role === 'office_admin' && u.officeId === form.officeId && u.active);
    const list = inOffice.length ? inOffice : USERS.filter((u) => u.role === 'office_admin' && u.active);
    return list.map((u) => u.fullName);
  }, [form.officeId]);

  const effectiveShipping = form.sameAsBilling ? form.billingAddress : form.shippingAddress;
  const packingAmount = Math.round((computeTotals(lines, 0).taxable * form.packingPct) / 100);
  const totals = computeTotals(lines, packingAmount);
  const paymentSum = paymentTotal(form.payment);
  const contact = (party?.contactPerson ?? so.customerName.split(' ')[0] ?? 'Sir/Madam').trim();

  // ---- Change detection (revised vs immutable Original) --------------------
  const origLine = (id: string) => original.items.find((l) => l.id === id);
  const lineChange = (l: LineItem) => {
    const o = origLine(l.id);
    return {
      isNew: !o,
      qty: !!o && o.quantity !== l.quantity,
      price: !!o && o.unitPrice !== l.unitPrice,
      disc: !!o && o.discountPct !== l.discountPct,
      old: o,
    };
  };
  const paymentTextOf = (f: RevForm) =>
    formatPaymentTerms(f.payment) + (f.creditDays > 0 ? `, ${f.creditDays} Credit Days` : '');
  const initialShipping = initialForm.sameAsBilling ? initialForm.billingAddress : initialForm.shippingAddress;
  const changedFields = useMemo(() => ({
    delivery: initialForm.deliveryTerms !== form.deliveryTerms,
    deliveryDate: initialForm.expectedDelivery !== form.expectedDelivery,
    payment: paymentTextOf(initialForm) !== paymentTextOf(form),
    warranty: initialForm.warrantyYears !== form.warrantyYears,
    billing: initialForm.billingAddress !== form.billingAddress,
    shipping: initialShipping !== effectiveShipping,
  }), [initialForm, form, effectiveShipping, initialShipping]);
  const changeCount = useMemo(() => {
    let n = 0;
    lines.forEach((l) => {
      const c = lineChange(l);
      if (c.isNew || c.qty || c.price || c.disc) n += 1;
    });
    if (original.items.some((o) => !lines.find((l) => l.id === o.id))) n += 1; // removed line(s)
    n += Object.values(changedFields).filter(Boolean).length;
    return n;
  }, [lines, changedFields, original]);

  const revisedPaymentText =
    formatPaymentTerms(form.payment) + (form.creditDays > 0 ? `, ${form.creditDays} Credit Days` : '');

  const buildSnapshot = (): SORevisionSnapshot => ({
    items: lines.map(clone),
    paymentTerms: revisedPaymentText,
    deliveryTerms: form.deliveryTerms,
    deliveryDate: form.expectedDelivery,
    billingAddress: form.billingAddress,
    shippingAddress: effectiveShipping,
  });

  // Non-versioned metadata that rides on the live SO (no new SO number minted).
  const buildMetaPatch = (): Partial<SalesOrder> => ({
    poNumber: form.poNumber,
    poDate: form.poDate,
    officeId: form.officeId,
    owner: form.owner,
    revisionOwner: form.owner,
    officeAdmin: form.officeAdmin || undefined,
    customerPhone: form.phone || undefined,
    customerEmail: form.email || undefined,
    kindAttentionName: form.kindAttentionName || undefined,
    kindAttentionEmail: form.kindAttentionEmail || undefined,
    warranty: formatWarranty(form.warrantyYears),
    packingCharges: packingAmount,
    commercials: { packingPct: form.packingPct, payment: { ...form.payment }, creditDays: form.creditDays },
  });

  const validate = (): string | null => {
    if (!canRevise) return 'You do not have permission to revise Sales Orders.';
    if (lines.length === 0) return 'Add at least one line item.';
    if (lines.some((l) => !l.itemId)) return 'Every line must have an item selected.';
    if (lines.some((l) => l.quantity <= 0)) return 'Quantities must be greater than 0.';
    if (lines.some((l) => l.unitPrice <= 0)) return 'Unit price must be greater than 0.';
    if (paymentSum !== 100) return 'Payment terms must total 100%.';
    if (!form.expectedDelivery) return 'Expected delivery date is required.';
    if (!form.billingAddress.trim()) return 'Billing address is required.';
    return null;
  };

  // Persist the working revised snapshot + metadata. Does NOT increment the
  // revision number (that happens on send) and never overwrites the Original.
  const saveDraft = (silent = false): boolean => {
    const err = validate();
    if (err) {
      addToast({ type: 'error', title: 'Cannot save revision', message: err });
      return false;
    }
    const notes = `Revised Sales Order draft — ${changeCount} change(s) prepared for Rev ${nextRevNum}.`;
    updateSalesOrder(so.id, {
      ...buildMetaPatch(),
      revisionState: so.revisionState === 'revision_required' ? 'draft_in_progress' : so.revisionState,
      revisionDraft: buildSnapshot(),
      revisionNotes: notes,
      revisionPreviewed: false,
      activity: [
        ...so.activity,
        { id: `act-${so.id}-revdraft-${Date.now()}`, date: DRAFT_TS, actor: currentUser.fullName, action: 'Revision draft saved', detail: notes },
      ],
    });
    if (!silent) addToast({ type: 'success', title: 'Revision draft saved', message: `Rev ${nextRevNum} draft saved. Preview it and add it to the email.` });
    return true;
  };

  // Apply the customer's requested changes to the working revised order. Every
  // requested change maps to a structured field: line qty/price directly, and
  // the commercial asks (delivery terms, payment terms, warranty) onto their
  // respective form fields — so nothing the customer asked for is silently
  // dropped.
  const applyRequested = () => {
    const changes = email.requestedChanges ?? [];
    if (changes.length === 0) return;
    setLines((prev) => applyProposed(prev, changes));

    const delivery = changes.find((c) => c.type === 'delivery');
    const payment = changes.find((c) => c.type === 'payment');
    const warranty = changes.find((c) => c.type === 'warranty');
    const applied: string[] = [];

    if (delivery) {
      const nv = delivery.newValue.trim();
      const match =
        deliveryChoices.find((d) => d.name.toLowerCase() === nv.toLowerCase()) ??
        deliveryChoices.find(
          (d) => d.name.toLowerCase().includes(nv.toLowerCase()) || nv.toLowerCase().includes(d.name.toLowerCase())
        );
      set('deliveryTerms', match ? match.name : nv);
      applied.push('delivery terms');
    }
    if (payment) {
      const parsed = parsePaymentPhrase(payment.newValue);
      if (parsed) {
        set('payment', parsed);
        applied.push('payment terms');
      }
    }
    if (warranty) {
      const yrs = parseInt(warranty.newValue, 10);
      if (!Number.isNaN(yrs)) {
        set('warrantyYears', yrs);
        applied.push('warranty');
      }
    }
    const lineCount = changes.filter((c) => c.field).length;
    if (lineCount) applied.unshift(`${lineCount} item change${lineCount > 1 ? 's' : ''}`);

    addToast({
      type: 'info',
      title: 'Requested changes applied',
      message: applied.length
        ? `Applied ${applied.join(', ')}. Review the highlighted fields, then save the revision.`
        : 'Review the highlighted fields, then save the revision.',
    });
  };

  // Generate the revised Sales Order Acknowledgement PDF, attach it to the
  // centre composer and prefill the customer email. Only this system-generated
  // document can be attached — there is no generic file upload. The final send
  // happens from the centre panel.
  const addToEmail = () => {
    if (!saveDraft(true)) return;
    const value = totals.grandTotal;
    const changeLines = summariseChanges();
    const attach: SalesOrderAttachment = {
      fileName: `${so.number.replace(/\//g, '-')}-Rev${nextRevNum}.pdf`,
      soNumber: so.number,
      fileType: 'PDF',
      value,
      addedBy: 'system',
      addedAt: ATTACH_TS,
      sizeLabel: `${150 + lines.length * 8} KB`,
      revisionNumber: nextRevNum,
      revisionLabel: `Rev ${nextRevNum} · Revised`,
      kind: 'revised',
    };
    updateEmail(email.id, {
      composeIntent: 'so-revise',
      attachedQuote: undefined,
      attachedSalesOrder: attach,
      draft: {
        from: email.recipient,
        to: email.senderEmail,
        cc: email.cc.join(', '),
        subject: `Revised Sales Order ${so.number} - Revision ${nextRevNum}`,
        body:
          `Dear ${contact},\n\n` +
          `Thank you for your revision request against Sales Order ${so.number} (PO ${so.poNumber}).\n\n` +
          `Please find attached the revised Sales Order Acknowledgement (Revision ${nextRevNum}) reflecting the following updates:\n` +
          `${changeLines}\n\n` +
          `Revised order value: ${formatINR(value)}.\n\n` +
          `Kindly review and confirm so we may proceed accordingly.\n\n` +
          emailSignature(form.owner, officeName(form.officeId)),
        relatedDoc: so.number,
        aiGenerated: true,
      },
    });
    addToast({ type: 'success', title: 'Added to email', message: 'Revised Sales Order attached. Set the next review date and send it from the centre panel.' });
    onPrepared?.();
  };

  // A short bullet summary of the applied changes for the email body.
  const summariseChanges = (): string => {
    const bullets: string[] = [];
    lines.forEach((l) => {
      const c = lineChange(l);
      if (c.isNew) {
        bullets.push(`  • Added: ${l.description || l.itemCode} — ${l.quantity} ${l.unit} @ ${formatINR(l.unitPrice)}`);
        return;
      }
      if (c.qty && c.old) bullets.push(`  • ${l.description}: Qty ${c.old.quantity} → ${l.quantity} ${l.unit}`);
      if (c.price && c.old) bullets.push(`  • ${l.description}: Unit price ${formatINR(c.old.unitPrice)} → ${formatINR(l.unitPrice)}`);
      if (c.disc && c.old) bullets.push(`  • ${l.description}: Discount ${c.old.discountPct}% → ${l.discountPct}%`);
    });
    if (changedFields.delivery) bullets.push(`  • Delivery terms → ${form.deliveryTerms}`);
    if (changedFields.deliveryDate) bullets.push(`  • Expected delivery → ${formatDate(form.expectedDelivery, { short: true })}`);
    if (changedFields.payment) bullets.push(`  • Payment terms → ${revisedPaymentText}`);
    if (changedFields.warranty) bullets.push(`  • Warranty → ${formatWarranty(form.warrantyYears)}`);
    if (changedFields.billing) bullets.push('  • Billing address updated');
    if (changedFields.shipping) bullets.push('  • Shipping address updated');
    return bullets.length ? bullets.join('\n') : '  • Commercial terms reviewed and reconfirmed';
  };

  // ---- Action 1: No Revision Required ---------------------------------------
  // Close the revision request WITHOUT touching the SO. The SO record and its
  // versions are left exactly as-is; only the revision request is resolved and
  // dropped from the active queue (clearing revisionState removes it from
  // /sales-orders/revisions). An optional resolution note is recorded for audit.
  const resolveNoRevision = () => {
    const note = noRevNote.trim();
    const at = `${TODAY_ISO}T13:05:00`;
    updateSalesOrder(so.id, {
      revisionState: undefined,
      revisionDraft: undefined,
      revisionNotes: undefined,
      revisionResolution: { kind: 'no_revision', note: note || undefined, by: currentUser.fullName, at },
      // The SO was already acknowledged before the query; leave it settled.
      status: so.status === 'revision_required' ? 'so_sent' : so.status,
      activity: [
        ...so.activity,
        {
          id: `act-${so.id}-norev-${Date.now()}`,
          date: at,
          actor: currentUser.fullName,
          action: 'Revision request resolved — No Revision Required',
          detail: note || 'No changes needed; original Sales Order stands.',
        },
      ],
    });
    updateEmail(email.id, { needsReview: false, queueLabel: 'Revision resolved' });
    setNoRevOpen(false);
    setNoRevNote('');
    addToast({
      type: 'success',
      title: 'Marked as No Revision Required',
      message: `${so.number} left unchanged and removed from the revision queue.`,
    });
    onPrepared?.();
  };

  // ---- Action 3: Quote Revision Required (major / price change) --------------
  // Escalate to a quotation revision. The linked quote is flagged for revision,
  // its Global Inbox thread is opened, the PO is marked stale (awaiting an
  // updated PO) and SO generation is re-gated behind a fresh PO-vs-Quote match.
  const linkedQuote = quotations.find((q) => q.id === so.quotationId) ?? null;
  const buildQuoteRevisionEmail = (q: Quotation, id: string): InboxEmail => {
    const to = party?.email ?? so.customerEmail ?? 'procurement@customer.com';
    const city = officeName(q.officeId).split(' ')[0].toLowerCase();
    const from = `sales.${city}@flowtech-instruments.com`;
    const changes = email.requestedChanges ?? [];
    const changeLines = changes.length
      ? changes.map((c) => `• ${c.label}: ${c.oldValue} → ${c.newValue}`).join('\n')
      : `• ${so.revisionReason ?? 'Commercial change requested against the confirmed order.'}`;
    const contact = party?.contactPerson ?? so.customerName.split(' ')[0] ?? 'Procurement';
    return {
      id,
      senderName: contact,
      senderEmail: to,
      recipient: from,
      cc: [],
      subject: `RE: Quotation ${q.number} — revision required (SO ${so.number})`,
      receivedAt: `${TODAY_ISO}T13:00:00`,
      body:
        `Dear ${q.owner.split(' ')[0]},\n\n` +
        `Following our confirmed order ${so.number} (PO ${so.poNumber}), the following change to quotation ${q.number} is required before we can proceed:\n\n` +
        `${changeLines}\n\n` +
        `Please share a revised quotation reflecting the above; we will issue an updated PO against it.\n\nRegards,\n${contact}\n${so.customerName}`,
      thread: [
        { id: `th-${q.id}-so-${so.id}`, from: q.owner, date: `${q.quoteDate}T16:45:00`, snippet: `Original quotation ${q.number} shared for review…` },
      ],
      classification: 'quotation_revision',
      aiConfidence: 90,
      read: true,
      needsReview: true,
      officeId: q.officeId,
      owner: q.owner,
      partyId: q.partyId,
      customerName: q.customerName,
      customerCode: q.customerCode,
      linkedQuotation: q.number,
      revisionSendId: q.id,
      queueLabel: 'Quote Needs Revision',
      requestedChanges: email.requestedChanges,
      reviewDate: q.reviewDate,
      extraction: [
        { key: 'customer', label: 'Customer', value: q.customerName, confidence: 'high', required: true },
        { key: 'quotation', label: 'Quotation Number', value: q.number, confidence: 'high', required: true },
        { key: 'linkedSo', label: 'Raised from SO', value: so.number, confidence: 'high', required: true },
      ],
      extractionConfirmed: true,
      draftSaved: false,
      sent: false,
    };
  };

  const escalateToQuoteRevision = () => {
    if (!linkedQuote) {
      addToast({ type: 'error', title: 'No linked quotation', message: 'This Sales Order has no linked quotation to revise.' });
      setEscalateOpen(false);
      return;
    }
    const q = linkedQuote;
    const at = `${TODAY_ISO}T13:05:00`;

    // 1. Flag the quotation for revision (drives /quotations/revisions).
    updateQuotation(q.id, { workState: 'needs_revision' });

    // 2. Re-gate SO generation: the confirmed PO is now stale and must be
    //    re-issued against the revised quote. Reset every verification field to
    //    "updated PO awaited" so allResolved() is false and the derived status is
    //    'corrected_awaited' until a fresh PO-vs-Quote match is achieved.
    const resetFields: VerificationField[] = (so.verificationFields ?? []).map((f) => ({
      ...f,
      resolution: 'awaiting_po' as const,
    }));
    updateSalesOrder(so.id, {
      revisionState: undefined,
      revisionDraft: undefined,
      revisionResolution: { kind: 'quote_revision', note: so.revisionReason, by: currentUser.fullName, at },
      soGenerated: false,
      verificationStatus: 'corrected_awaited',
      verificationFields: resetFields.length ? resetFields : so.verificationFields,
      status: so.status === 'revision_required' ? so.status : 'revision_required',
      activity: [
        ...so.activity,
        {
          id: `act-${so.id}-esc-${Date.now()}`,
          date: at,
          actor: currentUser.fullName,
          action: 'Escalated to Quote Revision',
          detail: `Quotation ${q.number} flagged for revision; updated PO awaited before SO generation.`,
        },
      ],
    });

    // 3. Resolve the SO-revision request email (it has been escalated).
    updateEmail(email.id, { needsReview: false, queueLabel: 'Escalated to quote revision' });

    // 4. Open the linked quotation's revision thread in the Global Inbox.
    const existing = emails.find((e) => e.revisionSendId === q.id && !e.sent);
    const targetId = existing?.id ?? `em-rev-${q.id}`;
    if (!existing && !emails.some((e) => e.id === targetId)) {
      addEmail(buildQuoteRevisionEmail(q, targetId));
    }
    setEscalateOpen(false);
    addToast({
      type: 'info',
      title: 'Quote revision required',
      message: `Opened quotation ${q.number}. Send the revised quote, then await the updated PO.`,
    });
    navigate(`/inbox?mode=quote-revision&qtn=${q.id}&email=${targetId}`);
  };

  const attachedRev = email.attachedSalesOrder?.soNumber === so.number && email.composeIntent === 'so-revise';
  const stateMeta = so.revisionState ? REVISION_STATE[so.revisionState] : null;
  const resolution = so.revisionResolution;

  return (
    <div className="flex h-full flex-col">
      {/* Compact one-line context banner */}
      <div className="flex flex-none items-center gap-1.5 border-b border-brand-100 bg-brand-50/70 px-4 py-2 text-[12px] text-brand-700">
        <FilePenLine className="h-3.5 w-3.5 flex-none" />
        <span className="truncate">
          {resolution?.kind === 'no_revision' ? (
            <>Revision request on <span className="font-semibold">{so.number}</span> — resolved, no revision required.</>
          ) : action === 'revise' ? (
            <>Revising <span className="font-semibold">{so.number}</span> — prepare the revised SO, then add it to the email.</>
          ) : (
            <>Revision request on <span className="font-semibold">{so.number}</span> — choose how to resolve it.</>
          )}
        </span>
      </div>

      {/* Independently-scrolling workspace body */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {/* Header meta */}
      <div className="overflow-hidden rounded-xl border border-surface-200">
        <div className="flex items-center justify-between border-b border-surface-100 bg-surface-50/70 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
            <FileSpreadsheet className="h-3.5 w-3.5 text-brand-600" /> {so.number}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1.5">
            {(() => { const info = revisionSla(so); return info ? <StatusBadge tone={info.tone} label={info.label} dot /> : null; })()}
            {stateMeta && <StatusBadge tone={stateMeta.tone} label={stateMeta.label} dot />}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px] sm:grid-cols-2">
          <p><span className="text-surface-400">Current revision:</span> <span className="font-medium text-surface-800">Rev {so.revisionNumber}{so.revisionNumber === 0 ? ' (Original)' : ''} → preparing Rev {nextRevNum}</span></p>
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
          <p><span className="text-surface-400">Owner:</span> <span className="font-medium text-surface-800">{so.revisionOwner ?? so.owner}</span></p>
          <p><span className="text-surface-400">Linked PO:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Linked quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
          {(() => {
            const receivedAt = revisionReceivedAtOf(so);
            if (!receivedAt) {
              return <p><span className="text-surface-400">Requested date:</span> <span className="font-medium text-surface-800">{so.revisionRequestedDate ? formatDate(so.revisionRequestedDate, { short: true }) : '—'}</span></p>;
            }
            return (
              <>
                <p><span className="text-surface-400">Request received:</span> <span className="font-medium text-surface-800">{formatDateTime(receivedAt)}</span></p>
                <p><span className="text-surface-400">Due (24h SLA):</span> <span className="font-medium text-surface-800">{formatDateTime(slaDueAt(receivedAt))}</span></p>
              </>
            );
          })()}
          {so.revisionReason && <p className="sm:col-span-2"><span className="text-surface-400">Reason:</span> <span className="font-medium text-surface-800">{so.revisionReason}</span></p>}
        </div>
      </div>

      {/* Requested changes */}
      {(email.requestedChanges?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-amber-700">
              <History className="h-3.5 w-3.5" /> Requested changes
            </span>
            {action === 'revise' && !resolution && (
              <Button variant="secondary" size="sm" leftIcon={<Wand2 className="h-3.5 w-3.5" />} onClick={applyRequested} disabled={!canRevise || tab !== 'revised'}>
                Apply to revised SO
              </Button>
            )}
          </div>
          <ul className="space-y-1">
            {email.requestedChanges!.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 text-[11.5px] text-surface-700">
                <span className="font-medium text-surface-800">{c.label}:</span>
                <span className="text-surface-400 line-through">{c.oldValue}</span>
                <ArrowRight className="h-3 w-3 text-amber-500" />
                <span className="font-semibold text-emerald-700">{c.newValue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resolved — No Revision Required */}
      {resolution?.kind === 'no_revision' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> No revision required — request resolved
          </div>
          <p className="mt-1.5 text-[12px] text-surface-600">
            The original Sales Order stands unchanged. This request has been removed from the active revision queue.
          </p>
          {resolution.note && (
            <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-2 text-[12px] text-surface-700">
              <span className="font-medium text-surface-500">Resolution note:</span> {resolution.note}
            </p>
          )}
          <p className="mt-2 text-[11px] text-surface-400">
            Resolved by {resolution.by} · {formatDate(resolution.at, { short: true })}
          </p>
        </div>
      )}

      {/* Action chooser — the three clear ways to resolve an SO revision request */}
      {action === 'choose' && !resolution && (
        <div className="space-y-2.5">
          <p className="text-[11.5px] font-semibold uppercase tracking-[0.03em] text-surface-400">
            How do you want to resolve this request?
          </p>
          <ActionCard
            icon={<FilePenLine className="h-4 w-4" />}
            tone="brand"
            title="Revise Sales Order"
            tag="Minor revision"
            desc="Edit the existing SO, apply the requested item, delivery and commercial changes, preview and send a revised SO with a next review date."
            cta="Revise Sales Order"
            onClick={() => { setAction('revise'); setTab('revised'); }}
            disabled={!canRevise}
          />
          <ActionCard
            icon={<CircleSlash className="h-4 w-4" />}
            tone="emerald"
            title="No Revision Required"
            tag="Close request"
            desc="Close the request without changing the SO. The original order stays exactly as acknowledged and drops out of the revision queue."
            cta="Mark as No Revision Required"
            onClick={() => setNoRevOpen(true)}
            disabled={!canRevise}
          />
          <ActionCard
            icon={<FileWarning className="h-4 w-4" />}
            tone="amber"
            title="Quote Revision Required"
            tag="Major / price change"
            desc={linkedQuote
              ? `Escalate to a revision of quotation ${linkedQuote.number}. The current PO is marked stale; SO generation re-opens only after the updated PO re-matches the revised quote.`
              : 'No linked quotation is available to revise for this Sales Order.'}
            cta="Quote Revision Required"
            onClick={() => setEscalateOpen(true)}
            disabled={!canRevise || !linkedQuote}
          />
        </div>
      )}

      {action === 'revise' && !resolution && (
      <>
      {/* Back to the action chooser */}
      <button
        type="button"
        onClick={() => setAction('choose')}
        className="flex items-center gap-1 text-[11.5px] font-medium text-surface-500 hover:text-surface-700"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to actions
      </button>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-surface-200">
        <TabButton active={tab === 'original'} onClick={() => setTab('original')} icon={<FileText className="h-3.5 w-3.5" />}>
          Original Sales Order
        </TabButton>
        <TabButton active={tab === 'revised'} onClick={() => setTab('revised')} icon={<FilePenLine className="h-3.5 w-3.5" />}>
          Revised Sales Order{changeCount > 0 ? ` · ${changeCount}` : ''}
        </TabButton>
      </div>

      {tab === 'original' ? (
        <OriginalTab so={so} original={original} onPreview={() => setPreview('original')} />
      ) : (
        <div className="space-y-3">
          {/* 1. Client Details */}
          {/* Sections 1–2 rarely change during a revision — collapsed by default
              to keep the frequently edited items/terms sections in view. */}
          <FormSection icon={<User2 className="h-3.5 w-3.5" />} n={1} label="Client Details" defaultOpen={false}>
            <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
              <span className="text-surface-400">Customer / Party:</span>{' '}
              <span className="font-semibold text-surface-800">{so.customerName}</span>
              <span className="text-surface-400"> · {so.customerCode}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} className="py-1.5 text-[13px]" placeholder="+91 …" />
              <TextField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="py-1.5 text-[13px]" placeholder="orders@customer.com" />
              <TextField label="GSTIN" value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} className="py-1.5 text-[13px]" placeholder="27AAACR…" />
              <SelectField label="Salesperson" value={form.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} className="py-1.5 text-[13px]" />
            </div>
            <TextAreaField label="Billing Address" required rows={2} value={form.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} className={classNames('text-[13px]', changedFields.billing && 'ring-1 ring-amber-300')} />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="label mb-0">Consignee / Shipping Address</label>
                <label className="flex items-center gap-1.5 text-[11px] text-surface-500">
                  <Toggle checked={form.sameAsBilling} onChange={(v) => set('sameAsBilling', v)} />
                  Same as billing
                </label>
              </div>
              <TextAreaField label="" rows={2} value={effectiveShipping} disabled={form.sameAsBilling} onChange={(e) => set('shippingAddress', e.target.value)} className={classNames('text-[13px]', changedFields.shipping && 'ring-1 ring-amber-300')} placeholder={form.sameAsBilling ? 'Same as billing address' : 'Shipping address'} />
            </div>
            <div className="grid grid-cols-1 gap-2">
              <TextField label="Kind Attention — Name" value={form.kindAttentionName} onChange={(e) => set('kindAttentionName', e.target.value)} className="py-1.5 text-[13px]" placeholder="Contact person" />
              <TextField label="Kind Attention — Email" type="email" value={form.kindAttentionEmail} onChange={(e) => set('kindAttentionEmail', e.target.value)} className="py-1.5 text-[13px]" placeholder="contact@customer.com" />
            </div>
          </FormSection>

          {/* 2. Order Details */}
          <FormSection icon={<FileText className="h-3.5 w-3.5" />} n={2} label="Order Details" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Customer PO Number" value={form.poNumber} onChange={(e) => set('poNumber', e.target.value)} className="py-1.5 text-[13px]" />
              <TextField label="PO Date" type="date" value={form.poDate} onChange={(e) => set('poDate', e.target.value)} className="py-1.5 text-[13px]" />
            </div>
            <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
              <span className="text-surface-400">Linked Quotation:</span>{' '}
              <span className="font-semibold text-surface-800">{so.quotationNumber ?? '—'}</span>
            </div>
            <SelectField label="Sales Office" value={form.officeId} onChange={(e) => set('officeId', e.target.value)} options={(role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === so.officeId)).map((o) => ({ value: o.id, label: o.name }))} className="py-1.5 text-[13px]" />
            <div className="grid grid-cols-1 gap-2">
              <SelectField label="Owner / Sales Person" value={form.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} className="py-1.5 text-[13px]" />
              <SelectField label="Office Admin" value={form.officeAdmin} onChange={(e) => set('officeAdmin', e.target.value)} options={officeAdmins.map((o) => ({ value: o, label: o }))} placeholder="Select office admin" className="py-1.5 text-[13px]" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                <span className="text-surface-400">SO Acknowledgement No:</span>{' '}
                <span className="font-semibold text-surface-800">{so.number}</span>
              </div>
              <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                <span className="text-surface-400">SO Date:</span>{' '}
                <span className="font-semibold text-surface-800">{formatDate(so.createdDate, { short: true })}</span>
              </div>
            </div>
          </FormSection>

          {/* 3. Catalogue Items */}
          <FormSection
            icon={<Boxes className="h-3.5 w-3.5" />}
            n={3}
            label="Catalogue Items"
            action={<span className="text-[11px] text-surface-400">{lines.length} line(s)</span>}
          >
            <RevItemEditor
              items={lines}
              catalog={catalog}
              specs={specs}
              original={original.items}
              onChange={setLines}
              onSpecs={setSpecs}
            />
          </FormSection>

          {/* 4. Commercial Terms */}
          <FormSection icon={<Receipt className="h-3.5 w-3.5" />} n={4} label="Commercial Terms">
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Packing (%)" type="number" min={0} max={100} value={form.packingPct} onChange={(e) => set('packingPct', Math.max(0, Math.min(100, Number(e.target.value))))} className="py-1.5 text-[13px]" hint={`≈ ${formatINR(packingAmount)}`} />
              <TextField label="Warranty (Years)" type="number" min={1} value={form.warrantyYears} onChange={(e) => set('warrantyYears', Math.max(1, Number(e.target.value)))} className={classNames('py-1.5 text-[13px]', changedFields.warranty && 'ring-1 ring-amber-300')} />
              <SelectField label="Delivery Terms" value={form.deliveryTerms} onChange={(e) => set('deliveryTerms', e.target.value)} options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))} placeholder="Select delivery option" className={classNames('py-1.5 text-[13px]', changedFields.delivery && 'ring-1 ring-amber-300')} wrapClassName="col-span-2" />
              <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} className={classNames('py-1.5 text-[13px]', changedFields.deliveryDate && 'ring-1 ring-amber-300')} wrapClassName="col-span-2" />
            </div>
            <div>
              <label className="label">Payment Terms</label>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="input py-1.5 pr-7 text-[13px]"
                        value={form.payment[f.key]}
                        onChange={(e) => set('payment', { ...form.payment, [f.key]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] text-surface-400">%</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-surface-500">{SO_PAYMENT_LABEL[f.key]}</p>
                  </div>
                ))}
              </div>
              <div className={classNames('mt-1.5 text-[11px] font-medium', paymentSum === 100 ? 'text-emerald-600' : 'text-rose-600')}>
                Total: {paymentSum}%{paymentSum !== 100 && ' — must total 100%.'}
                {changedFields.payment && paymentSum === 100 && <span className="ml-1 text-amber-600">· changed</span>}
              </div>
            </div>
            <TextField label="Credit Days" type="number" min={0} value={form.creditDays} onChange={(e) => set('creditDays', Math.max(0, Number(e.target.value)))} className="py-1.5 text-[13px]" hint="Credit period in days (if applicable)" />
          </FormSection>

          {/* 5. Amount Summary */}
          <FormSection icon={<Calculator className="h-3.5 w-3.5" />} n={5} label="Amount Summary">
            <InfoRow label={`Total Quantity`} value={`${lines.reduce((s, l) => s + l.quantity, 0)}`} />
            <InfoRow label="Basic Amount" value={formatINR(totals.subtotal)} />
            <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
            <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
            <InfoRow label="GST / IGST" value={formatINR(totals.tax)} />
            <InfoRow label={`Packing & Forwarding (${form.packingPct}%)`} value={formatINR(packingAmount)} />
            <div className="mt-1.5 flex items-center justify-between border-t border-surface-200 pt-2">
              <span className="text-[13px] font-semibold text-surface-800">Grand Total</span>
              <span className="text-[15px] font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
            </div>
            <p className="mt-1 text-[11px] italic text-surface-500">{amountInWords(totals.grandTotal)}</p>
          </FormSection>

        </div>
      )}
      </>
      )}
      </div>

      {/* Sticky action footer — primary revised-SO actions stay visible while
          the owner is preparing a minor revision. */}
      {action === 'revise' && !resolution && (
      <div className="flex-none space-y-2 border-t border-surface-100 bg-surface-50/60 px-4 py-3">
        {attachedRev && (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
            <Paperclip className="h-3.5 w-3.5 flex-none" /> Revised SO attached — set the review date and send from the centre panel.
          </p>
        )}
        {/* Secondary Save / Preview are compact icon buttons; the primary
            Add-to-Email action keeps its visible text label. */}
        <div className="flex items-center gap-2">
          <IconButton label="Save Draft" icon={<Save className="h-4 w-4" />} onClick={() => saveDraft()} disabled={!canRevise} />
          <IconButton label="Preview Revised SO" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview('revised')} />
          <Button
            variant="primary"
            size="sm"
            className="min-w-0 flex-1"
            leftIcon={canRevise ? <Mail className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
            onClick={addToEmail}
            disabled={!canRevise}
            title="Attach the revised Sales Order to the email in the centre panel"
          >
            {attachedRev ? 'Update Revised SO in Email' : 'Add Revised SO to Email'}
          </Button>
        </div>
        {!canRevise && <p className="text-center text-[11px] font-medium text-rose-600">Sales Order edit permission required.</p>}
      </div>
      )}

      {/* No Revision Required — optional resolution note */}
      <Modal
        open={noRevOpen}
        onClose={() => setNoRevOpen(false)}
        size="sm"
        title="Mark as No Revision Required"
        subtitle={`${so.number} · ${so.customerName}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNoRevOpen(false)}>Cancel</Button>
            <Button variant="primary" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={resolveNoRevision}>
              Mark as Resolved
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-[12.5px] text-surface-600">
            The original Sales Order will be kept <span className="font-medium text-surface-800">unchanged</span> and this
            request will be removed from the active revision queue. No revised SO is sent.
          </p>
          <TextAreaField
            label="Resolution note (optional)"
            rows={3}
            value={noRevNote}
            onChange={(e) => setNoRevNote(e.target.value)}
            placeholder="e.g. Customer confirmed on call that the confirmed order is correct as-is."
            className="text-[13px]"
          />
        </div>
      </Modal>

      {/* Quote Revision Required — confirm escalation */}
      <Modal
        open={escalateOpen}
        onClose={() => setEscalateOpen(false)}
        size="sm"
        title="Quote Revision Required"
        subtitle={linkedQuote ? `Quotation ${linkedQuote.number} · ${so.customerName}` : so.customerName}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEscalateOpen(false)}>Cancel</Button>
            <Button variant="primary" leftIcon={<FileWarning className="h-4 w-4" />} onClick={escalateToQuoteRevision} disabled={!linkedQuote}>
              Open Quote Revision
            </Button>
          </div>
        }
      >
        <div className="space-y-2.5 text-[12.5px] text-surface-600">
          <p>This is a major change (e.g. price). It will:</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-500" /> Flag quotation <span className="font-medium text-surface-800">{linkedQuote?.number ?? '—'}</span> for revision and open its Global Inbox thread.</li>
            <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-500" /> Mark the current PO as requiring an updated PO.</li>
            <li className="flex items-start gap-2"><BadgeCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-brand-500" /> Re-gate SO generation until PO-vs-Quote verification fully matches again.</li>
          </ul>
        </div>
      </Modal>

      {preview !== null && (() => {
        const isOrig = preview === 'original';
        const previewLines = isOrig ? original.items : lines;
        const packingAmount = Math.round((computeTotals(previewLines, 0).taxable * form.packingPct) / 100);
        const soForDoc: SalesOrder = {
          ...so,
          items: previewLines,
          billingAddress: isOrig ? original.billingAddress : form.billingAddress,
          shippingAddress: isOrig ? original.shippingAddress : effectiveShipping,
          deliveryDate: isOrig ? original.deliveryDate : form.expectedDelivery,
          paymentTerms: isOrig ? original.paymentTerms : revisedPaymentText,
          deliveryTerms: isOrig ? original.deliveryTerms : form.deliveryTerms,
          officeId: isOrig ? so.officeId : form.officeId,
          poNumber: isOrig ? so.poNumber : form.poNumber,
          packingCharges: packingAmount,
          // Revised preview must reflect the revised commercial terms and the
          // revision it is preparing — the resolver reads commercials/warranty/
          // revisionNumber, so override them (not just the flat paymentTerms).
          warranty: isOrig ? so.warranty : formatWarranty(form.warrantyYears),
          revisionNumber: isOrig ? 0 : nextRevNum,
          commercials: isOrig
            ? so.commercials
            : { packingPct: form.packingPct, payment: { ...form.payment }, creditDays: form.creditDays },
          kindAttention: form.kindAttentionName ? { name: form.kindAttentionName } : so.kindAttention,
        };
        const resolved = resolveSalesOrder(soForDoc, { parties, catalog: ITEMS });
        return (
          <SoRevisionPreviewModal
            open
            onClose={() => setPreview(null)}
            title={isOrig ? 'Original Sales Order Preview' : `Revised Sales Order Preview · Rev ${nextRevNum}`}
            subtitle={`${so.number} · ${so.customerName}`}
            resolved={resolved}
          />
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Original Sales Order — read-only tab.
// ---------------------------------------------------------------------------
function OriginalTab({
  so,
  original,
  onPreview,
}: {
  so: SalesOrder;
  original: SORevisionSnapshot;
  onPreview: () => void;
}) {
  const totals = computeTotals(original.items, so.packingCharges);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-surface-200 bg-surface-50/60 px-3 py-2 text-[11.5px] text-surface-500">
        This is the confirmed Sales Order as originally acknowledged. It is read-only — make changes on the Revised Sales Order tab.
      </div>

      <div className="overflow-hidden rounded-xl border border-surface-200">
        <div className="grid grid-cols-1 gap-x-5 gap-y-1 px-3 py-2.5 text-[12px] sm:grid-cols-2">
          <p><span className="text-surface-400">Customer:</span> <span className="font-medium text-surface-800">{so.customerName}</span></p>
          <p><span className="text-surface-400">Sales Office:</span> <span className="font-medium text-surface-800">{officeName(so.officeId)}</span></p>
          <p><span className="text-surface-400">PO Number:</span> <span className="font-medium text-surface-800">{so.poNumber}</span></p>
          <p><span className="text-surface-400">Quotation:</span> <span className="font-medium text-surface-800">{so.quotationNumber ?? '—'}</span></p>
          <p><span className="text-surface-400">Delivery Terms:</span> <span className="font-medium text-surface-800">{original.deliveryTerms}</span></p>
          <p><span className="text-surface-400">Delivery Date:</span> <span className="font-medium text-surface-800">{original.deliveryDate ? formatDate(original.deliveryDate, { short: true }) : '—'}</span></p>
          <p className="sm:col-span-2"><span className="text-surface-400">Payment:</span> <span className="font-medium text-surface-800">{original.paymentTerms}</span></p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-surface-200">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-surface-200 bg-surface-50 text-[11px] font-semibold uppercase tracking-[0.02em] text-surface-500">
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Unit Price</th>
              <th className="px-2 py-2 text-right">Disc %</th>
              <th className="px-3 py-2 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {original.items.map((it) => (
              <tr key={it.id}>
                <td className="px-3 py-2"><p className="font-medium text-surface-800">{it.description || '—'}</p><p className="text-[11px] text-surface-400">{it.itemCode}{it.hsnCode ? ` · HSN ${it.hsnCode}` : ''}</p></td>
                <td className="px-2 py-2 text-right text-surface-700">{it.quantity} {it.unit}</td>
                <td className="px-2 py-2 text-right text-surface-700">{formatINR(it.unitPrice)}</td>
                <td className="px-2 py-2 text-right text-surface-700">{it.discountPct}%</td>
                <td className="px-3 py-2 text-right font-medium text-surface-800">{formatINR(lineTotal(it.quantity, it.unitPrice, it.discountPct))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-xs space-y-0.5">
        <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
        <InfoRow label="GST" value={formatINR(totals.tax)} />
        <div className="mt-1 flex items-center justify-between border-t border-surface-200 pt-2">
          <span className="text-[13px] font-semibold text-surface-800">Order Value</span>
          <span className="text-[15px] font-bold text-surface-900">{formatINR(totals.grandTotal)}</span>
        </div>
      </div>

      <Button variant="secondary" size="sm" className="w-full" leftIcon={<Eye className="h-4 w-4" />} onClick={onPreview}>
        Preview Original SO
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalogue-item editor with per-line expandable Technical Specifications and
// old → new change highlighting against the Original snapshot.
// ---------------------------------------------------------------------------
let revLineSeq = 0;

function RevItemEditor({
  items,
  catalog,
  specs,
  original,
  onChange,
  onSpecs,
}: {
  items: LineItem[];
  catalog: import('@/types').Item[];
  specs: Record<string, TechnicalSpecs>;
  original: LineItem[];
  onChange: (lines: LineItem[]) => void;
  onSpecs: (updater: (prev: Record<string, TechnicalSpecs>) => Record<string, TechnicalSpecs>) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const origById = (id: string) => original.find((o) => o.id === id);

  const update = (id: string, patch: Partial<LineItem>) => {
    onChange(items.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };

  const onSelectItem = (id: string, itemId: string) => {
    const cat = catalog.find((c) => c.id === itemId);
    if (!cat) {
      update(id, { itemId: '', itemCode: '', description: '', hsnCode: '', unit: '', unitPrice: 0 });
      return;
    }
    update(id, { itemId: cat.id, itemCode: cat.code, description: cat.name, hsnCode: cat.hsnCode, unit: cat.unit, unitPrice: cat.unitPrice });
    onSpecs((prev) => ({ ...prev, [id]: specsForLine({ ...cat, itemId: cat.id, itemCode: cat.code, description: cat.name } as unknown as LineItem, catalog) }));
  };

  const addLine = () => {
    const id = `revln-${++revLineSeq}`;
    onChange([...items, { id, itemId: '', itemCode: '', description: '', hsnCode: '', quantity: 1, unit: 'Nos', unitPrice: 0, discountPct: 0, taxPct: 18 }]);
    onSpecs((prev) => ({ ...prev, [id]: {} }));
  };

  const removeLine = (id: string) => {
    onChange(items.filter((l) => l.id !== id));
    setOpenId((o) => (o === id ? null : o));
  };

  const setSpecField = (id: string, key: keyof TechnicalSpecs, value: string) => {
    onSpecs((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  };

  const changedCell = 'bg-amber-50 ring-1 ring-inset ring-amber-300 rounded';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((line) => {
          const o = origById(line.id);
          const isNew = !o;
          const qtyChanged = !!o && o.quantity !== line.quantity;
          const priceChanged = !!o && o.unitPrice !== line.unitPrice;
          const discChanged = !!o && o.discountPct !== line.discountPct;
          const open = openId === line.id;
          const sp = specs[line.id] ?? {};
          return (
            <div key={line.id} className={classNames('rounded-xl border', isNew ? 'border-emerald-300' : 'border-surface-200')}>
              <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
                <select
                  value={line.itemId}
                  onChange={(e) => onSelectItem(line.id, e.target.value)}
                  className="input min-w-[180px] flex-1 py-1.5 text-[13px]"
                >
                  <option value="">Select item…</option>
                  {catalog.filter((c) => c.active || c.id === line.itemId).map((c) => (
                    <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                  ))}
                </select>
                {isNew && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-200">New</span>}
                <button
                  type="button"
                  onClick={() => removeLine(line.id)}
                  className="rounded p-1.5 text-surface-400 hover:bg-rose-50 hover:text-rose-500"
                  aria-label="Remove line"
                >
                  <Trash2Icon />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 px-2.5 pb-2 sm:grid-cols-4">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">Qty</span>
                  <input type="number" min={0} value={line.quantity} onChange={(e) => update(line.id, { quantity: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', qtyChanged && changedCell)} />
                  {qtyChanged && <span className="mt-0.5 block text-[11px] text-amber-600">was {o!.quantity}</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">Unit Price</span>
                  <input type="number" min={0} value={line.unitPrice} onChange={(e) => update(line.id, { unitPrice: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', priceChanged && changedCell)} />
                  {priceChanged && <span className="mt-0.5 block text-[11px] text-amber-600">was {formatINR(o!.unitPrice)}</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">Disc %</span>
                  <input type="number" min={0} max={100} value={line.discountPct} onChange={(e) => update(line.id, { discountPct: Math.max(0, Number(e.target.value)) })} className={classNames('input py-1.5 text-right text-[13px]', discChanged && changedCell)} />
                  {discChanged && <span className="mt-0.5 block text-[11px] text-amber-600">was {o!.discountPct}%</span>}
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-surface-500">GST %</span>
                  <input type="number" min={0} max={100} value={line.taxPct} onChange={(e) => update(line.id, { taxPct: Math.max(0, Number(e.target.value)) })} className="input py-1.5 text-right text-[13px]" />
                </label>
              </div>

              <div className="flex items-center justify-between border-t border-surface-100 px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : line.id)}
                  className="flex items-center gap-1 text-[11.5px] font-medium text-brand-600 hover:text-brand-700"
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Technical Specifications
                </button>
                <span className="text-[11.5px] text-surface-500">HSN {line.hsnCode || '—'} · {line.unit || '—'} · <span className="font-medium text-surface-800">{formatINR(lineTotal(line.quantity, line.unitPrice, line.discountPct))}</span></span>
              </div>

              {open && (
                <div className="grid grid-cols-1 gap-2 border-t border-surface-100 bg-surface-50/50 px-2.5 py-2.5 sm:grid-cols-2">
                  {TECH_SPEC_FIELDS.map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-0.5 block text-[11px] text-surface-500">{f.label}</span>
                      <input
                        type={f.key === 'expectedArrival' ? 'date' : 'text'}
                        value={(sp[f.key] as string) ?? ''}
                        onChange={(e) => setSpecField(line.id, f.key, e.target.value)}
                        className="input py-1.5 text-[12.5px]"
                        placeholder={f.label}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-surface-200 px-3 py-6 text-center text-[12px] text-surface-400">No line items — add one below.</div>
        )}
      </div>
      <Button variant="secondary" size="sm" leftIcon={<PlusIcon />} onClick={addLine} type="button">Add Line</Button>
    </div>
  );
}

// Small local icons to avoid another lucide import churn.
function Trash2Icon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>;
}
function PlusIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>;
}

// ---------------------------------------------------------------------------
// Compact section wrapper (mirrors the SO Generation form's FormSection).
// ---------------------------------------------------------------------------
function FormSection({
  icon,
  n,
  label,
  action,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode;
  n: number;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl border border-surface-200">
      <div className="flex items-center justify-between gap-2 border-b border-surface-100 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-surface-700"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 flex-none text-surface-400" /> : <ChevronRight className="h-3.5 w-3.5 flex-none text-surface-400" />}
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded bg-brand-50 text-brand-600">{icon}</span>
          <span className="text-surface-400">{n}.</span> {label}
        </button>
        {action}
      </div>
      {open && <div className="space-y-2.5 p-3">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One of the three revision-disposition cards shown in the action chooser.
// ---------------------------------------------------------------------------
function ActionCard({
  icon,
  tone,
  title,
  tag,
  desc,
  cta,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  tone: 'brand' | 'emerald' | 'amber';
  title: string;
  tag: string;
  desc: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const toneMap = {
    brand: { chip: 'bg-brand-50 text-brand-600', tag: 'bg-brand-50 text-brand-600 ring-brand-200' },
    emerald: { chip: 'bg-emerald-50 text-emerald-600', tag: 'bg-emerald-50 text-emerald-600 ring-emerald-200' },
    amber: { chip: 'bg-amber-50 text-amber-600', tag: 'bg-amber-50 text-amber-600 ring-amber-200' },
  }[tone];
  return (
    <div className="rounded-xl border border-surface-200 px-3.5 py-3">
      <div className="mb-1 flex items-center gap-2">
        <span className={classNames('flex h-6 w-6 flex-none items-center justify-center rounded-lg', toneMap.chip)}>{icon}</span>
        <span className="text-[13px] font-semibold text-surface-800">{title}</span>
        <span className={classNames('ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset', toneMap.tag)}>{tag}</span>
      </div>
      <p className="mb-2.5 text-[12px] leading-relaxed text-surface-500">{desc}</p>
      <Button variant="secondary" size="sm" className="w-full" onClick={onClick} disabled={disabled} leftIcon={icon}>
        {cta}
      </Button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-[12px] font-medium transition-colors',
        active ? 'border-brand-600 text-brand-700' : 'border-transparent text-surface-500 hover:border-surface-300 hover:text-surface-700'
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sales Order document preview — original or revised.
// ---------------------------------------------------------------------------
function SoRevisionPreviewModal({
  open,
  onClose,
  title,
  subtitle,
  resolved,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  resolved: ResolvedSalesOrder;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={title}
      subtitle={subtitle}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      <SalesOrderDocument resolved={resolved} showLetterhead />
    </Modal>
  );
}
