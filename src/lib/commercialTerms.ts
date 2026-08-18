import type { CommercialTerms, DeliveryOption, PaymentTerms } from '@/types';

// ---------------------------------------------------------------------------
// PM-reference defaults for the Commercial Terms Master. These seed the store
// and are what "Reset to Defaults" restores.
// ---------------------------------------------------------------------------
export const DEFAULT_DELIVERY_OPTIONS: DeliveryOption[] = [
  { id: 'del-exw-vadodara', name: 'Ex Works — Vadodara', active: true, isDefault: true },
  { id: 'del-for-destination', name: 'FOR Destination', active: true, isDefault: false },
  { id: 'del-intl-1', name: 'International — Type 1', active: true, isDefault: false },
  { id: 'del-intl-2', name: 'International — Type 2', active: true, isDefault: false },
  { id: 'del-intl-3', name: 'International — Type 3', active: true, isDefault: false },
  { id: 'del-intl-4', name: 'International — Type 4', active: true, isDefault: false },
];

export const DEFAULT_COMMERCIAL_TERMS: CommercialTerms = {
  packingPct: 3,
  warrantyYears: 1,
  deliveryOptions: DEFAULT_DELIVERY_OPTIONS,
  payment: { advance: 100, beforeDispatch: 0, creditDays: 0, afterInstall: 0 },
};

// Deep clone so drafts / resets never share references with the live store.
export function cloneCommercialTerms(ct: CommercialTerms): CommercialTerms {
  return {
    packingPct: ct.packingPct,
    warrantyYears: ct.warrantyYears,
    deliveryOptions: ct.deliveryOptions.map((o) => ({ ...o })),
    payment: { ...ct.payment },
  };
}

export function paymentTotal(p: PaymentTerms): number {
  return p.advance + p.beforeDispatch + p.creditDays + p.afterInstall;
}

export const PAYMENT_FIELDS: { key: keyof PaymentTerms; label: string }[] = [
  { key: 'advance', label: 'Advance' },
  { key: 'beforeDispatch', label: 'Before Dispatch' },
  { key: 'creditDays', label: 'Credit Days' },
  { key: 'afterInstall', label: 'After Install' },
];

// Human-readable payment summary, e.g. "100% Advance" or "50% Advance, 50% Before Dispatch".
export function formatPaymentTerms(p: PaymentTerms): string {
  const parts = PAYMENT_FIELDS.filter((f) => p[f.key] > 0).map((f) => `${p[f.key]}% ${f.label}`);
  return parts.length ? parts.join(', ') : '—';
}

export function formatWarranty(years: number): string {
  return `${years} ${years === 1 ? 'Year' : 'Years'}`;
}

export function activeDeliveryOptions(ct: CommercialTerms): DeliveryOption[] {
  return ct.deliveryOptions.filter((o) => o.active);
}

// The current default (must be active); falls back to the first active option.
export function defaultDeliveryOption(ct: CommercialTerms): DeliveryOption | undefined {
  const active = activeDeliveryOptions(ct);
  return active.find((o) => o.isDefault) ?? active[0];
}
