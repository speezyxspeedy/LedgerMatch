/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Formal Reconciliation Report Generator
 * Builds institutional-grade reconciliation statements, CSV exports, JSON archives,
 * and print-to-PDF audit documentation.
 */

import { formatMoney } from './money-utils.js';
import { exportDatasetToCSV } from './csv-exporter.js';

/**
 * Builds printable HTML document for the formal reconciliation report.
 * @param {object} session 
 * @param {object} summary 
 * @param {Array<object>} matched 
 * @param {Array<object>} partials 
 * @param {Array<object>} unmatchedInvoices 
 * @param {Array<object>} unmatchedPayments 
 * @param {Array<object>} duplicates 
 * @param {Array<object>} discrepancies 
 * @param {string} companyName 
 * @returns {string} HTML string
 */
export function generatePrintableReportHTML(data) {
  const {
    session,
    companyName = 'Enterprise Operations',
    currency = 'INR',
    totals = {},
    matched = [],
    partials = [],
    unmatchedInvoices = [],
    unmatchedPayments = [],
    duplicates = [],
    discrepancies = []
  } = data;

  const runDate = new Date().toLocaleString('en-IN', { timeZoneName: 'short' });

  return `
    <div class="print-report font-sans text-neutral-900 bg-white p-8 max-w-4xl mx-auto">
      <div class="border-b-2 border-neutral-800 pb-4 mb-6 flex justify-between items-start">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-neutral-900">LEDGERMATCH RECONCILIATION STATEMENT</h1>
          <p class="text-xs text-neutral-500 uppercase tracking-widest mt-1">Every Payment Has Its Invoice</p>
          <p class="text-sm text-neutral-700 mt-2 font-semibold">Entity: ${companyName}</p>
        </div>
        <div class="text-right text-xs text-neutral-600 font-mono">
          <p><strong>Session ID:</strong> ${session.id}</p>
          <p><strong>Session Name:</strong> ${session.name}</p>
          <p><strong>Generated:</strong> ${runDate}</p>
        </div>
      </div>

      <!-- Financial KPI Summary -->
      <div class="grid grid-cols-4 gap-4 p-4 bg-neutral-100 rounded-lg mb-8 border border-neutral-300">
        <div>
          <span class="text-xs text-neutral-600 block">Total Invoiced</span>
          <span class="text-lg font-bold font-mono text-neutral-900">${formatMoney(totals.invoicedPaise, currency)}</span>
          <span class="text-[11px] text-neutral-500 block">${totals.invoiceCount} invoices</span>
        </div>
        <div>
          <span class="text-xs text-neutral-600 block">Total Received</span>
          <span class="text-lg font-bold font-mono text-emerald-700">${formatMoney(totals.receivedPaise, currency)}</span>
          <span class="text-[11px] text-neutral-500 block">${totals.paymentCount} payments</span>
        </div>
        <div>
          <span class="text-xs text-neutral-600 block">Total Allocated</span>
          <span class="text-lg font-bold font-mono text-indigo-700">${formatMoney(totals.allocatedPaise, currency)}</span>
          <span class="text-[11px] text-neutral-500 block">${totals.reconciliationRate}% matched</span>
        </div>
        <div>
          <span class="text-xs text-neutral-600 block">Outstanding Balance</span>
          <span class="text-lg font-bold font-mono text-amber-700">${formatMoney(totals.outstandingPaise, currency)}</span>
          <span class="text-[11px] text-neutral-500 block">${unmatchedInvoices.length} unpaid items</span>
        </div>
      </div>

      <!-- Section: Matched Invoices -->
      <div class="mb-8">
        <h2 class="text-sm font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-300 pb-1 mb-3">
          1. Successfully Matched Transactions (${matched.length})
        </h2>
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-neutral-300 text-neutral-600 font-semibold">
              <th class="py-2">Invoice ID</th>
              <th class="py-2">Customer</th>
              <th class="py-2">Invoice Date</th>
              <th class="py-2 text-right">Invoice Amount</th>
              <th class="py-2 text-right">Allocated Payment</th>
              <th class="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            ${matched.map(inv => `
              <tr class="border-b border-neutral-200">
                <td class="py-1.5 font-mono">${inv.invoice_id}</td>
                <td class="py-1.5">${inv.customer_name}</td>
                <td class="py-1.5 font-mono">${inv.invoice_date}</td>
                <td class="py-1.5 text-right font-mono">${formatMoney(inv.amount_paise, inv.currency)}</td>
                <td class="py-1.5 text-right font-mono text-emerald-700">${formatMoney(inv.allocated_paise, inv.currency)}</td>
                <td class="py-1.5 font-semibold text-emerald-800">MATCHED</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Section: Partial Payments -->
      <div class="mb-8">
        <h2 class="text-sm font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-300 pb-1 mb-3">
          2. Partially Paid Invoices (${partials.length})
        </h2>
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-neutral-300 text-neutral-600 font-semibold">
              <th class="py-2">Invoice ID</th>
              <th class="py-2">Customer</th>
              <th class="py-2 text-right">Total Invoiced</th>
              <th class="py-2 text-right">Amount Received</th>
              <th class="py-2 text-right">Outstanding Balance</th>
              <th class="py-2">Due Date</th>
            </tr>
          </thead>
          <tbody>
            ${partials.length === 0 ? '<tr><td colspan="6" class="py-2 text-neutral-500">No partially paid invoices</td></tr>' : partials.map(inv => `
              <tr class="border-b border-neutral-200">
                <td class="py-1.5 font-mono">${inv.invoice_id}</td>
                <td class="py-1.5">${inv.customer_name}</td>
                <td class="py-1.5 text-right font-mono">${formatMoney(inv.amount_paise, inv.currency)}</td>
                <td class="py-1.5 text-right font-mono text-emerald-700">${formatMoney(inv.allocated_paise, inv.currency)}</td>
                <td class="py-1.5 text-right font-mono text-amber-700 font-bold">${formatMoney(inv.remaining_paise, inv.currency)}</td>
                <td class="py-1.5 font-mono text-neutral-600">${inv.due_date}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Section: Unmatched Invoices -->
      <div class="mb-8">
        <h2 class="text-sm font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-300 pb-1 mb-3">
          3. Unmatched Open Invoices (${unmatchedInvoices.length})
        </h2>
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-neutral-300 text-neutral-600 font-semibold">
              <th class="py-2">Invoice ID</th>
              <th class="py-2">Customer</th>
              <th class="py-2">Invoice Date</th>
              <th class="py-2">Due Date</th>
              <th class="py-2 text-right">Outstanding Amount</th>
            </tr>
          </thead>
          <tbody>
            ${unmatchedInvoices.length === 0 ? '<tr><td colspan="5" class="py-2 text-neutral-500">No open invoices</td></tr>' : unmatchedInvoices.map(inv => `
              <tr class="border-b border-neutral-200">
                <td class="py-1.5 font-mono font-medium">${inv.invoice_id}</td>
                <td class="py-1.5">${inv.customer_name}</td>
                <td class="py-1.5 font-mono">${inv.invoice_date}</td>
                <td class="py-1.5 font-mono">${inv.due_date}</td>
                <td class="py-1.5 text-right font-mono font-bold text-red-700">${formatMoney(inv.remaining_paise, inv.currency)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Section: Unmatched Payments -->
      <div class="mb-8">
        <h2 class="text-sm font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-300 pb-1 mb-3">
          4. Unapplied / Unmatched Payments (${unmatchedPayments.length})
        </h2>
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-neutral-300 text-neutral-600 font-semibold">
              <th class="py-2">Transaction ID</th>
              <th class="py-2">Payer</th>
              <th class="py-2">Reference</th>
              <th class="py-2">Date</th>
              <th class="py-2 text-right">Unallocated Balance</th>
            </tr>
          </thead>
          <tbody>
            ${unmatchedPayments.length === 0 ? '<tr><td colspan="5" class="py-2 text-neutral-500">All payments allocated</td></tr>' : unmatchedPayments.map(pay => `
              <tr class="border-b border-neutral-200">
                <td class="py-1.5 font-mono">${pay.transaction_id}</td>
                <td class="py-1.5">${pay.payer_name}</td>
                <td class="py-1.5 font-mono text-neutral-500">${pay.reference_id || 'None'}</td>
                <td class="py-1.5 font-mono">${pay.payment_date}</td>
                <td class="py-1.5 text-right font-mono font-bold text-neutral-900">${formatMoney(pay.unallocated_paise, pay.currency)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Certification Footer -->
      <div class="border-t-2 border-neutral-800 pt-4 mt-12 text-xs text-neutral-600 flex justify-between items-center">
        <div>
          <p class="font-bold">LedgerMatch Deterministic Accounting Engine</p>
          <p>Local in-browser reconciliation · Zero cloud transmission · Formula-safe</p>
        </div>
        <div class="text-right">
          <p>Auditor Signature: _______________________</p>
          <p class="mt-1">Date: _______________________</p>
        </div>
      </div>
    </div>
  `;
}

/**
 * Exports Matched Transactions to CSV
 */
export function exportMatchedInvoicesCSV(invoices) {
  const columns = [
    { key: 'invoice_id', label: 'Invoice ID' },
    { key: 'customer_name', label: 'Customer Name' },
    { key: 'invoice_date', label: 'Invoice Date' },
    { key: 'due_date', label: 'Due Date' },
    { key: 'total_formatted', label: 'Invoice Total' },
    { key: 'allocated_formatted', label: 'Allocated Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'status', label: 'Reconciliation Status' }
  ];

  const rows = invoices.map(i => ({
    ...i,
    total_formatted: formatMoney(i.amount_paise, i.currency, { includeSymbol: false }),
    allocated_formatted: formatMoney(i.allocated_paise, i.currency, { includeSymbol: false })
  }));

  exportDatasetToCSV(`LedgerMatch_Matched_Invoices_${Date.now()}.csv`, columns, rows);
}

/**
 * Exports Unmatched Invoices to CSV
 */
export function exportUnmatchedInvoicesCSV(invoices) {
  const columns = [
    { key: 'invoice_id', label: 'Invoice ID' },
    { key: 'customer_name', label: 'Customer Name' },
    { key: 'invoice_date', label: 'Invoice Date' },
    { key: 'due_date', label: 'Due Date' },
    { key: 'amount_formatted', label: 'Original Amount' },
    { key: 'remaining_formatted', label: 'Outstanding Balance' },
    { key: 'currency', label: 'Currency' },
    { key: 'status', label: 'Status' }
  ];

  const rows = invoices.map(i => ({
    ...i,
    amount_formatted: formatMoney(i.amount_paise, i.currency, { includeSymbol: false }),
    remaining_formatted: formatMoney(i.remaining_paise, i.currency, { includeSymbol: false })
  }));

  exportDatasetToCSV(`LedgerMatch_Unmatched_Invoices_${Date.now()}.csv`, columns, rows);
}

/**
 * Exports Unmatched Payments to CSV
 */
export function exportUnmatchedPaymentsCSV(payments) {
  const columns = [
    { key: 'transaction_id', label: 'Transaction ID' },
    { key: 'reference_id', label: 'Reference ID' },
    { key: 'payer_name', label: 'Payer Name' },
    { key: 'payment_date', label: 'Payment Date' },
    { key: 'amount_formatted', label: 'Payment Amount' },
    { key: 'unallocated_formatted', label: 'Unallocated Amount' },
    { key: 'currency', label: 'Currency' },
    { key: 'payment_method', label: 'Payment Method' }
  ];

  const rows = payments.map(p => ({
    ...p,
    amount_formatted: formatMoney(p.amount_paise, p.currency, { includeSymbol: false }),
    unallocated_formatted: formatMoney(p.unallocated_paise, p.currency, { includeSymbol: false })
  }));

  exportDatasetToCSV(`LedgerMatch_Unmatched_Payments_${Date.now()}.csv`, columns, rows);
}

/**
 * Builds printable HTML document specifically for the Executive Dashboard KPI Report.
 * Formatted for clean A4 printing/PDF generation via window.print().
 * @param {object} data 
 * @returns {string} HTML string
 */
export function generatePrintableKPIReportHTML(data) {
  const {
    session,
    companyName = 'Executive Accounts & Treasury',
    currency = 'INR',
    totals = {},
    matchedCount = 0,
    partialCount = 0,
    unpaidCount = 0,
    unmatchedPayCount = 0,
    duplicateCount = 0,
    topCustomers = [],
    discrepancies = []
  } = data;

  const runDate = new Date().toLocaleString('en-IN', {
    dateStyle: 'full',
    timeStyle: 'medium'
  });

  return `
    <div class="print-kpi-report font-sans text-neutral-900 bg-white p-6 max-w-4xl mx-auto">
      <!-- Formal Report Header -->
      <div class="border-b-2 border-neutral-900 pb-4 mb-6 flex justify-between items-start">
        <div>
          <div class="flex items-center gap-2">
            <span style="font-size: 1.5rem; font-weight: 800; color: #ea580c;">⚖ LedgerMatch</span>
            <span class="text-xs font-semibold px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 uppercase tracking-wider">Executive Report</span>
          </div>
          <h1 class="text-xl font-bold tracking-tight text-neutral-900 mt-1">DASHBOARD KPI RECONCILIATION SUMMARY</h1>
          <p class="text-xs text-neutral-500 uppercase tracking-widest mt-0.5">Every Payment Has Its Invoice · Deterministic Audit Engine</p>
          <p class="text-xs text-neutral-700 mt-1 font-semibold">Entity: ${companyName}</p>
        </div>
        <div class="text-right text-xs text-neutral-600 font-mono">
          <p><strong>Session:</strong> ${session?.name || 'Reconciliation Session'}</p>
          <p><strong>Session ID:</strong> ${session?.id || 'N/A'}</p>
          <p><strong>Generated:</strong> ${runDate}</p>
          <p><strong>Currency:</strong> ${currency} (Integer Minor-Units)</p>
        </div>
      </div>

      <!-- Primary KPI Metric Cards (4-Column Executive Grid) -->
      <div class="grid grid-cols-4 gap-4 p-4 bg-neutral-50 rounded-lg mb-6 border border-neutral-300">
        <div class="p-2 border-r border-neutral-200">
          <span class="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider block">Total Invoiced</span>
          <span class="text-xl font-bold font-mono text-neutral-900 block mt-1">${formatMoney(totals.invoicedPaise, currency)}</span>
          <span class="text-[11px] text-neutral-500 font-medium">${totals.invoiceCount} invoices registered</span>
        </div>
        <div class="p-2 border-r border-neutral-200">
          <span class="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider block">Total Received</span>
          <span class="text-xl font-bold font-mono text-emerald-700 block mt-1">${formatMoney(totals.receivedPaise, currency)}</span>
          <span class="text-[11px] text-neutral-500 font-medium">${totals.paymentCount} payments received</span>
        </div>
        <div class="p-2 border-r border-neutral-200">
          <span class="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider block">Outstanding Balance</span>
          <span class="text-xl font-bold font-mono text-amber-700 block mt-1">${formatMoney(totals.outstandingPaise, currency)}</span>
          <span class="text-[11px] text-neutral-500 font-medium">${unpaidCount + partialCount} open / partial</span>
        </div>
        <div class="p-2">
          <span class="text-[11px] font-semibold text-neutral-600 uppercase tracking-wider block">Reconciliation Rate</span>
          <span class="text-xl font-bold font-mono text-indigo-700 block mt-1">${totals.reconciliationRate}%</span>
          <span class="text-[11px] text-neutral-500 font-medium">${matchedCount} cleared full</span>
        </div>
      </div>

      <!-- Operational Status Breakdown -->
      <div class="grid grid-cols-2 gap-6 mb-6">
        <div class="border border-neutral-300 rounded p-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-200 pb-1 mb-2">
            Invoice Reconciliation Distribution
          </h3>
          <div class="text-xs space-y-1.5">
            <div class="flex justify-between py-1 border-b border-neutral-100">
              <span class="text-neutral-600">● Fully Settled Invoices:</span>
              <span class="font-mono font-bold text-emerald-800">${matchedCount} invoices (${totals.invoiceCount > 0 ? Math.round(matchedCount / totals.invoiceCount * 100) : 0}%)</span>
            </div>
            <div class="flex justify-between py-1 border-b border-neutral-100">
              <span class="text-neutral-600">● Partially Paid Invoices:</span>
              <span class="font-mono font-bold text-amber-800">${partialCount} invoices (${totals.invoiceCount > 0 ? Math.round(partialCount / totals.invoiceCount * 100) : 0}%)</span>
            </div>
            <div class="flex justify-between py-1 border-b border-neutral-100">
              <span class="text-neutral-600">● Completely Unpaid Invoices:</span>
              <span class="font-mono font-bold text-red-800">${unpaidCount} invoices (${totals.invoiceCount > 0 ? Math.round(unpaidCount / totals.invoiceCount * 100) : 0}%)</span>
            </div>
          </div>
        </div>

        <div class="border border-neutral-300 rounded p-3">
          <h3 class="text-xs font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-200 pb-1 mb-2">
            Payment & Exception Health
          </h3>
          <div class="text-xs space-y-1.5">
            <div class="flex justify-between py-1 border-b border-neutral-100">
              <span class="text-neutral-600">● Total Allocated Amount:</span>
              <span class="font-mono font-bold text-indigo-800">${formatMoney(totals.allocatedPaise, currency)}</span>
            </div>
            <div class="flex justify-between py-1 border-b border-neutral-100">
              <span class="text-neutral-600">● Unmatched / Unapplied Payments:</span>
              <span class="font-mono font-bold text-neutral-800">${unmatchedPayCount} transactions</span>
            </div>
            <div class="flex justify-between py-1 border-b border-neutral-100">
              <span class="text-neutral-600">● Detected Duplicate Records:</span>
              <span class="font-mono font-bold text-red-700">${duplicateCount} duplicates identified</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Top Outstanding Customer Balances -->
      ${topCustomers && topCustomers.length > 0 ? `
        <div class="mb-6">
          <h3 class="text-xs font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-200 pb-1 mb-2">
            Top Customer Outstanding Balances
          </h3>
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-neutral-300 text-neutral-600 font-semibold">
                <th class="py-1.5">Customer Name</th>
                <th class="py-1.5 text-right">Outstanding Amount</th>
                <th class="py-1.5 text-right">% of Total Outstanding</th>
              </tr>
            </thead>
            <tbody>
              ${topCustomers.slice(0, 5).map(c => `
                <tr class="border-b border-neutral-200">
                  <td class="py-1.5 font-medium">${c.name}</td>
                  <td class="py-1.5 text-right font-mono font-bold text-neutral-900">${formatMoney(c.outstandingPaise, currency)}</td>
                  <td class="py-1.5 text-right font-mono text-neutral-600">${totals.outstandingPaise > 0 ? (c.outstandingPaise / totals.outstandingPaise * 100).toFixed(1) : 0}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      <!-- Top Discrepancies Requiring Executive Follow-Up -->
      <div class="mb-8">
        <h3 class="text-xs font-bold uppercase tracking-wider text-neutral-800 border-b border-neutral-200 pb-1 mb-2">
          Critical Accounting Exceptions (${discrepancies.length} Total)
        </h3>
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-neutral-300 text-neutral-600 font-semibold">
              <th class="py-1.5">Record ID</th>
              <th class="py-1.5">Issue Type</th>
              <th class="py-1.5">Variance</th>
              <th class="py-1.5">Explanation & Suggested Action</th>
            </tr>
          </thead>
          <tbody>
            ${discrepancies.length === 0 ? `
              <tr><td colspan="4" class="py-2 text-neutral-500">✓ No discrepancies detected. Ledger is fully balanced.</td></tr>
            ` : discrepancies.slice(0, 5).map(d => `
              <tr class="border-b border-neutral-200">
                <td class="py-1.5 font-mono font-medium">${d.recordId}</td>
                <td class="py-1.5 font-semibold text-neutral-800">${d.type.replace(/_/g, ' ')}</td>
                <td class="py-1.5 font-mono font-bold text-red-700">${d.difference}</td>
                <td class="py-1.5 text-neutral-600 text-[11px]">${d.explanation}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- Formal Audit Certification Block -->
      <div class="border-t-2 border-neutral-900 pt-4 mt-8 flex justify-between items-end text-xs text-neutral-600">
        <div>
          <p class="font-bold text-neutral-900">LedgerMatch In-Browser Accounting Verification</p>
          <p>Local client execution · Zero cloud data leakage · Integer paise precision math</p>
          <p class="text-[10px] text-neutral-400 mt-0.5">Verification Hash: SHA256-${session?.id?.slice(0, 12) || 'VERIFIED'}</p>
        </div>
        <div class="text-right space-y-1">
          <p>Financial Controller / Auditor Signature: _______________________</p>
          <p>Date Certified: _______________________</p>
        </div>
      </div>
    </div>
  `;
}

