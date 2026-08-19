export function formatINR(value: number, opts?: { compact?: boolean }): string {
  if (opts?.compact && Math.abs(value) >= 100000) {
    // Indian compact: Lakh / Crore
    if (Math.abs(value) >= 10000000) {
      return `₹${(value / 10000000).toFixed(2)} Cr`;
    }
    return `₹${(value / 100000).toFixed(2)} L`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

// Compact Indian currency for dense tables/cards: ₹86,000, ₹7.5L, ₹1.2Cr.
export function compactINR(value: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (Math.abs(value) >= 10000000) return `₹${trim(value / 10000000)}Cr`;
  if (Math.abs(value) >= 100000) return `₹${trim(value / 100000)}L`;
  return `₹${new Intl.NumberFormat('en-IN').format(Math.round(value))}`;
}

export function formatDate(iso: string, opts?: { short?: boolean }): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: opts?.short ? '2-digit' : 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Fixed "today" for a deterministic prototype
export const TODAY = new Date('2026-08-13T00:00:00');

export function daysBetween(iso: string, from: Date = TODAY): number {
  if (!iso) return 0;
  const d = new Date(iso + 'T00:00:00');
  return Math.round((from.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

export function ageLabel(iso: string): string {
  const days = daysBetween(iso);
  if (days <= 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export function isOverdue(reviewIso: string): boolean {
  if (!reviewIso) return false;
  return daysBetween(reviewIso) > 0;
}

export function lineTotal(qty: number, price: number, discountPct: number): number {
  const gross = qty * price;
  return gross - (gross * discountPct) / 100;
}

export function lineTax(qty: number, price: number, discountPct: number, taxPct: number): number {
  return (lineTotal(qty, price, discountPct) * taxPct) / 100;
}

export function computeTotals(
  items: { quantity: number; unitPrice: number; discountPct: number; taxPct: number }[],
  packingCharges = 0
) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const it of items) {
    const gross = it.quantity * it.unitPrice;
    subtotal += gross;
    discount += (gross * it.discountPct) / 100;
    tax += lineTax(it.quantity, it.unitPrice, it.discountPct, it.taxPct);
  }
  const taxable = subtotal - discount;
  const grandTotal = taxable + tax + packingCharges;
  return { subtotal, discount, taxable, tax, packingCharges, grandTotal };
}

export function downloadCSV(filename: string, rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const csv = rows.map((r) => r.map(escape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type: `${type};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function classNames(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(' ');
}
