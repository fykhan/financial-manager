// format.js — currency / date / number formatting helpers

export const CURRENCIES = [
  { code: 'HKD', symbol: '$', locale: 'zh-HK' },
  { code: 'BDT', symbol: '৳', locale: 'bn-BD' },
  { code: 'CNY', symbol: '¥', locale: 'zh-CN' },
  { code: 'USD', symbol: '$', locale: 'en-US' },
  { code: 'EUR', symbol: '€', locale: 'de-DE' },
  { code: 'GBP', symbol: '£', locale: 'en-GB' },
  { code: 'SGD', symbol: '$', locale: 'en-SG' },
];

let _currency = 'USD';
export function setCurrency(code) { _currency = code || 'USD'; }
export function getCurrency() { return _currency; }

function localeFor(code) {
  return (CURRENCIES.find(c => c.code === code) || CURRENCIES[0]).locale;
}

/** Format an amount as currency. */
export function money(amount, opts = {}) {
  const code = opts.currency || _currency;
  const n = Number.isFinite(amount) ? amount : 0;
  const fractionless = code === 'JPY';
  try {
    return new Intl.NumberFormat(localeFor(code), {
      style: 'currency', currency: code,
      minimumFractionDigits: fractionless ? 0 : (opts.cents === false ? 0 : 2),
      maximumFractionDigits: fractionless ? 0 : (opts.cents === false ? 0 : 2),
    }).format(n);
  } catch {
    return `${code} ${n.toFixed(2)}`;
  }
}

/** Compact currency for tight spaces (e.g. $1.2k). */
export function moneyCompact(amount) {
  const code = _currency;
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat(localeFor(code), {
      style: 'currency', currency: code, notation: 'compact', maximumFractionDigits: 1,
    }).format(n);
  } catch { return money(n); }
}

export function pct(fraction, digits = 0) {
  const n = Number.isFinite(fraction) ? fraction : 0;
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n, digits = 0) {
  return new Intl.NumberFormat(localeFor(_currency), {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);
}

// Dates are always shown in English regardless of the selected currency —
// otherwise picking e.g. HKD (zh-HK) or CNY (zh-CN) would render month names
// in Chinese. Only the money helpers follow the currency's own locale.
const DATE_LOCALE = 'en-US';

/** "2026-07-15" -> "Jul 15, 2026" */
export function dateLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(DATE_LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** "2026-07-15" -> "Jul 2026" */
export function monthLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  if (isNaN(d)) return '—';
  return d.toLocaleDateString(DATE_LOCALE, { year: 'numeric', month: 'short' });
}

export function todayISO() {
  // Local calendar date, not toISOString() — the latter converts to UTC first,
  // so east-of-UTC users would get yesterday's date in the early hours.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function titleCase(s) {
  return String(s || '').replace(/\b\w/g, c => c.toUpperCase());
}
