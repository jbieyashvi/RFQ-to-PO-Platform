import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Boxes,
  Calculator,
  ChevronDown,
  Eye,
  FileSpreadsheet,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Save,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import type {
  CommercialTerms,
  InboxEmail,
  LineItem,
  Party,
  PaymentTerms,
  PoProofType,
  Quotation,
  SalesOrder,
} from '@/types';
import {
  Button,
  Modal,
  TextField,
  SelectField,
  TextAreaField,
  Toggle,
  ItemLineEditor,
  InfoRow,
} from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { OFFICES, officeName } from '@/data/offices';
import { OWNERS, USERS } from '@/data/users';
import { classNames, computeTotals, formatDate, formatINR } from '@/lib/format';
import {
  activeDeliveryOptions,
  defaultDeliveryOption,
  formatPaymentTerms,
  formatWarranty,
  paymentTotal,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';
import { resolveSalesOrder, type ResolvedSalesOrder } from '@/lib/salesOrder';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
import { soSendEmailPatch } from './helpers';

// Prototype "today" — kept consistent with the rest of the app's seeded data.
const TODAY_ISO = '2026-08-13';

const clone = (it: LineItem): LineItem => ({ ...it });

// Clearer, spec-aligned labels for the four payment buckets (shared
// PAYMENT_FIELDS keys/order are reused; only display labels differ).
const SO_PAYMENT_LABEL: Record<keyof PaymentTerms, string> = {
  advance: 'Advance %',
  beforeDispatch: 'Before Dispatch %',
  creditDays: 'Credit %',
  afterInstall: 'After Installation %',
};

const SO_PO_PROOF_OPTIONS: { value: PoProofType; label: string; icon: typeof Phone }[] = [
  { value: 'uploaded', label: 'PO Document', icon: FileText },
  { value: 'phone_call', label: 'Phone Call', icon: Phone },
  { value: 'message', label: 'Message / WhatsApp', icon: MessageSquare },
];

// The SO Generation form mirrors "Create Sales Order Manually" but is scoped to
// the already-verified PO record: the customer is fixed (it came from the
// verified PO/quotation), so there is no new-customer toggle here.
interface SoForm {
  billingAddress: string;
  shippingAddress: string;
  sameAsBilling: boolean;
  phone: string;
  email: string;
  pincode: string;
  gstin: string;
  kindAttentionName: string;
  kindAttentionEmail: string;
  poNumber: string;
  poDate: string;
  officeId: string;
  owner: string;
  officeAdmin: string;
  poProofType: PoProofType;
  poProofNotes: string;
  packingPct: number;
  deliveryTerms: string;
  deliveryTimeline: string;
  warrantyYears: number;
  creditDays: number;
  payment: PaymentTerms;
  expectedDelivery: string;
  freight: string;
  inspection: string;
  additionalTerms: string;
}

// Prefill from the verified Sales Order, its accepted quotation and the Party
// Master. Commercial terms use the SO's structured snapshot when present and
// fall back to the T&C Master defaults for older seed records.
function initSoForm(so: SalesOrder, party: Party | undefined, ct: CommercialTerms): SoForm {
  const taxable = computeTotals(so.items, 0).taxable;
  const derivedPacking = taxable > 0 ? Math.round((so.packingCharges / taxable) * 100) : ct.packingPct;
  return {
    billingAddress: so.billingAddress ?? party?.billingAddress ?? '',
    shippingAddress: so.shippingAddress ?? party?.shippingAddress ?? '',
    sameAsBilling: false,
    phone: so.customerPhone ?? party?.phone ?? '',
    email: so.customerEmail ?? party?.email ?? '',
    pincode: so.pincode ?? '',
    gstin: party?.gstin ?? '',
    kindAttentionName: so.kindAttentionName ?? party?.contactPerson ?? '',
    kindAttentionEmail: so.kindAttentionEmail ?? party?.email ?? '',
    poNumber: so.poNumber,
    poDate: so.poDate,
    officeId: so.officeId,
    owner: so.owner,
    officeAdmin: so.officeAdmin ?? '',
    poProofType: so.poProofType ?? 'uploaded',
    poProofNotes:
      so.poProofNotes ??
      `PO ${so.poNumber} verified against accepted quotation ${so.quotationNumber ?? ''}.`.trim(),
    packingPct: so.commercials?.packingPct ?? derivedPacking,
    deliveryTerms: so.deliveryTerms || defaultDeliveryOption(ct)?.name || '',
    deliveryTimeline: so.deliveryTimeline ?? '',
    warrantyYears: parseInt(so.warranty, 10) || ct.warrantyYears,
    creditDays: so.commercials?.creditDays ?? 0,
    payment: so.commercials?.payment ? { ...so.commercials.payment } : { ...ct.payment },
    expectedDelivery: so.deliveryDate ?? '',
    freight: so.freight ?? '',
    inspection: so.inspection ?? '',
    additionalTerms: so.additionalTerms ?? '',
  };
}

type SectionKey = 'client' | 'consignee' | 'items' | 'terms' | 'summary';

// Which drawer section owns each validation error — used to auto-expand the
// sections that still need attention when Generate is blocked.
const ERROR_SECTION: Record<string, SectionKey> = {
  billingAddress: 'client',
  phone: 'client',
  gstin: 'client',
  kindAttentionName: 'client',
  poNumber: 'client',
  poDate: 'client',
  officeId: 'client',
  owner: 'client',
  poProof: 'client',
  lines: 'items',
  expectedDelivery: 'terms',
  payment: 'terms',
};

/**
 * SO Generation modal — the full editable Sales Order form on a large centred
 * modal over the inbox, opened from the PO-verification workspace once every
 * mismatch is resolved.
 *
 * A modal rather than a side drawer because generating a Sales Order is a
 * committing act on a wide document: eleven prefilled fields, a line table and
 * a tax summary all need to be read at once, and a 65%-wide drawer made the
 * line table scroll horizontally against a thread nobody is reading at that
 * moment. The full width buys the whole document at a glance.
 *
 * Footer actions:
 *   • Save Draft            → persist the edited fields onto the SO record
 *   • Preview SO            → the shared Sales Order Acknowledgement document
 *   • Generate & Add to Email → flip the SO live and attach it to the compose window.
 * ERP Handoff is NOT created here — the SO is submitted to ERP Handoff only
 * once the customer email is actually sent from the compose window.
 */
export function SoGenerationModal({
  email,
  so,
  quote,
  onClose,
  onCompose,
}: {
  email: InboxEmail;
  so: SalesOrder;
  quote: Quotation | null;
  onClose: () => void;
  /** The SO is on the email — open the Gmail-style compose window on it. */
  onCompose?: () => void;
}) {
  const {
    parties,
    items: catalog,
    commercialTerms,
    role,
    updateSalesOrder,
    updateEmail,
    addToast,
    currentUser,
    can,
  } = useApp();
  const canGenerate = can('sales_orders', 'create');

  const party = parties.find((p) => p.id === so.partyId);
  const generated = so.soGenerated || !!so.erpHandoff;

  const [form, setForm] = useState<SoForm>(() => initSoForm(so, party, commercialTerms));
  const [lines, setLines] = useState<LineItem[]>(() => so.items.map(clone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    client: true,
    consignee: true,
    items: true,
    terms: true,
    summary: true,
  });

  const set = <K extends keyof SoForm>(k: K, v: SoForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggleSection = (k: SectionKey) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // Escape closes the modal — unless the preview modal is open (it owns Esc).
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !preview) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, preview]);

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

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.billingAddress.trim()) e.billingAddress = 'Billing address is required';
    if (!form.phone.trim() && !form.email.trim()) e.phone = 'Provide a phone number or email';
    if (!form.gstin.trim()) e.gstin = 'GSTIN is required';
    if (!form.kindAttentionName.trim()) e.kindAttentionName = 'Kind attention name is required';
    if (!form.poNumber.trim()) e.poNumber = 'PO number is required';
    if (!form.poDate) e.poDate = 'PO date is required';
    if (!form.officeId) e.officeId = 'Sales office is required';
    if (!form.owner) e.owner = 'Owner is required';
    if (!form.poProofNotes.trim()) e.poProof = 'Add the PO document reference and details';
    if (!form.expectedDelivery) e.expectedDelivery = 'Expected delivery date is required';
    if (paymentSum !== 100) e.payment = 'Payment terms must total 100%.';
    if (lines.length === 0) e.lines = 'Add at least one line item';
    else if (lines.some((l) => !l.itemId)) e.lines = 'Every line must have an item selected';
    else if (lines.some((l) => l.quantity <= 0)) e.lines = 'Quantities must be greater than 0';
    else if (lines.some((l) => l.unitPrice <= 0)) e.lines = 'Unit price must be greater than 0';
    setErrors(e);
    if (Object.keys(e).length) {
      // Expand every section that still holds an error so nothing is hidden.
      setOpen((o) => {
        const next = { ...o };
        Object.keys(e).forEach((key) => {
          const s = ERROR_SECTION[key];
          if (s) next[s] = true;
        });
        return next;
      });
      addToast({ type: 'error', title: 'Please fix the highlighted fields', message: `${Object.keys(e).length} field(s) need attention.` });
    }
    return Object.keys(e).length === 0;
  };

  // The edited SO fields, ready to merge onto the existing record. Never mints a
  // new SO number — the verified record already owns one.
  const buildPatch = (): Partial<SalesOrder> => {
    const paymentTermsText =
      formatPaymentTerms(form.payment) + (form.creditDays > 0 ? `, ${form.creditDays} Credit Days` : '');
    return {
      poNumber: form.poNumber,
      poDate: form.poDate,
      officeId: form.officeId,
      owner: form.owner,
      officeAdmin: form.officeAdmin || undefined,
      billingAddress: form.billingAddress,
      shippingAddress: effectiveShipping,
      customerPhone: form.phone || undefined,
      customerEmail: form.email || undefined,
      pincode: form.pincode || undefined,
      kindAttentionName: form.kindAttentionName || undefined,
      kindAttentionEmail: form.kindAttentionEmail || undefined,
      poProofType: form.poProofType,
      poProofNotes: form.poProofNotes || undefined,
      deliveryDate: form.expectedDelivery,
      items: lines.map(clone),
      paymentTerms: paymentTermsText,
      deliveryTerms: form.deliveryTerms,
      warranty: formatWarranty(form.warrantyYears),
      packingCharges: packingAmount,
      value: totals.grandTotal,
      poValue: totals.grandTotal,
      commercials: { packingPct: form.packingPct, payment: { ...form.payment }, creditDays: form.creditDays },
      // Structured shared-model sections (prefilled from the verified PO / party).
      buyer: {
        name: so.customerName,
        code: so.customerCode,
        address: form.billingAddress,
        pincode: form.pincode || undefined,
        country: 'India',
        phone: form.phone || undefined,
        email: form.email || undefined,
        gstin: form.gstin || undefined,
      },
      consignee: {
        name: so.customerName,
        address: effectiveShipping,
        country: 'India',
        gstin: form.gstin || undefined,
      },
      consigneeSameAsBuyer: form.sameAsBilling || effectiveShipping.trim() === form.billingAddress.trim(),
      kindAttention:
        form.kindAttentionName || form.kindAttentionEmail
          ? { name: form.kindAttentionName || undefined, email: form.kindAttentionEmail || undefined }
          : undefined,
      salesperson: { name: form.owner, officeId: form.officeId, owner: form.owner },
      deliveryTimeline: form.deliveryTimeline || undefined,
      expectedDeliveryDate: form.expectedDelivery || undefined,
      freight: form.freight || undefined,
      inspection: form.inspection || undefined,
      additionalTerms: form.additionalTerms || undefined,
    };
  };

  // Live document preview — resolved from the current (possibly edited) form
  // merged onto the SO record, so the preview matches exactly what Save writes.
  const previewResolved = useMemo(
    () => resolveSalesOrder({ ...so, ...buildPatch() }, { parties, catalog }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [so, form, lines]
  );

  // ---- Footer action 1: Save Draft — persist the edits, stay in the drawer ---
  const saveDraft = () => {
    const now = `${TODAY_ISO}T12:35:00`;
    updateSalesOrder(so.id, {
      ...buildPatch(),
      activity: [
        ...so.activity,
        {
          id: `act-${so.id}-sodraft-${Date.now()}`,
          date: now,
          actor: currentUser.fullName,
          action: generated ? 'Sales Order updated' : 'Sales Order draft saved',
          detail: generated ? `${so.number} edited before sending` : `${so.number} draft saved from SO Generation`,
        },
      ],
    });
    addToast({ type: 'success', title: 'Draft saved', message: `${so.number} saved. You can continue editing or generate it when ready.` });
  };

  // ---- Footer action 3: Generate & Add to Email ------------------------------
  // Persist the (possibly edited) fields, flip the SO live, and attach the
  // generated document straight to the compose window. The SO is submitted to
  // ERP Handoff only AFTER that email is actually sent — not here.
  // Guarded so re-running on an already-generated SO saves + re-attaches without
  // minting a new SO. Stays in the inbox; this modal closes onto the compose window.
  const generateAndAttach = () => {
    if (!validate()) return;
    const now = `${TODAY_ISO}T12:30:00`;
    const patch = buildPatch();
    const activity = [...so.activity];
    if (!generated) {
      activity.push({
        id: `act-${so.id}-sogen-${Date.now()}`,
        date: now,
        actor: currentUser.fullName,
        action: 'Sales Order generated',
        detail: `${so.number} generated from verified PO & quotation — will be submitted to ERP Handoff once emailed`,
      });
    } else {
      activity.push({
        id: `act-${so.id}-soedit-${Date.now()}`,
        date: now,
        actor: currentUser.fullName,
        action: 'Sales Order updated',
        detail: `${so.number} edited and re-attached to the email`,
      });
    }
    updateSalesOrder(so.id, {
      ...patch,
      soGenerated: true,
      status: 'so_sent',
      verifiedBy: so.verifiedBy ?? currentUser.fullName,
      verifiedAt: so.verifiedAt ?? now,
      activity,
    });
    // Attach using the freshly merged record — `so` from props is still stale
    // within this tick.
    updateEmail(email.id, soSendEmailPatch(email, { ...so, ...patch } as SalesOrder));
    addToast({
      type: 'success',
      title: generated ? 'Sales Order updated' : 'Sales Order generated',
      message: `${so.number} attached to the email. Send it — the Sales Order joins ERP Handoff as Pending once the mail goes out.`,
    });
    onCompose?.();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-stretch justify-center p-2 sm:p-4">
      {/* Backdrop closes only via the header X / Escape — a stray click must not
          discard a half-filled Sales Order form. */}
      <div className="absolute inset-0 bg-surface-900/45 backdrop-blur-[1px] animate-fade-in" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="SO Generation"
        className="relative z-10 flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl bg-white shadow-pop animate-slide-up"
      >
        {/* Sticky header */}
        <div className="flex flex-none items-start justify-between gap-4 border-b border-surface-200 bg-white px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold text-surface-800">
              <FileSpreadsheet className="h-5 w-5 text-brand-600" />
              SO Generation
            </h2>
            <p className="mt-0.5 truncate text-[12px] text-surface-500">
              {so.number} · {so.customerName} · PO {so.poNumber}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200 sm:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" /> PO Verified
            </span>
            <button
              onClick={onClose}
              aria-label="Close SO Generation"
              className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Independently scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
            <ShieldCheck className="h-4 w-4 flex-none" />
            <span>
              PO verified against the accepted quotation
              {so.verifiedBy ? ` by ${so.verifiedBy}` : ''}
              {so.verifiedAt ? ` on ${formatDate(so.verifiedAt.slice(0, 10), { short: true })}` : ''}. Review the prefilled Sales Order below.
            </span>
          </div>

          <div className="space-y-3">
            {/* 1. Client & PO Details */}
            <SoSection
              icon={<FileText className="h-3.5 w-3.5" />}
              n={1}
              label="Client & PO Details"
              open={open.client}
              onToggle={() => toggleSection('client')}
            >
              <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                <span className="text-surface-400">Customer / Party:</span>{' '}
                <span className="font-semibold text-surface-800">{so.customerName}</span>
                <span className="text-surface-400"> · {so.customerCode}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <TextField label="Phone" value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} className="py-1.5 text-[13px]" placeholder="+91 …" />
                <TextField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className="py-1.5 text-[13px]" placeholder="orders@customer.com" />
                <TextField label="GSTIN" required value={form.gstin} error={errors.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} className="py-1.5 text-[13px]" placeholder="27AAACR…" />
                <TextField label="Pincode" value={form.pincode} onChange={(e) => set('pincode', e.target.value)} className="py-1.5 text-[13px]" placeholder="400001" />
              </div>
              <TextAreaField label="Billing Address" required rows={2} value={form.billingAddress} error={errors.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} className="text-[13px]" />
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                <TextField label="Kind Attention — Name" required value={form.kindAttentionName} error={errors.kindAttentionName} onChange={(e) => set('kindAttentionName', e.target.value)} className="py-1.5 text-[13px]" placeholder="Contact person" />
                <TextField label="Kind Attention — Email" type="email" value={form.kindAttentionEmail} onChange={(e) => set('kindAttentionEmail', e.target.value)} className="py-1.5 text-[13px]" placeholder="contact@customer.com" />
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <TextField label="PO Number" required value={form.poNumber} error={errors.poNumber} onChange={(e) => set('poNumber', e.target.value)} className="py-1.5 text-[13px]" />
                <TextField label="PO Date" required type="date" value={form.poDate} error={errors.poDate} onChange={(e) => set('poDate', e.target.value)} className="py-1.5 text-[13px]" />
                <SelectField label="Sales Office" required value={form.officeId} error={errors.officeId} onChange={(e) => set('officeId', e.target.value)} options={(role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === so.officeId)).map((o) => ({ value: o.id, label: o.name }))} className="py-1.5 text-[13px]" />
                <SelectField label="Owner / Sales Person" required value={form.owner} error={errors.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} className="py-1.5 text-[13px]" />
              </div>
              <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                <span className="text-surface-400">Linked Quotation:</span>{' '}
                <span className="font-semibold text-surface-800">{so.quotationNumber ?? quote?.number ?? '—'}</span>
              </div>
              <SelectField label="Office Admin" value={form.officeAdmin} onChange={(e) => set('officeAdmin', e.target.value)} options={officeAdmins.map((o) => ({ value: o, label: o }))} placeholder="Select office admin" className="py-1.5 text-[13px]" />
              <div>
                <label className="label">PO Proof Type</label>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  {SO_PO_PROOF_OPTIONS.map((opt) => {
                    const OptIcon = opt.icon;
                    const active = form.poProofType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => set('poProofType', opt.value)}
                        className={classNames(
                          'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition',
                          active ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500/30' : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
                        )}
                      >
                        <OptIcon className="h-3.5 w-3.5 flex-none" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <TextAreaField
                label={form.poProofType === 'uploaded' ? 'PO Document Reference & Notes' : 'Proof Notes'}
                required
                rows={2}
                value={form.poProofNotes}
                error={errors.poProof}
                onChange={(e) => set('poProofNotes', e.target.value)}
                className="text-[13px]"
                placeholder="PO document number, reference and key details…"
              />
            </SoSection>

            {/* 2. Consignee */}
            <SoSection
              icon={<Truck className="h-3.5 w-3.5" />}
              n={2}
              label="Consignee"
              open={open.consignee}
              onToggle={() => toggleSection('consignee')}
            >
              <div className="rounded-lg bg-surface-50 px-2.5 py-2 text-[12px]">
                <span className="text-surface-400">Consignee:</span>{' '}
                <span className="font-semibold text-surface-800">{so.customerName}</span>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="label mb-0">Shipping Address</label>
                  <label className="flex items-center gap-1.5 text-[11px] text-surface-500">
                    <Toggle checked={form.sameAsBilling} onChange={(v) => set('sameAsBilling', v)} />
                    Same as billing
                  </label>
                </div>
                <TextAreaField label="" rows={2} value={effectiveShipping} disabled={form.sameAsBilling} onChange={(e) => set('shippingAddress', e.target.value)} className="text-[13px]" placeholder={form.sameAsBilling ? 'Same as billing address' : 'Shipping address'} />
              </div>
            </SoSection>

            {/* 3. Items */}
            <SoSection
              icon={<Boxes className="h-3.5 w-3.5" />}
              n={3}
              label="Items"
              open={open.items}
              onToggle={() => toggleSection('items')}
              action={<span className="text-[11px] text-surface-400">{lines.length} line(s)</span>}
            >
              <ItemLineEditor items={lines} catalog={catalog} onChange={setLines} />
              {errors.lines && <p className="mt-1.5 text-[11px] font-medium text-rose-600">{errors.lines}</p>}
            </SoSection>

            {/* 4. Commercial Terms */}
            <SoSection
              icon={<Receipt className="h-3.5 w-3.5" />}
              n={4}
              label="Commercial Terms"
              open={open.terms}
              onToggle={() => toggleSection('terms')}
            >
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <TextField label="Packing (%)" type="number" min={0} max={100} value={form.packingPct} onChange={(e) => set('packingPct', Math.max(0, Math.min(100, Number(e.target.value))))} className="py-1.5 text-[13px]" hint={`≈ ${formatINR(packingAmount)}`} />
                <TextField label="Warranty (Years)" type="number" min={1} value={form.warrantyYears} onChange={(e) => set('warrantyYears', Math.max(1, Number(e.target.value)))} className="py-1.5 text-[13px]" />
                <SelectField label="Delivery Terms" value={form.deliveryTerms} onChange={(e) => set('deliveryTerms', e.target.value)} options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))} placeholder="Select delivery option" className="py-1.5 text-[13px]" />
                <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} error={errors.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} className="py-1.5 text-[13px]" />
              </div>
              <div>
                <label className="label">Payment Terms</label>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <TextField label="Credit Days" type="number" min={0} value={form.creditDays} onChange={(e) => set('creditDays', Math.max(0, Number(e.target.value)))} className="py-1.5 text-[13px]" />
                <TextField label="Delivery Timeline" value={form.deliveryTimeline} onChange={(e) => set('deliveryTimeline', e.target.value)} className="py-1.5 text-[13px]" placeholder="e.g. 4–6 weeks" />
                <TextField label="Freight / Transportation" value={form.freight} onChange={(e) => set('freight', e.target.value)} className="py-1.5 text-[13px]" placeholder="e.g. Extra at actuals" />
                <TextField label="Inspection" value={form.inspection} onChange={(e) => set('inspection', e.target.value)} className="py-1.5 text-[13px]" placeholder="e.g. At works" />
              </div>
              <TextAreaField label="Additional Commercial Terms" rows={2} value={form.additionalTerms} onChange={(e) => set('additionalTerms', e.target.value)} className="text-[13px]" placeholder="Any additional terms…" />
            </SoSection>

            {/* 5. Summary */}
            <SoSection
              icon={<Calculator className="h-3.5 w-3.5" />}
              n={5}
              label="Summary"
              open={open.summary}
              onToggle={() => toggleSection('summary')}
            >
              <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
              <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
              <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
              <InfoRow label="GST" value={formatINR(totals.tax)} />
              <InfoRow label={`Packing & Forwarding (${form.packingPct}%)`} value={formatINR(packingAmount)} />
              <div className="mt-1.5 flex items-center justify-between border-t border-surface-200 pt-2">
                <span className="text-[13px] font-semibold text-surface-800">Grand Total</span>
                <span className="text-[15px] font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
              </div>
            </SoSection>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-surface-200 bg-surface-50/80 px-5 py-3">
          <div className="text-[12px] text-surface-500">
            Grand Total: <span className="text-[14px] font-bold text-surface-900">{formatINR(totals.grandTotal)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft} disabled={!canGenerate}>
              Save Draft
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>
              Preview SO
            </Button>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Mail className="h-4 w-4" />}
              onClick={generateAndAttach}
              disabled={!canGenerate}
              title={!canGenerate ? 'You do not have permission to generate Sales Orders' : 'Generate the Sales Order and attach it to the compose window'}
            >
              {generated ? 'Save & Add to Email' : 'Generate & Add to Email'}
            </Button>
          </div>
        </div>
        {!canGenerate && (
          <p className="flex-none border-t border-surface-100 bg-surface-50/80 px-5 pb-2 text-center text-[11px] font-medium text-rose-600">
            Create permission required.
          </p>
        )}
      </div>

      <SoPreviewModal open={preview} onClose={() => setPreview(false)} resolved={previewResolved} />
    </div>,
    document.body
  );
}

// Collapsible section wrapper for the SO Generation modal — the same visual
// language as the inline FormSection it replaces, with a chevron toggle so long
// forms can be folded down to the sections being worked on.
function SoSection({
  icon,
  n,
  label,
  action,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  n: number;
  label: string;
  action?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-surface-200">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={classNames(
          'flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-50/70',
          open && 'border-b border-surface-100'
        )}
      >
        <h4 className="flex items-center gap-1.5 text-[12px] font-semibold text-surface-700">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-brand-50 text-brand-600">{icon}</span>
          <span className="text-surface-400">{n}.</span> {label}
        </h4>
        <span className="flex items-center gap-2">
          {action}
          <ChevronDown className={classNames('h-4 w-4 text-surface-400 transition-transform', !open && '-rotate-90')} />
        </span>
      </button>
      {open && <div className="space-y-2.5 p-3">{children}</div>}
    </section>
  );
}

// Professional Sales Order document preview — the shared SO Acknowledgement
// renderer, resolved from the current form so it always matches what is saved.
export function SoPreviewModal({
  open,
  onClose,
  resolved,
}: {
  open: boolean;
  onClose: () => void;
  resolved: ResolvedSalesOrder;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Sales Order Preview"
      subtitle={`${resolved.soNumber} · ${resolved.buyer.name ?? ''}`}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      <SalesOrderDocument resolved={resolved} showLetterhead />
    </Modal>
  );
}
