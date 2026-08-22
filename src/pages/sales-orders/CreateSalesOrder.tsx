import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User2,
  FileText,
  Boxes,
  Receipt,
  Calculator,
  Save,
  Eye,
  Send,
  Download,
  Phone,
  MessageSquare,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  SectionCard,
  TextField,
  SelectField,
  TextAreaField,
  ItemLineEditor,
  Modal,
  ConfirmDialog,
  InfoRow,
  Toggle,
} from '@/components/ui';
import { COMPANY_NAME } from '@/lib/brand';
import { useApp, useNoOfficeAssigned } from '@/context/AppContext';
import { NoOfficeAssigned } from '@/components/NoOfficeAssigned';
import { SalesOrderDocument } from '@/components/sales-order/SalesOrderDocument';
import { resolveSalesOrder } from '@/lib/salesOrder';
import { OFFICES, officeName } from '@/data/offices';
import { OWNERS, USERS } from '@/data/users';
import type { CommercialTerms, LineItem, PaymentTerms, PoProofType, SalesOrder } from '@/types';
import { computeTotals, downloadText, formatINR, classNames } from '@/lib/format';
import {
  activeDeliveryOptions,
  defaultDeliveryOption,
  formatPaymentTerms,
  formatWarranty,
  paymentTotal,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';

// Clearer, spec-aligned labels for the four payment buckets (the shared
// PAYMENT_FIELDS keys/order are reused; only display labels differ here).
const PAYMENT_LABEL: Record<keyof PaymentTerms, string> = {
  advance: 'Advance %',
  beforeDispatch: 'Before Dispatch %',
  creditDays: 'Credit %',
  afterInstall: 'After Installation %',
};

const PO_PROOF_OPTIONS: { value: PoProofType; label: string; icon: typeof Phone }[] = [
  { value: 'uploaded', label: 'PO Document', icon: FileText },
  { value: 'phone_call', label: 'Phone Call', icon: Phone },
  { value: 'message', label: 'Message / WhatsApp', icon: MessageSquare },
];

interface FormState {
  useNewCustomer: boolean;
  partyId: string;
  newCustomerName: string;
  billingAddress: string;
  phone: string;
  email: string;
  pincode: string;
  gstin: string;
  kindAttentionName: string;
  kindAttentionPhone: string;
  kindAttentionEmail: string;
  // Consignee (ship-to). Prefilled from Party Master; hidden while "same as
  // buyer" is on. Distinct GSTIN drives an inter-state (IGST) tax split.
  consigneeSameAsBuyer: boolean;
  consigneeName: string;
  consigneePhone: string;
  consigneeEmail: string;
  consigneeGstin: string;
  consigneeAddress: string;
  poNumber: string;
  poDate: string;
  quotationId: string;
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

// Commercial-terms defaults are sourced from T&C Master (the single source of
// truth) — never hardcoded here.
const initialForm = (officeId: string, ct: CommercialTerms): FormState => ({
  useNewCustomer: false,
  partyId: '',
  newCustomerName: '',
  billingAddress: '',
  phone: '',
  email: '',
  pincode: '',
  gstin: '',
  kindAttentionName: '',
  kindAttentionPhone: '',
  kindAttentionEmail: '',
  consigneeSameAsBuyer: true,
  consigneeName: '',
  consigneePhone: '',
  consigneeEmail: '',
  consigneeGstin: '',
  consigneeAddress: '',
  poNumber: '',
  poDate: '',
  quotationId: '',
  officeId,
  owner: OWNERS[0],
  officeAdmin: '',
  poProofType: 'uploaded',
  poProofNotes: '',
  packingPct: ct.packingPct,
  deliveryTerms: defaultDeliveryOption(ct)?.name ?? '',
  deliveryTimeline: '',
  warrantyYears: ct.warrantyYears,
  creditDays: 0,
  payment: { ...ct.payment },
  expectedDelivery: '',
  freight: '',
  inspection: '',
  additionalTerms: '',
});

export default function CreateSalesOrder() {
  const { parties, items, quotations, commercialTerms, role, currentUser, salesOrders, addSalesOrder, addToast } = useApp();
  const noOffice = useNoOfficeAssigned();
  const navigate = useNavigate();

  const defaultOffice = role === 'super_admin' ? OFFICES[0].id : currentUser.officeId;
  const [form, setForm] = useState<FormState>(() => initialForm(defaultOffice, commercialTerms));
  const deliveryChoices = useMemo(() => activeDeliveryOptions(commercialTerms), [commercialTerms]);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [confirmCreate, setConfirmCreate] = useState(false);
  // Synchronous guard so a same-tick double-click can't create two records
  // (React state updates are async and would not block the second click).
  const submittedRef = useRef(false);
  const [pendingQuotationId, setPendingQuotationId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const clearError = (key: string) => {
    setErrors((e) => {
      if (!e[key]) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });
  };
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    // Clear the matching validation error as soon as the user provides a value,
    // so "… is required" disappears immediately on a valid entry.
    if (v) clearError(k as string);
    if (k === 'poProofNotes' && v) clearError('poProof');
  };
  const setLinesTracked = (next: LineItem[]) => {
    setLines(next);
    setDirty(true);
    if (next.length > 0) clearError('lines');
  };

  // Warn before leaving the page (tab close / reload) with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const scopedParties = useMemo(
    () => parties.filter((p) => (role === 'super_admin' ? true : p.officeId === currentUser.officeId)),
    [parties, role, currentUser]
  );
  // Quotations are limited to the chosen office and, once an existing customer
  // is picked, to that customer — so a linked quote always belongs to them.
  const scopedQuotations = useMemo(
    () => quotations.filter((q) => q.officeId === form.officeId && (!form.partyId || q.partyId === form.partyId)),
    [quotations, form.officeId, form.partyId]
  );

  const officeAdmins = useMemo(() => {
    const inOffice = USERS.filter((u) => u.role === 'office_admin' && u.officeId === form.officeId && u.active);
    const list = inOffice.length ? inOffice : USERS.filter((u) => u.role === 'office_admin' && u.active);
    return list.map((u) => u.fullName);
  }, [form.officeId]);

  // Prefill Office Admin from the Sales Office Master: default to the office's
  // admin whenever the selected office changes and the current pick isn't valid
  // for that office. Keeps a user's explicit choice as long as it stays valid.
  useEffect(() => {
    setForm((f) => (officeAdmins.includes(f.officeAdmin) ? f : { ...f, officeAdmin: officeAdmins[0] ?? '' }));
  }, [officeAdmins]);

  const selectedParty = parties.find((p) => p.id === form.partyId);

  // When selecting an existing party, prefill from Party Master. The consignee
  // (ship-to) prefills from the party's shipping address; if that differs from
  // billing we surface the consignee block, otherwise it stays "same as buyer".
  const onSelectParty = (id: string) => {
    const p = parties.find((x) => x.id === id);
    const billing = p?.billingAddress ?? '';
    const shipping = p?.shippingAddress ?? '';
    const consigneeDiffers = !!shipping && shipping.trim() !== billing.trim();
    setForm((f) => ({
      ...f,
      partyId: id,
      quotationId: '',
      billingAddress: billing,
      phone: p?.phone ?? '',
      email: p?.email ?? '',
      gstin: p?.gstin ?? '',
      kindAttentionName: p?.contactPerson ?? '',
      kindAttentionPhone: p?.phone ?? '',
      kindAttentionEmail: p?.email ?? '',
      consigneeSameAsBuyer: !consigneeDiffers,
      consigneeName: p?.companyName ?? '',
      consigneePhone: p?.phone ?? '',
      consigneeEmail: p?.email ?? '',
      consigneeGstin: p?.gstin ?? '',
      consigneeAddress: shipping,
      officeId: p?.officeId ?? f.officeId,
    }));
    setDirty(true);
  };

  const applyQuotation = (id: string) => {
    const q = quotations.find((x) => x.id === id);
    if (!q) {
      set('quotationId', id);
      return;
    }
    setLines(q.items.map((it) => ({ ...it, id: `soln-${it.id}` })));
    const party = parties.find((p) => p.id === q.partyId);
    // Linking a quotation prefills its items, customer, sales office and owner.
    // Commercial terms stay driven by T&C Master defaults (single source of truth).
    const billing = party?.billingAddress ?? form.billingAddress;
    const shipping = party?.shippingAddress ?? '';
    const consigneeDiffers = !!shipping && shipping.trim() !== billing.trim();
    setForm((f) => ({
      ...f,
      quotationId: id,
      partyId: q.partyId,
      officeId: q.officeId || f.officeId,
      owner: q.owner || f.owner,
      billingAddress: party?.billingAddress ?? f.billingAddress,
      phone: party?.phone ?? f.phone,
      email: party?.email ?? f.email,
      gstin: party?.gstin ?? f.gstin,
      kindAttentionName: party?.contactPerson ?? f.kindAttentionName,
      kindAttentionPhone: party?.phone ?? f.kindAttentionPhone,
      kindAttentionEmail: party?.email ?? f.kindAttentionEmail,
      consigneeSameAsBuyer: party ? !consigneeDiffers : f.consigneeSameAsBuyer,
      consigneeName: party?.companyName ?? f.consigneeName,
      consigneePhone: party?.phone ?? f.consigneePhone,
      consigneeEmail: party?.email ?? f.consigneeEmail,
      consigneeGstin: party?.gstin ?? f.consigneeGstin,
      consigneeAddress: shipping || f.consigneeAddress,
    }));
    setDirty(true);
  };

  // Guard against silently overwriting manually-entered items.
  const onSelectQuotation = (id: string) => {
    if (id && lines.length > 0) {
      setPendingQuotationId(id);
      return;
    }
    applyQuotation(id);
  };

  // Consignee (ship-to) address — mirrors the buyer's billing address while
  // "same as buyer" is on, otherwise the separately-entered consignee address.
  const effectiveConsigneeAddress = form.consigneeSameAsBuyer ? form.billingAddress : form.consigneeAddress;

  // Packing is a % of the taxable order value; convert to an absolute amount so
  // the shared computeTotals math is unchanged.
  const packingAmount = Math.round((computeTotals(lines, 0).taxable * form.packingPct) / 100);
  const totals = computeTotals(lines, packingAmount);
  const paymentSum = paymentTotal(form.payment);
  const customerName = form.useNewCustomer ? form.newCustomerName : selectedParty?.companyName ?? '';

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.useNewCustomer) {
      if (!form.newCustomerName.trim()) e.newCustomerName = 'Customer name is required';
    } else if (!form.partyId) {
      e.partyId = 'Select a customer';
    }
    if (!form.billingAddress.trim()) e.billingAddress = 'Billing address is required';
    if (!form.phone.trim() && !form.email.trim()) e.phone = 'Provide a phone number or email';
    if (!form.gstin.trim()) e.gstin = 'GSTIN is required';
    if (!form.kindAttentionName.trim()) e.kindAttentionName = 'Kind attention name is required';

    if (!form.poNumber.trim()) e.poNumber = 'PO number is required';
    if (!form.poDate) e.poDate = 'PO date is required';
    if (!form.officeId) e.officeId = 'Sales office is required';
    if (!form.owner) e.owner = 'Owner is required';

    // PO proof — captured as notes (PO reference, who confirmed, when). No file upload.
    if (!form.poProofNotes.trim()) {
      e.poProof =
        form.poProofType === 'uploaded'
          ? 'Add the PO document reference and details'
          : form.poProofType === 'phone_call'
          ? 'Add proof notes for the phone call'
          : 'Add the message / WhatsApp reference and details';
    }

    if (!form.expectedDelivery) e.expectedDelivery = 'Expected delivery date is required';
    if (paymentSum !== 100) e.payment = 'Payment terms must total 100%.';

    if (lines.length === 0) e.lines = 'Add at least one line item';
    else if (lines.some((l) => !l.itemId)) e.lines = 'Every line must have an item selected';
    else if (lines.some((l) => l.quantity <= 0)) e.lines = 'Quantities must be greater than 0';
    else if (lines.some((l) => l.unitPrice <= 0)) e.lines = 'Unit price must be greater than 0';

    setErrors(e);
    if (Object.keys(e).length) {
      addToast({ type: 'error', title: 'Please fix the highlighted fields', message: `${Object.keys(e).length} field(s) need attention.` });
    }
    return Object.keys(e).length === 0;
  };

  // Generate a Sales Order number that does not collide with any existing one.
  const nextSoNumber = () => {
    const used = new Set(salesOrders.map((s) => s.number));
    const existingSeq = salesOrders
      .map((s) => /^SO\/2026\/(\d+)$/.exec(s.number)?.[1])
      .filter(Boolean)
      .map((n) => parseInt(n as string, 10));
    let seq = (existingSeq.length ? Math.max(...existingSeq) : 600) + 1;
    let candidate = `SO/2026/${String(seq).padStart(4, '0')}`;
    while (used.has(candidate)) {
      seq += 1;
      candidate = `SO/2026/${String(seq).padStart(4, '0')}`;
    }
    return candidate;
  };

  const buildSO = (opts: { withHandoff: boolean; soNumber?: string }): SalesOrder => {
    const q = quotations.find((x) => x.id === form.quotationId);
    const paymentTermsText =
      formatPaymentTerms(form.payment) + (form.creditDays > 0 ? `, ${form.creditDays} Credit Days` : '');
    const warrantyText = formatWarranty(form.warrantyYears);
    const now = new Date().toISOString();
    const consigneeAddress = effectiveConsigneeAddress;
    // Salesperson contact prefilled from the user directory (Sales Office Master).
    const salespersonUser = USERS.find((u) => u.fullName === form.owner);
    return {
      id: `so-${Date.now()}`,
      number: opts.soNumber ?? nextSoNumber(),
      poNumber: form.poNumber,
      poDate: form.poDate,
      quotationId: form.quotationId || undefined,
      quotationNumber: q?.number,
      partyId: form.partyId,
      customerName,
      customerCode: selectedParty?.code ?? 'NEW',
      officeId: form.officeId,
      owner: form.owner,
      value: totals.grandTotal,
      poValue: totals.grandTotal,
      quoteValue: q ? q.value : totals.grandTotal,
      status: opts.withHandoff ? 'so_sent' : 'draft',
      // No quotation to compare against means nothing has been verified, which
      // reads as Mismatch Found until one is associated and the comparison runs.
      verificationStatus: form.quotationId ? 'verified' : 'mismatch',
      receivedDate: form.poDate,
      createdDate: now.slice(0, 10),
      deliveryDate: form.expectedDelivery,
      billingAddress: form.billingAddress,
      shippingAddress: consigneeAddress,
      customerPhone: form.phone || undefined,
      customerEmail: form.email || undefined,
      pincode: form.pincode || undefined,
      kindAttentionName: form.kindAttentionName || undefined,
      kindAttentionEmail: form.kindAttentionEmail || undefined,
      officeAdmin: form.officeAdmin || undefined,
      poProofType: form.poProofType,
      poProofNotes: form.poProofNotes || undefined,
      commercials: {
        packingPct: form.packingPct,
        payment: { ...form.payment },
        creditDays: form.creditDays,
      },
      // Structured shared-model sections captured on manual creation.
      buyer: {
        name: customerName,
        code: selectedParty?.code,
        address: form.billingAddress,
        pincode: form.pincode || undefined,
        country: 'India',
        phone: form.phone || undefined,
        email: form.email || undefined,
        gstin: form.gstin || undefined,
      },
      consignee: form.consigneeSameAsBuyer
        ? {
            name: customerName,
            code: selectedParty?.code,
            address: form.billingAddress,
            pincode: form.pincode || undefined,
            country: 'India',
            phone: form.phone || undefined,
            email: form.email || undefined,
            gstin: form.gstin || undefined,
          }
        : {
            name: form.consigneeName || customerName,
            address: consigneeAddress,
            country: 'India',
            phone: form.consigneePhone || undefined,
            email: form.consigneeEmail || undefined,
            gstin: form.consigneeGstin || undefined,
          },
      consigneeSameAsBuyer: form.consigneeSameAsBuyer,
      kindAttention:
        form.kindAttentionName || form.kindAttentionPhone || form.kindAttentionEmail
          ? {
              name: form.kindAttentionName || undefined,
              phone: form.kindAttentionPhone || undefined,
              email: form.kindAttentionEmail || undefined,
            }
          : undefined,
      salesperson: {
        name: form.owner,
        phone: salespersonUser?.phone,
        email: salespersonUser?.email,
        officeId: form.officeId,
        owner: form.owner,
      },
      deliveryTimeline: form.deliveryTimeline || undefined,
      expectedDeliveryDate: form.expectedDelivery || undefined,
      freight: form.freight || undefined,
      inspection: form.inspection || undefined,
      additionalTerms: form.additionalTerms || undefined,
      sentAt: opts.withHandoff ? now : undefined,
      // Creating the order queues it for the ERP; it does not key it in. The
      // record lands as Pending and waits for Submit to ERP.
      erpHandoff: opts.withHandoff ? { state: 'pending', source: 'manual', queuedAt: now, queuedBy: currentUser.fullName, updatedAt: now, revisionNumber: 0 } : undefined,
      revisionNumber: 0,
      versions: [
        {
          id: `ver-${Date.now()}-0`,
          label: 'Original',
          version: 0,
          createdAt: now,
          by: form.owner,
          reason: 'Initial sales order',
          snapshot: {
            items: lines.map((it) => ({ ...it })),
            paymentTerms: paymentTermsText,
            deliveryTerms: form.deliveryTerms,
            deliveryDate: form.expectedDelivery,
            billingAddress: form.billingAddress,
            shippingAddress: consigneeAddress,
          },
        },
      ],
      items: lines,
      paymentTerms: paymentTermsText,
      deliveryTerms: form.deliveryTerms,
      warranty: warrantyText,
      packingCharges: packingAmount,
      internalNotes: [],
      activity: [
        { id: `act-${Date.now()}-created`, date: now, actor: form.owner, action: 'Sales Order created', detail: q ? `From quotation ${q.number}` : 'Created manually' },
        ...(opts.withHandoff
          ? [{ id: `act-${Date.now()}-erp`, date: now, actor: currentUser.fullName, action: 'Added to ERP Handoff', detail: 'Queued as Pending for manufacturing handover' }]
          : []),
      ],
      verificationFields: [],
    };
  };

  // Save Draft keeps the user on the form with values intact. It intentionally
  // does NOT create a Sales Order / ERP Handoff record or generate a final SO
  // number — only "Create & Submit" does.
  const saveDraft = () => {
    addToast({ type: 'success', title: 'Draft saved', message: 'Sales Order draft saved.' });
    setDirty(false);
  };

  const attemptCreate = () => {
    if (!validate()) return;
    setConfirmCreate(true);
  };

  const doCreateAndSubmit = () => {
    // Guard against a double-click on the confirm button creating two records.
    if (submittedRef.current) return;
    submittedRef.current = true;
    const so = buildSO({ withHandoff: true });
    setDirty(false);
    setConfirmCreate(false);
    addSalesOrder(so);
    addToast({
      type: 'success',
      title: `Sales Order ${so.number} created`,
      message: `${so.number} added to the Sales Order list and to ERP Handoff (Pending). Submit it to the ERP from the ERP Handoff screen.`,
    });
    navigate('/erp-handoff', { state: { highlightId: so.id } });
  };

  const downloadDraft = () => {
    downloadText(
      `SO-draft-${form.poNumber || 'new'}.txt`,
      `${COMPANY_NAME}\nDRAFT SALES ORDER ACKNOWLEDGEMENT\n\nCustomer: ${customerName}\nPO: ${form.poNumber}\nValue: ${formatINR(totals.grandTotal)}\nItems: ${lines.length}`
    );
    addToast({ type: 'info', title: 'Draft downloaded', message: 'SO draft exported.' });
  };

  // Live document preview — resolved from the same shared model buildSO produces,
  // with a placeholder SO number (the real number is assigned only on create).
  const previewResolved = useMemo(
    () =>
      preview
        ? resolveSalesOrder(
            { ...buildSO({ withHandoff: false }), number: 'SO/2026/(draft)' },
            { parties, catalog: items }
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preview, form, lines]
  );

  if (noOffice) {
    return (
      <>
        <PageHeader
          title="Create Sales Order Manually"
          description="Build a sales order from a customer PO, optionally linked to an accepted quotation, then submit it to ERP Handoff."
          crumbs={[{ label: 'Sales Orders' }, { label: 'Create SO Manually' }]}
        />
        <NoOfficeAssigned />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Create Sales Order Manually"
        description="Build a sales order from a customer PO, optionally linked to an accepted quotation, then submit it to ERP Handoff."
        crumbs={[{ label: 'Sales Orders' }, { label: 'Create SO Manually' }]}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft}>Save Draft</Button>
            <Button variant="secondary" leftIcon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>Preview</Button>
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={attemptCreate}>Create SO &amp; Submit to ERP Handoff</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* 1. Client Details */}
          <SectionCard title={<Section icon={<User2 className="h-4 w-4" />} n={1} label="Client Details" />}>
            <div className="mb-4 flex gap-2 rounded-lg bg-surface-100 p-1">
              <ToggleTab active={!form.useNewCustomer} onClick={() => set('useNewCustomer', false)}>Existing Customer</ToggleTab>
              <ToggleTab active={form.useNewCustomer} onClick={() => set('useNewCustomer', true)}>Add New Customer</ToggleTab>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {form.useNewCustomer ? (
                <TextField wrapClassName="sm:col-span-2" label="Customer / Party" required value={form.newCustomerName} error={errors.newCustomerName} onChange={(e) => set('newCustomerName', e.target.value)} placeholder="New customer name" hint="New customers are not added to Party Master automatically." />
              ) : (
                <SelectField
                  wrapClassName="sm:col-span-2"
                  label="Customer / Party"
                  required
                  value={form.partyId}
                  error={errors.partyId}
                  onChange={(e) => onSelectParty(e.target.value)}
                  options={scopedParties.map((p) => ({ value: p.id, label: `${p.companyName} (${p.code})` }))}
                  placeholder="Select existing customer…"
                />
              )}
              <TextField label="Phone" value={form.phone} error={errors.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98200 41122" />
              <TextField label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="orders@customer.com" />
              <TextField label="GSTIN" required value={form.gstin} error={errors.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="27AAACR5055K1Z5" />
              <TextField label="Pincode" value={form.pincode} onChange={(e) => set('pincode', e.target.value)} placeholder="400001" />
              <TextAreaField wrapClassName="sm:col-span-2" label="Billing Address" required rows={2} value={form.billingAddress} error={errors.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} />

              {/* Kind Attention */}
              <TextField label="Kind Attention — Name" required value={form.kindAttentionName} error={errors.kindAttentionName} onChange={(e) => set('kindAttentionName', e.target.value)} placeholder="Contact person" />
              <TextField label="Kind Attention — Contact Number" value={form.kindAttentionPhone} onChange={(e) => set('kindAttentionPhone', e.target.value)} placeholder="+91 98200 41122" />
              <TextField wrapClassName="sm:col-span-2" label="Kind Attention — Email" type="email" value={form.kindAttentionEmail} onChange={(e) => set('kindAttentionEmail', e.target.value)} placeholder="contact@customer.com" />

              {/* Consignee (ship-to) — progressive: collapsed while same as buyer */}
              <div className="sm:col-span-2 rounded-lg border border-surface-200 bg-surface-50/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-surface-700">Consignee Details (Ship To)</span>
                  <label className="flex items-center gap-2 text-[12px] text-surface-500">
                    <Toggle checked={form.consigneeSameAsBuyer} onChange={(v) => set('consigneeSameAsBuyer', v)} />
                    Same as Buyer's Address
                  </label>
                </div>
                {form.consigneeSameAsBuyer ? (
                  <p className="mt-2 text-[12px] text-surface-400">
                    Consignee is the same as the buyer. Toggle off to ship to a different party.
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <TextField label="Consignee Name" value={form.consigneeName} onChange={(e) => set('consigneeName', e.target.value)} placeholder="Consignee / ship-to name" />
                    <TextField label="Consignee GSTIN" value={form.consigneeGstin} onChange={(e) => set('consigneeGstin', e.target.value.toUpperCase())} placeholder="27AAACR5055K1Z5" />
                    <TextField label="Consignee Phone" value={form.consigneePhone} onChange={(e) => set('consigneePhone', e.target.value)} placeholder="+91 98200 41122" />
                    <TextField label="Consignee Email" type="email" value={form.consigneeEmail} onChange={(e) => set('consigneeEmail', e.target.value)} placeholder="dispatch@customer.com" />
                    <TextAreaField wrapClassName="sm:col-span-2" label="Complete Consignee Address" rows={2} value={form.consigneeAddress} onChange={(e) => set('consigneeAddress', e.target.value)} placeholder="Ship-to address with pincode" />
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          {/* 2. Order Details */}
          <SectionCard title={<Section icon={<FileText className="h-4 w-4" />} n={2} label="Order Details" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField label="PO Number" required value={form.poNumber} error={errors.poNumber} onChange={(e) => set('poNumber', e.target.value)} placeholder="e.g. PO-1001-0700" />
              <TextField label="PO Date" required type="date" value={form.poDate} error={errors.poDate} onChange={(e) => set('poDate', e.target.value)} />
              <SelectField
                label="Linked Quotation (optional)"
                value={form.quotationId}
                disabled={form.useNewCustomer}
                onChange={(e) => onSelectQuotation(e.target.value)}
                options={scopedQuotations.map((q) => ({ value: q.id, label: `${q.number} — ${q.customerName}` }))}
                placeholder={form.useNewCustomer ? 'Not available for new customers' : 'No linked quotation'}
                hint={form.useNewCustomer ? undefined : 'Prefills items, terms, office & owner'}
              />
              <SelectField label="Sales Office" required value={form.officeId} error={errors.officeId} onChange={(e) => set('officeId', e.target.value)} options={(role === 'super_admin' ? OFFICES : OFFICES.filter((o) => o.id === currentUser.officeId)).map((o) => ({ value: o.id, label: o.name }))} />
              <SelectField label="Owner / Sales Person" required value={form.owner} error={errors.owner} onChange={(e) => set('owner', e.target.value)} options={OWNERS.map((o) => ({ value: o, label: o }))} />
              <SelectField label="Office Admin" value={form.officeAdmin} onChange={(e) => set('officeAdmin', e.target.value)} options={officeAdmins.map((o) => ({ value: o, label: o }))} placeholder="Select office admin" />

              {/* PO Proof */}
              <div className="sm:col-span-2">
                <label className="label">PO Proof Type</label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {PO_PROOF_OPTIONS.map((opt) => {
                    const OptIcon = opt.icon;
                    const active = form.poProofType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => set('poProofType', opt.value)}
                        className={classNames(
                          'flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition',
                          active ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500/30' : 'border-surface-200 text-surface-600 hover:border-surface-300 hover:bg-surface-50'
                        )}
                      >
                        <OptIcon className="h-4 w-4 flex-none" />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <TextAreaField
                wrapClassName="sm:col-span-2"
                label={form.poProofType === 'uploaded' ? 'PO Document Reference & Notes' : 'Proof Notes'}
                required
                rows={2}
                value={form.poProofNotes}
                onChange={(e) => set('poProofNotes', e.target.value)}
                placeholder={
                  form.poProofType === 'phone_call'
                    ? 'Who confirmed the PO by phone, when, and key details…'
                    : form.poProofType === 'message'
                    ? 'Message / WhatsApp reference, sender and key details…'
                    : 'PO document number, reference and key details…'
                }
              />
              {errors.poProof && <p className="-mt-2 text-xs font-medium text-rose-600 sm:col-span-2">{errors.poProof}</p>}
            </div>
          </SectionCard>

          {/* 3. Catalogue Items */}
          <SectionCard
            title={<Section icon={<Boxes className="h-4 w-4" />} n={3} label="Catalogue Items" />}
            action={<span className="text-xs text-surface-400">{lines.length} line item(s)</span>}
          >
            <ItemLineEditor items={lines} catalog={items} onChange={setLinesTracked} expandable defaultDeliveryDate={form.expectedDelivery} />
            {errors.lines && <p className="mt-2 text-xs font-medium text-rose-600">{errors.lines}</p>}
          </SectionCard>

          {/* 4. Commercial Terms */}
          <SectionCard
            title={<Section icon={<Receipt className="h-4 w-4" />} n={4} label="Commercial Terms" />}
            action={<span className="text-xs text-surface-400">Defaults from T&amp;C Master</span>}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Packing (%)"
                type="number"
                min={0}
                max={100}
                value={form.packingPct}
                onChange={(e) => set('packingPct', Math.max(0, Math.min(100, Number(e.target.value))))}
                hint={`≈ ${formatINR(packingAmount)} on current items`}
              />
              <SelectField
                label="Delivery Terms"
                value={form.deliveryTerms}
                onChange={(e) => set('deliveryTerms', e.target.value)}
                options={deliveryChoices.map((o) => ({ value: o.name, label: o.name }))}
                placeholder="Select delivery option"
              />
              <TextField label="Expected Delivery Date" required type="date" value={form.expectedDelivery} error={errors.expectedDelivery} onChange={(e) => set('expectedDelivery', e.target.value)} />
              <TextField
                label="Warranty (Years)"
                type="number"
                min={1}
                value={form.warrantyYears}
                onChange={(e) => set('warrantyYears', Math.max(1, Number(e.target.value)))}
              />
              <div className="sm:col-span-2">
                <label className="label">Payment Terms</label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {PAYMENT_FIELDS.map((f) => (
                    <div key={f.key}>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          className="input pr-8"
                          value={form.payment[f.key]}
                          onChange={(e) =>
                            set('payment', {
                              ...form.payment,
                              [f.key]: Math.max(0, Math.min(100, Number(e.target.value))),
                            })
                          }
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-surface-400">%</span>
                      </div>
                      <p className="mt-1 text-[11px] text-surface-500">{PAYMENT_LABEL[f.key]}</p>
                    </div>
                  ))}
                </div>
                <div className={classNames('mt-2 text-xs font-medium', paymentSum === 100 ? 'text-emerald-600' : 'text-rose-600')}>
                  Total: {paymentSum}%{paymentSum !== 100 && ' — Payment terms must total 100%.'}
                </div>
                {errors.payment && <p className="mt-1 text-xs font-medium text-rose-600">{errors.payment}</p>}
              </div>
              <TextField
                label="Credit Days"
                type="number"
                min={0}
                value={form.creditDays}
                onChange={(e) => set('creditDays', Math.max(0, Number(e.target.value)))}
                hint="Credit period in days (if applicable)"
              />
              <TextField label="Delivery Timeline" value={form.deliveryTimeline} onChange={(e) => set('deliveryTimeline', e.target.value)} placeholder="e.g. 4–6 weeks from clear PO" />
              <TextField label="Freight / Transportation" value={form.freight} onChange={(e) => set('freight', e.target.value)} placeholder="e.g. Extra at actuals" />
              <TextField label="Inspection" value={form.inspection} onChange={(e) => set('inspection', e.target.value)} placeholder="e.g. At works / Third-party" />
              <TextAreaField wrapClassName="sm:col-span-2" label="Additional Commercial Terms" rows={2} value={form.additionalTerms} onChange={(e) => set('additionalTerms', e.target.value)} placeholder="Any additional terms to appear on the Sales Order…" />
            </div>
          </SectionCard>
        </div>

        {/* 5. Summary (sticky) */}
        <div className="xl:col-span-1">
          <div className="sticky top-20 space-y-4">
            <SectionCard title={<Section icon={<Calculator className="h-4 w-4" />} n={5} label="Summary" />}>
              <div className="space-y-1">
                <InfoRow label="Customer" value={customerName || '—'} />
                <InfoRow label="Sales Office" value={officeName(form.officeId)} />
                <InfoRow label="Owner" value={form.owner || '—'} />
                <InfoRow label="PO Number" value={form.poNumber || '—'} />
                <InfoRow label="Line Items" value={String(lines.length)} />
                <div className="my-2 border-t border-surface-100" />
                <InfoRow label="Subtotal" value={formatINR(totals.subtotal)} />
                <InfoRow label="Discount" value={`- ${formatINR(totals.discount)}`} />
                <InfoRow label="Taxable Value" value={formatINR(totals.taxable)} />
                <InfoRow label="GST" value={formatINR(totals.tax)} />
                <InfoRow label={`Packing & Forwarding (${form.packingPct}%)`} value={formatINR(packingAmount)} />
                <div className="mt-2 border-t border-surface-200 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-surface-800">Grand Total</span>
                    <span className="text-lg font-bold text-brand-700">{formatINR(totals.grandTotal)}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <Button variant="primary" className="w-full" leftIcon={<Send className="h-4 w-4" />} onClick={attemptCreate}>Create SO &amp; Submit to ERP Handoff</Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" leftIcon={<Save className="h-4 w-4" />} onClick={saveDraft}>Save Draft</Button>
                  <Button variant="secondary" leftIcon={<Download className="h-4 w-4" />} onClick={downloadDraft}>Download</Button>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      {/* Overwrite-guard when linking a quotation over manual items */}
      <ConfirmDialog
        open={!!pendingQuotationId}
        onClose={() => setPendingQuotationId(null)}
        onConfirm={() => { if (pendingQuotationId) applyQuotation(pendingQuotationId); setPendingQuotationId(null); }}
        title="Replace current items?"
        message="Linking this quotation will replace the items and customer details you've entered. Continue?"
        confirmLabel="Replace"
      />

      {/* Create & submit confirmation */}
      <ConfirmDialog
        open={confirmCreate}
        onClose={() => setConfirmCreate(false)}
        onConfirm={doCreateAndSubmit}
        title="Create Sales Order?"
        message="The Sales Order will be created and queued in ERP Handoff as Pending. Submitting it to the ERP is a separate step on the ERP Handoff screen."
        confirmLabel="Create & Submit"
      />

      {/* Preview modal */}
      <Modal
        open={preview}
        onClose={() => setPreview(false)}
        title="Sales Order Preview"
        subtitle={form.poNumber ? `PO ${form.poNumber}` : 'Draft'}
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(false)}>Close</Button>
            <Button variant="primary" leftIcon={<Send className="h-4 w-4" />} onClick={() => { setPreview(false); attemptCreate(); }}>Create SO &amp; Submit to ERP Handoff</Button>
          </>
        }
      >
        {previewResolved ? (
          lines.length === 0 ? (
            <p className="py-10 text-center text-sm text-surface-400">Add at least one line item to preview the Sales Order.</p>
          ) : (
            <SalesOrderDocument resolved={previewResolved} showLetterhead />
          )
        ) : null}
      </Modal>
    </>
  );
}

function Section({ icon, n, label }: { icon: React.ReactNode; n: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="text-surface-400">{n}.</span> {label}
    </span>
  );
}

function ToggleTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-500 hover:text-surface-700'}`}
    >
      {children}
    </button>
  );
}
