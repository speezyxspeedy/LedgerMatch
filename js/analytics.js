/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Native SVG/Canvas Analytics Engine
 * Generates responsive financial visualizations strictly using native DOM/SVG.
 * Zero external charting libraries or telemetry tracking.
 */

import { formatMoney, paiseToMajor } from './money-utils.js';

/**
 * Generates an interactive SVG Donut Chart showing reconciliation status distribution.
 * @param {Array<{ label: string, count: number, color: string }>} segments 
 * @param {number} total 
 * @returns {string} SVG HTML markup
 */
export function renderDonutChart(segments, total, centerLabel = 'Total Records') {
  if (!total || total === 0) {
    return `
      <div class="flex flex-col items-center justify-center p-8 text-neutral-400">
        <svg class="w-16 h-16 opacity-30 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2"/>
        </svg>
        <span class="text-sm">No reconciliation data to chart</span>
      </div>
    `;
  }

  const radius = 65;
  const circumference = 2 * Math.PI * radius;
  let strokeOffset = 0;

  const circles = segments.map(seg => {
    if (seg.count === 0) return '';
    const strokeDash = (seg.count / total) * circumference;
    const currentOffset = strokeOffset;
    strokeOffset -= strokeDash;

    return `
      <circle
        cx="90" cy="90" r="${radius}"
        fill="transparent"
        stroke="${seg.color}"
        stroke-width="24"
        stroke-dasharray="${strokeDash} ${circumference}"
        stroke-dashoffset="${currentOffset}"
        class="transition-all duration-500 hover:opacity-85"
      >
        <title>${seg.label}: ${seg.count} (${Math.round(seg.count / total * 100)}%)</title>
      </circle>
    `;
  }).join('');

  const legend = segments.map(seg => `
    <div class="flex items-center justify-between text-xs py-1">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${seg.color}"></span>
        <span class="text-neutral-300">${seg.label}</span>
      </div>
      <span class="font-mono tabular-nums text-neutral-200 font-medium">${seg.count} <span class="text-neutral-500">(${Math.round(seg.count / total * 100)}%)</span></span>
    </div>
  `).join('');

  return `
    <div class="flex flex-col md:flex-row items-center justify-between gap-6">
      <div class="relative w-48 h-48 shrink-0">
        <svg class="w-full h-full -rotate-90 transform" viewBox="0 0 180 180">
          <circle cx="90" cy="90" r="${radius}" fill="transparent" stroke="rgba(255,255,255,0.05)" stroke-width="24" />
          ${circles}
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
          <span class="text-2xl font-bold font-mono tabular-nums text-white">${total}</span>
          <span class="text-[11px] text-neutral-400 uppercase tracking-wider">${centerLabel}</span>
        </div>
      </div>
      <div class="w-full flex-1 divide-y divide-neutral-800">
        ${legend}
      </div>
    </div>
  `;
}

/**
 * Generates an SVG Bar Chart comparing financial metrics (Invoiced vs Received vs Outstanding).
 * @param {Array<{ label: string, paise: number, color: string }>} metrics 
 * @param {string} currency 
 * @returns {string} SVG HTML markup
 */
export function renderFinancialBarChart(metrics, currency = 'INR') {
  const maxPaise = Math.max(...metrics.map(m => m.paise), 1);
  const chartHeight = 140;

  const bars = metrics.map((m, i) => {
    const barHeight = Math.max(8, Math.round((m.paise / maxPaise) * chartHeight));
    const yPos = chartHeight - barHeight + 10;
    const xPos = 40 + i * 110;

    return `
      <g class="bar-group transition-all">
        <rect
          x="${xPos}" y="${yPos}" width="65" height="${barHeight}"
          rx="4" fill="${m.color}"
          class="hover:opacity-85"
        >
          <title>${m.label}: ${formatMoney(m.paise, currency)}</title>
        </rect>
        <text x="${xPos + 32}" y="${yPos - 6}" text-anchor="middle" font-size="11" font-family="JetBrains Mono, monospace" fill="#e2e8f0" font-weight="600">
          ${formatMoney(m.paise, currency, { compact: true })}
        </text>
        <text x="${xPos + 32}" y="${chartHeight + 30}" text-anchor="middle" font-size="11" font-family="sans-serif" fill="#94a3b8">
          ${m.label}
        </text>
      </g>
    `;
  }).join('');

  return `
    <div class="w-full overflow-x-auto">
      <svg class="w-full" height="180" viewBox="0 0 400 180" preserveAspectRatio="xMidYMid meet">
        <line x1="20" y1="${chartHeight + 10}" x2="380" y2="${chartHeight + 10}" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
        ${bars}
      </svg>
    </div>
  `;
}

/**
 * Generates a horizontal bar chart showing top outstanding customer balances.
 * @param {Array<{ name: string, outstandingPaise: number }>} topCustomers 
 * @param {string} currency 
 * @returns {string}
 */
export function renderTopCustomerExposure(topCustomers, currency = 'INR') {
  if (!topCustomers || topCustomers.length === 0) {
    return `<div class="text-sm text-neutral-500 py-4 text-center">No outstanding customer balances</div>`;
  }

  const maxVal = Math.max(...topCustomers.map(c => c.outstandingPaise), 1);

  return topCustomers.slice(0, 5).map(c => {
    const pct = Math.max(5, Math.round((c.outstandingPaise / maxVal) * 100));
    return `
      <div class="py-2">
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-medium text-neutral-300 truncate max-w-[220px]" title="${c.name}">${c.name}</span>
          <span class="font-mono tabular-nums text-neutral-200 font-semibold">${formatMoney(c.outstandingPaise, currency)}</span>
        </div>
        <div class="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
          <div class="bg-indigo-500 h-full rounded-full transition-all duration-500" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}
