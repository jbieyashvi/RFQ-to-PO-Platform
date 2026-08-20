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
  // Accept both date-only ('2026-08-08') and full ISO datetimes — format the
  // calendar day either way.
  const d = new Date(iso.slice(0, 10) + 'T00:00:00');
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

// Indian-system amount in words, e.g. 1,25,000 → "Rupees One Lakh Twenty Five
// Thousand Only". Used on Sales Order / revision documents.
export function amountInWords(value: number): string {
  const n = Math.round(Math.abs(value));
  if (n === 0) return 'Rupees Zero Only';
  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const twoDigits = (num: number): string => {
    if (num < 20) return ones[num];
    return `${tens[Math.floor(num / 10)]}${num % 10 ? ' ' + ones[num % 10] : ''}`;
  };
  const threeDigits = (num: number): string => {
    const h = Math.floor(num / 100);
    const rest = num % 100;
    return `${h ? ones[h] + ' Hundred' + (rest ? ' ' : '') : ''}${rest ? twoDigits(rest) : ''}`;
  };
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = n % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${twoDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));
  return `Rupees ${parts.join(' ').trim()} Only`;
}
