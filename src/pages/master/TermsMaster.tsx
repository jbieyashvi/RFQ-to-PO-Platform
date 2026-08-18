import { useEffect, useMemo, useState } from 'react';
import {
  Save,
  RotateCcw,
  Plus,
  Pencil,
  Power,
  Package,
  Truck,
  Wallet,
  ClipboardCheck,
} from 'lucide-react';
import { PageHeader } from '@/layout/PageHeader';
import {
  Button,
  SectionCard,
  StatusBadge,
  TextField,
  Modal,
  ConfirmDialog,
} from '@/components/ui';
import { IconBtn } from './ItemMaster';
import { useApp } from '@/context/AppContext';
import { classNames } from '@/lib/format';
import type { CommercialTerms, DeliveryOption, PaymentTerms } from '@/types';
import {
  cloneCommercialTerms,
  paymentTotal,
  formatPaymentTerms,
  formatWarranty,
  defaultDeliveryOption,
  PAYMENT_FIELDS,
} from '@/lib/commercialTerms';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const toNum = (v: string) => (v === '' ? 0 : Number(v));

export default function TermsMaster() {
  const { commercialTerms, setCommercialTerms, resetCommercialTerms, can, addToast } = useApp();
  const canEdit = can('tc_master', 'edit');

  // Local editable draft — the store is only updated on Save / Reset.
  const [draft, setDraft] = useState<CommercialTerms>(() => cloneCommercialTerms(commercialTerms));
  // Re-sync the draft if the store changes underneath (e.g. Reset from context).
  useEffect(() => {
    setDraft(cloneCommercialTerms(commercialTerms));
  }, [commercialTerms]);

  const [editingOption, setEditingOption] = useState<DeliveryOption | null>(null);
  const [isNewOption, setIsNewOption] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<DeliveryOption | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const total = paymentTotal(draft.payment);
  const paymentValid = total === 100;
  const canSave = canEdit && paymentValid;

  const previewDelivery = defaultDeliveryOption(draft)?.name ?? '—';

  // ---- mutators on the draft --------------------------------------------
  const patch = (p: Partial<CommercialTerms>) => setDraft((d) => ({ ...d, ...p }));
  const setPayment = (key: keyof PaymentTerms, value: number) =>
    setDraft((d) => ({ ...d, payment: { ...d.payment, [key]: clamp(value, 0, 100) } }));

  const setDefaultOption = (id: string) =>
    setDraft((d) => ({
      ...d,
      deliveryOptions: d.deliveryOptions.map((o) => ({ ...o, isDefault: o.id === id })),
    }));

  const applyActive = (id: string, active: boolean) =>
    setDraft((d) => ({
      ...d,
      deliveryOptions: d.deliveryOptions.map((o) => (o.id === id ? { ...o, active } : o)),
    }));

  const onToggleActive = (o: DeliveryOption) => {
    if (o.active) {
      if (o.isDefault) {
        addToast({
          type: 'warning',
          title: 'Set another default first',
          message: `Mark another active option as default before deactivating "${o.name}".`,
        });
        return;
      }
      setConfirmDeactivate(o);
    } else {
      applyActive(o.id, true);
    }
  };

  const saveOption = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (editingOption && !isNewOption) {
      setDraft((d) => ({
        ...d,
        deliveryOptions: d.deliveryOptions.map((o) =>
          o.id === editingOption.id ? { ...o, name: trimmed } : o
        ),
      }));
    } else {
      setDraft((d) => ({
        ...d,
        deliveryOptions: [
          ...d.deliveryOptions,
          { id: `del-${Date.now()}`, name: trimmed, active: true, isDefault: false },
        ],
      }));
    }
    setEditingOption(null);
  };

  const onSave = () => {
    if (!canSave) return;
    setCommercialTerms(draft);
    addToast({ type: 'success', title: 'Commercial terms updated', message: 'Commercial terms updated.' });
  };

  const onReset = () => {
    resetCommercialTerms();
    setConfirmReset(false);
    addToast({ type: 'success', title: 'Reset to defaults', message: 'Restored the default commercial terms.' });
  };

  return (
    <>
      <PageHeader
        title="T&C Master"
        description="Configure the default commercial terms used in quotations and sales orders."
        crumbs={[{ label: 'Master' }, { label: 'T&C Master' }]}
        actions={
          canEdit ? (
            <>
              <Button
                variant="secondary"
                leftIcon={<RotateCcw className="h-4 w-4" />}
                onClick={() => setConfirmReset(true)}
              >
                Reset to Defaults
              </Button>
              <Button
                variant="primary"
                leftIcon={<Save className="h-4 w-4" />}
                onClick={onSave}
                disabled={!canSave}
                title={!paymentValid ? 'Payment terms must total 100%' : undefined}
              >
                Save Changes
              </Button>
            </>
          ) : (
            <StatusBadge tone="gray" dot={false} label="View only" />
          )
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Left column */}
        <div className="space-y-5">
          {/* 1. Default Commercial Terms */}
          <SectionCard title={<CardTitle icon={<Package className="h-4 w-4" />} label="Default Commercial Terms" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <NumField
                label="Packing"
                suffix="%"
                min={0}
                max={100}
                value={draft.packingPct}
                disabled={!canEdit}
                hint="Applied as a % of order value"
                onChange={(v) => patch({ packingPct: clamp(v, 0, 100) })}
              />
              <NumField
                label="Warranty"
                suffix="Year(s)"
                min={1}
                value={draft.warrantyYears}
                disabled={!canEdit}
                hint="Standard warranty period"
                onChange={(v) => patch({ warrantyYears: Math.max(1, v) })}
              />
            </div>
          </SectionCard>

          {/* 2. Delivery Options */}
          <SectionCard
            title={<CardTitle icon={<Truck className="h-4 w-4" />} label="Delivery Options" />}
            action={
              canEdit && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Plus className="h-4 w-4" />}
                  onClick={() => {
                    setEditingOption({ id: '', name: '', active: true, isDefault: false });
                    setIsNewOption(true);
                  }}
                >
                  Add Delivery Option
                </Button>
              )
            }
          >
            <div className="space-y-2">
              {draft.deliveryOptions.map((o) => (
                <div
                  key={o.id}
                  className={classNames(
                    'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                    o.isDefault ? 'border-brand-200 bg-brand-50/40' : 'border-surface-200'
                  )}
                >
                  <input
                    type="radio"
                    name="delivery-default"
                    checked={o.isDefault}
                    disabled={!canEdit || !o.active}
                    onChange={() => setDefaultOption(o.id)}
                    title={o.active ? 'Set as default' : 'Activate to set as default'}
                    className="h-4 w-4 flex-none text-brand-600 focus:ring-brand-500/40 disabled:opacity-40"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-surface-800" title={o.name}>
                      {o.name}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {o.isDefault && <StatusBadge tone="violet" dot={false} label="Default" />}
                      <StatusBadge tone={o.active ? 'green' : 'gray'} label={o.active ? 'Active' : 'Inactive'} />
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex flex-none items-center gap-0.5">
                      <IconBtn
                        title="Rename"
                        onClick={() => {
                          setEditingOption({ ...o });
                          setIsNewOption(false);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </IconBtn>
                      <IconBtn title={o.active ? 'Deactivate' : 'Activate'} onClick={() => onToggleActive(o)}>
                        <Power className={classNames('h-4 w-4', o.active ? 'text-emerald-500' : 'text-surface-400')} />
                      </IconBtn>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* 3. Default Payment Terms */}
          <SectionCard title={<CardTitle icon={<Wallet className="h-4 w-4" />} label="Default Payment Terms" />}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {PAYMENT_FIELDS.map((f) => (
                <NumField
                  key={f.key}
                  label={f.label}
                  suffix="%"
                  min={0}
                  max={100}
                  value={draft.payment[f.key]}
                  disabled={!canEdit}
                  onChange={(v) => setPayment(f.key, v)}
                />
              ))}
            </div>
            <div
              className={classNames(
                'mt-4 flex items-center justify-between rounded-lg px-3 py-2.5 text-[13px] font-semibold',
                paymentValid ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
              )}
            >
              <span>Total: {total}%</span>
              {!paymentValid && <span className="text-xs font-medium">Payment terms must total 100%</span>}
            </div>
          </SectionCard>

          {/* 4. Commercial Terms Preview */}
          <SectionCard title={<CardTitle icon={<ClipboardCheck className="h-4 w-4" />} label="Commercial Terms Preview" />}>
            <dl className="divide-y divide-surface-100 rounded-xl border border-surface-200">
              <PreviewRow label="Packing" value={`${draft.packingPct}%`} />
              <PreviewRow label="Delivery" value={previewDelivery} />
              <PreviewRow label="Warranty" value={formatWarranty(draft.warrantyYears)} />
              <PreviewRow label="Payment" value={formatPaymentTerms(draft.payment)} />
            </dl>
            <p className="mt-3 text-[12px] text-surface-400">
              These defaults prefill the Commercial Terms section when creating a sales order. They can be
              overridden per order without changing these master defaults.
            </p>
          </SectionCard>
        </div>
      </div>

      {/* Add / rename delivery option */}
      <DeliveryOptionModal
        option={editingOption}
        isNew={isNewOption}
        onClose={() => setEditingOption(null)}
        onSave={saveOption}
      />

      {/* Confirm deactivation */}
      <ConfirmDialog
        open={!!confirmDeactivate}
        onClose={() => setConfirmDeactivate(null)}
        onConfirm={() => {
          if (confirmDeactivate) applyActive(confirmDeactivate.id, false);
        }}
        title="Deactivate delivery option?"
        message={`"${confirmDeactivate?.name}" will no longer be available when creating a sales order.`}
        confirmLabel="Deactivate"
        danger
      />

      {/* Confirm reset */}
      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={onReset}
        title="Reset to defaults?"
        message="All commercial terms will be restored to the default values. Unsaved changes will be lost."
        confirmLabel="Reset to Defaults"
      />
    </>
  );
}

function CardTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      {label}
    </span>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5">
      <dt className="text-[12px] text-surface-500">{label}</dt>
      <dd className="text-[13px] font-medium text-surface-800">{value}</dd>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          type="number"
          className={classNames('input', suffix && 'pr-16')}
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(toNum(e.target.value))}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-surface-400">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-surface-400">{hint}</p>}
    </div>
  );
}

function DeliveryOptionModal({
  option,
  isNew,
  onClose,
  onSave,
}: {
  option: DeliveryOption | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (option) {
      setName(option.name);
      setError('');
    }
  }, [option]);
  if (!option) return null;

  const submit = () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    onSave(name);
  };

  return (
    <Modal
      open={!!option}
      onClose={onClose}
      title={isNew ? 'Add Delivery Option' : 'Rename Delivery Option'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit}>
            {isNew ? 'Add Option' : 'Save'}
          </Button>
        </>
      }
    >
      <TextField
        label="Option Name"
        required
        value={name}
        error={error}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. FOR Destination"
        autoFocus
      />
    </Modal>
  );
}
