// charts.js — dependency-free SVG charts using the validated data-viz palette.

import { money, moneyCompact, pct, escapeHtml, dateLabel } from './format.js';

// Categorical palette (validated order). Light stays print-safe; dark goes neon.
// Index 1 (income) and 5 (expenses) are kept high-contrast — see compareBars callers.
const PALETTE = {
  light: ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'],
  dark:  ['#00ffff', '#00ff9f', '#ff00ff', '#ffcf1a', '#b47bff', '#ff6a3d', '#5ad1ff', '#ff4d6d'],
};

function theme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}
export function seriesColor(i) {
  const p = PALETTE[theme()];
  return p[i % p.length];
}
function surface() { return theme() === 'light' ? '#fcfcfb' : '#1a1a19'; }

/**
 * Donut chart with legend. `items` = [{ category, amount }] (already sorted desc).
 * Folds anything past 8 slots into "Other". Returns an HTML string.
 */
export function donut(items, { centerLabel = 'Total', size = 200, stroke = 26 } = {}) {
  const clean = items.filter(d => d.amount > 0);
  const total = clean.reduce((s, d) => s + d.amount, 0);
  if (total <= 0) {
    return `<div class="empty" style="padding:30px"><div class="empty-ico">◎</div><p>No data yet</p></div>`;
  }

  // Fold to a max of 8 visible slices.
  let slices = clean;
  if (clean.length > 8) {
    const head = clean.slice(0, 7);
    const rest = clean.slice(7).reduce((s, d) => s + d.amount, 0);
    slices = [...head, { category: 'Other', amount: rest }];
  }

  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const gap = total > 0 ? 2 : 0; // 2px surface gap between segments

  const segs = slices.map((d, i) => {
    const frac = d.amount / total;
    const len = Math.max(0, frac * circ - gap);
    const color = seriesColor(i);
    const dash = `${len} ${circ - len}`;
    const seg = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none"
      stroke="${color}" stroke-width="${stroke}" stroke-linecap="butt"
      stroke-dasharray="${dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cy})">
      <title>${escapeHtml(d.category)}: ${money(d.amount)} (${pct(frac, 0)})</title></circle>`;
    offset += frac * circ;
    return seg;
  }).join('');

  const svg = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending by category">
    <circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${surface()}" stroke-width="${stroke}" opacity="0"></circle>
    ${segs}
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="donut-center-value"
      fill="var(--text-1)" font-size="20">${escapeHtml(moneyCompact(total))}</text>
    <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="var(--muted)" font-size="11">${escapeHtml(centerLabel)}</text>
  </svg>`;

  const legend = `<div class="legend">${slices.map((d, i) => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${seriesColor(i)}"></span>
      <span class="legend-name">${escapeHtml(d.category)}</span>
      <span class="legend-val">${escapeHtml(money(d.amount))}</span>
      <span class="legend-pct">${pct(d.amount / total, 0)}</span>
    </div>`).join('')}</div>`;

  return `<div class="donut-layout">
    <div class="chart">${svg}</div>${legend}</div>`;
}

/**
 * Compact income-vs-expenses comparison as two stacked horizontal bars.
 * `rows` = [{ label, value, color }]. Shares one max scale.
 */
export function compareBars(rows, { format = money } = {}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const w = 100; // percentage-based track
  return `<div style="display:flex;flex-direction:column;gap:14px">
    ${rows.map(r => {
      const pctW = Math.max(0, (r.value / max) * w);
      return `<div>
        <div class="flex between" style="font-size:13px;margin-bottom:6px">
          <span class="text-muted">${escapeHtml(r.label)}</span>
          <strong style="font-variant-numeric:tabular-nums">${escapeHtml(format(r.value))}</strong>
        </div>
        <div class="progress" style="height:12px"><span style="width:${pctW}%;background:${r.color}"></span></div>
      </div>`;
    }).join('')}
  </div>`;
}

/** A single labelled progress bar (for goals / installment payoff). */
export function progressBar(fraction, { good = false, height = 8 } = {}) {
  const w = Math.max(0, Math.min(1, fraction)) * 100;
  return `<div class="progress ${good ? 'good' : ''}" style="height:${height}px"><span style="width:${w}%"></span></div>`;
}

/**
 * Chronological line chart for a running balance. `points` = [{ date, balance }]
 * already in ascending date order (see calc.js's accountBalanceHistory /
 * netWorthHistory). Draws a dashed zero-line when the series crosses zero,
 * since that's the "went negative" moment that matters most here.
 */
export function lineChart(points, { height = 160, format = money } = {}) {
  if (!points || points.length < 2) {
    return `<div class="empty" style="padding:30px"><div class="empty-ico">↝</div><p>Not enough history yet — log a few transactions to see a trend.</p></div>`;
  }

  const width = 560;
  const pad = 10;
  const values = points.map(p => p.balance);
  let min = Math.min(...values, 0);
  let max = Math.max(...values, 0);
  if (min === max) { min -= 1; max += 1; }

  const xFor = i => pad + (i / (points.length - 1)) * (width - pad * 2);
  const yFor = v => height - pad - ((v - min) / (max - min)) * (height - pad * 2);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(1)} ${yFor(p.balance).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${xFor(points.length - 1).toFixed(1)} ${height - pad} L ${xFor(0).toFixed(1)} ${height - pad} Z`;
  const last = points[points.length - 1];
  const rising = last.balance >= points[0].balance;
  const color = rising ? seriesColor(1) : seriesColor(5); // same high-contrast income/expense pair compareBars uses
  const zeroY = yFor(0);
  const showZero = min < 0 && max > 0;

  return `<div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Balance over time" style="width:100%;height:${height}px;display:block">
      ${showZero ? `<line x1="${pad}" y1="${zeroY.toFixed(1)}" x2="${width - pad}" y2="${zeroY.toFixed(1)}" stroke="var(--border-2)" stroke-dasharray="4 4" />` : ''}
      <path d="${areaPath}" fill="${color}" opacity="0.12" stroke="none" />
      <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" />
      <circle cx="${xFor(points.length - 1).toFixed(1)}" cy="${yFor(last.balance).toFixed(1)}" r="4" fill="${color}">
        <title>${escapeHtml(dateLabel(last.date))}: ${escapeHtml(format(last.balance))}</title>
      </circle>
    </svg>
    <div class="flex between" style="font-size:12px;color:var(--muted);margin-top:6px">
      <span>${escapeHtml(dateLabel(points[0].date))} · ${escapeHtml(format(points[0].balance))}</span>
      <span>${escapeHtml(dateLabel(last.date))} · ${escapeHtml(format(last.balance))}</span>
    </div>
  </div>`;
}
