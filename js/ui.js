/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Core User Interface Engine
 * Orchestrates all 12 operational views, two-panel reconciliation workspace,
 * modals, interactive charts, and toast notifications.
 */

import { formatMoney } from './money-utils.js';
import { getDaysDifference, calculateSimilarity } from './normalization.js';
import { renderDonutChart, renderFinancialBarChart, renderTopCustomerExposure } from './analytics.js';
import { exportMatchedInvoicesCSV, exportUnmatchedInvoicesCSV, exportUnmatchedPaymentsCSV, generatePrintableReportHTML, generatePrintableKPIReportHTML } from './report-generator.js';
import { exportSessionBackup, restoreSessionBackup } from './data-store.js';
import { runAllTests } from '../tests/core-tests.js';

export class UIEngine {
  constructor(app) {
    this.app = app;
    this.currentView = 'overview';
    this.invFilter = '';
    this.payFilter = '';
    this.tableFilter = '';
    this.selectedInvoiceId = null;
    this.selectedPaymentId = null;
    this.activeModal = null;
  }

  init() {
    this.bindSidebarNav();
    this.bindTopBarEvents();
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';

    let iconColor = 'var(--status-info)';
    if (type === 'success') iconColor = 'var(--status-matched)';
    if (type === 'error') iconColor = 'var(--status-unmatched)';
    if (type === 'warning') iconColor = 'var(--status-partial)';

    toast.innerHTML = `
      <span style="color: ${iconColor}; font-size: 1.125rem;">●</span>
      <span style="flex: 1;">${this.escapeHTML(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 200ms ease';
      setTimeout(() => toast.remove(), 200);
    }, 3500);
  }

  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  bindSidebarNav() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view) {
          this.switchView(view);
        }
      });
    });
  }

  bindTopBarEvents() {
    // Theme Switcher
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        const isLight = document.documentElement.classList.toggle('light');
        localStorage.setItem('ledgermatch_theme', isLight ? 'light' : 'dark');
        themeBtn.textContent = isLight ? '🌙 Dark Mode' : '☀️ Light Mode';
      });

      // Restore saved theme
      if (localStorage.getItem('ledgermatch_theme') === 'light') {
        document.documentElement.classList.add('light');
        themeBtn.textContent = '🌙 Dark Mode';
      }
    }

    // Top Bar Actions
    const quickReconcileBtn = document.getElementById('top-reconcile-btn');
    if (quickReconcileBtn) {
      quickReconcileBtn.addEventListener('click', async () => {
        await this.app.runReconciliation();
      });
    }

    const sessionSelectBtn = document.getElementById('session-select-btn');
    if (sessionSelectBtn) {
      sessionSelectBtn.addEventListener('click', () => {
        this.openSessionModal();
      });
    }
  }

  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    const container = document.getElementById('view-container');
    if (!container) return;

    switch (viewName) {
      case 'overview':
        this.renderOverview(container);
        break;
      case 'import':
        this.renderImport(container);
        break;
      case 'workspace':
        this.renderWorkspace(container);
        break;
      case 'matched':
        this.renderMatched(container);
        break;
      case 'partials':
        this.renderPartials(container);
        break;
      case 'unmatched-invoices':
        this.renderUnmatchedInvoices(container);
        break;
      case 'unmatched-payments':
        this.renderUnmatchedPayments(container);
        break;
      case 'duplicates':
        this.renderDuplicates(container);
        break;
      case 'review':
        this.renderReview(container);
        break;
      case 'reports':
        this.renderReports(container);
        break;
      case 'history':
        this.renderHistory(container);
        break;
      case 'settings':
        this.renderSettings(container);
        break;
      default:
        this.renderOverview(container);
    }
  }

  // ==========================================
  // VIEW 1: OVERVIEW DASHBOARD
  // ==========================================
  renderOverview(container) {
    const { totals, session, discrepancies } = this.app.getState();
    const currency = session?.settings?.currency || 'INR';

    const matchedInvoices = this.app.invoices.filter(i => i.status === 'FULLY_PAID');
    const partialInvoices = this.app.invoices.filter(i => i.status === 'PARTIALLY_PAID');
    const unpaidInvoices = this.app.invoices.filter(i => i.status === 'UNPAID');

    // Customer Outstanding Exposure
    const customerBalMap = new Map();
    for (const inv of this.app.invoices) {
      if (inv.remaining_paise > 0) {
        const cur = customerBalMap.get(inv.customer_name) || 0;
        customerBalMap.set(inv.customer_name, cur + inv.remaining_paise);
      }
    }
    const topCustomers = Array.from(customerBalMap.entries())
      .map(([name, outstandingPaise]) => ({ name, outstandingPaise }))
      .sort((a, b) => b.outstandingPaise - a.outstandingPaise);

    // Donut Segments
    const donutSegments = [
      { label: 'Fully Matched', count: matchedInvoices.length, color: 'var(--status-matched)' },
      { label: 'Partially Paid', count: partialInvoices.length, color: 'var(--status-partial)' },
      { label: 'Unpaid Invoices', count: unpaidInvoices.length, color: 'var(--status-unmatched)' }
    ];

    // Bar Chart
    const barMetrics = [
      { label: 'Total Invoiced', paise: totals.invoicedPaise, color: 'var(--accent-primary)' },
      { label: 'Total Received', paise: totals.receivedPaise, color: 'var(--status-matched)' },
      { label: 'Outstanding Balance', paise: totals.outstandingPaise, color: 'var(--status-partial)' }
    ];

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <!-- Header Banner -->
        <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em;">Reconciliation Overview</h1>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
              Audit status for active session <span class="font-mono text-neutral-300">"${this.escapeHTML(session?.name || 'Session')}"</span>
            </p>
          </div>
          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <button id="btn-export-kpi-pdf" class="btn btn-secondary">🖨 Export KPI Report (PDF)</button>
            <button id="btn-load-demo" class="btn btn-secondary">⚡ Load Demo Reconciliation</button>
            <button id="btn-run-recon" class="btn btn-primary">▶ Run Auto-Match</button>
          </div>
        </div>

        <!-- KPI Grid -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Total Invoiced</div>
            <div class="kpi-value">${formatMoney(totals.invoicedPaise, currency)}</div>
            <div class="kpi-sub">${this.app.invoices.length} total invoices</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Total Received</div>
            <div class="kpi-value text-emerald-400" style="color: var(--status-matched);">${formatMoney(totals.receivedPaise, currency)}</div>
            <div class="kpi-sub">${this.app.payments.length} transactions</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Outstanding Balance</div>
            <div class="kpi-value" style="color: var(--status-partial);">${formatMoney(totals.outstandingPaise, currency)}</div>
            <div class="kpi-sub">${unpaidInvoices.length + partialInvoices.length} open invoices</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Reconciled Rate</div>
            <div class="kpi-value font-mono">${totals.reconciliationRate}%</div>
            <div class="kpi-sub">${matchedInvoices.length} of ${this.app.invoices.length} invoices cleared</div>
          </div>
        </div>

        <!-- Analytical Charts Row -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Reconciliation Status Distribution</span>
            </div>
            ${renderDonutChart(donutSegments, this.app.invoices.length, 'Invoices')}
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Financial Balance Comparison</span>
            </div>
            ${renderFinancialBarChart(barMetrics, currency)}
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Top Outstanding Customer Exposure</span>
            </div>
            ${renderTopCustomerExposure(topCustomers, currency)}
          </div>
        </div>

        <!-- Exception & Discrepancies Summary -->
        <div class="card">
          <div class="card-header">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="card-title">Exceptions & Discrepancies Requiring Action</span>
              <span class="badge" style="background: var(--status-unmatched-bg); color: var(--status-unmatched); font-size: 0.75rem; padding: 0.125rem 0.5rem; border-radius: 4px;">
                ${discrepancies.length} Issues
              </span>
            </div>
            <button id="btn-view-all-disc" class="btn btn-secondary btn-sm">Inspect in Workspace</button>
          </div>
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Issue Type</th>
                  <th>Record ID</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Variance</th>
                  <th>Explanation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${discrepancies.length === 0 ? `
                  <tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    ✓ No reconciliation discrepancies detected. All records are balanced.
                  </td></tr>
                ` : discrepancies.slice(0, 5).map(d => `
                  <tr>
                    <td>
                      <span class="status-indicator status-${d.severity === 'HIGH' ? 'unmatched' : 'partial'}">
                        ● ${this.escapeHTML(d.type.replace(/_/g, ' '))}
                      </span>
                    </td>
                    <td class="font-mono font-medium">${this.escapeHTML(d.recordId)}</td>
                    <td class="font-mono text-yellow">${this.escapeHTML(d.expectedValue)}</td>
                    <td class="font-mono font-medium">${this.escapeHTML(d.actualValue)}</td>
                    <td class="font-mono font-semibold" style="color: ${d.difference.startsWith('+') ? 'var(--status-matched)' : 'var(--status-unmatched)'}">
                      ${this.escapeHTML(d.difference)}
                    </td>
                    <td style="max-width: 320px; white-space: normal; font-size: 0.75rem; color: var(--text-secondary);">
                      ${this.escapeHTML(d.explanation)}
                    </td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="window.app.ui.switchView('workspace')">Investigate</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Bind Overview Buttons
    document.getElementById('btn-export-kpi-pdf')?.addEventListener('click', () => {
      this.printDashboardKPIReport();
    });

    document.getElementById('btn-load-demo')?.addEventListener('click', async () => {
      await this.app.loadDemoDataset();
    });

    document.getElementById('btn-run-recon')?.addEventListener('click', async () => {
      await this.app.runReconciliation();
    });

    document.getElementById('btn-view-all-disc')?.addEventListener('click', () => {
      this.switchView('workspace');
    });
  }

  // ==========================================
  // VIEW 2: CSV IMPORT CENTER (Interactive Drag & Drop + Live Preview)
  // ==========================================
  renderImport(container) {
    const { session } = this.app.getState();

    container.innerHTML = `
      <div style="max-width: 1000px; margin: 0 auto;">
        <div style="margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.5rem; font-weight: 700;">CSV Data Import Center</h1>
          <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
            Upload sales invoices and payment records. Deterministic state-machine parsing with delimiter auto-detection and UTF-8 BOM stripping.
          </p>
        </div>

        <!-- 2 Interactive Drag & Drop Zones -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
          <!-- Dropzone: Invoices -->
          <div id="dropzone-invoice" class="drop-zone">
            <div class="drop-zone-icon">📄</div>
            <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem;">1. Sales Invoices CSV</h3>
            <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">
              Drag & drop CSV file here or click to browse
            </p>
            <input type="file" id="input-invoice-file" accept=".csv,text/csv,text/plain" style="display: none;" />
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); document.getElementById('input-invoice-file').click()">
              Choose Invoices File
            </button>
            <button id="btn-quick-demo-inv" class="btn btn-secondary btn-sm" style="margin-left: 0.5rem;" onclick="event.stopPropagation();">
              ⚡ Load Sample
            </button>

            ${session?.invoiceFileMeta ? `
              <div style="margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.375rem; justify-content: center;">
                <span class="meta-chip active">✓ ${this.escapeHTML(session.invoiceFileMeta.fileName)}</span>
                <span class="meta-chip">${session.invoiceFileMeta.recordCount} records</span>
                <span class="meta-chip">Delim: "${session.invoiceFileMeta.delimiter || ','}"</span>
              </div>
            ` : ''}
          </div>

          <!-- Dropzone: Payments -->
          <div id="dropzone-payment" class="drop-zone">
            <div class="drop-zone-icon">💳</div>
            <h3 style="font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem;">2. Payment / Bank CSV</h3>
            <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem;">
              Drag & drop CSV file here or click to browse
            </p>
            <input type="file" id="input-payment-file" accept=".csv,text/csv,text/plain" style="display: none;" />
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); document.getElementById('input-payment-file').click()">
              Choose Payments File
            </button>
            <button id="btn-quick-demo-pay" class="btn btn-secondary btn-sm" style="margin-left: 0.5rem;" onclick="event.stopPropagation();">
              ⚡ Load Sample
            </button>

            ${session?.paymentFileMeta ? `
              <div style="margin-top: 1.25rem; display: flex; flex-wrap: wrap; gap: 0.375rem; justify-content: center;">
                <span class="meta-chip active">✓ ${this.escapeHTML(session.paymentFileMeta.fileName)}</span>
                <span class="meta-chip">${session.paymentFileMeta.recordCount} records</span>
                <span class="meta-chip">Delim: "${session.paymentFileMeta.delimiter || ','}"</span>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Live Data Inspection Grid -->
        <div class="card">
          <div class="card-header">
            <div>
              <span class="card-title">Active Dataset Inspection</span>
              <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
                Currently loaded: ${this.app.invoices.length} invoices and ${this.app.payments.length} payment records in local IndexedDB.
              </p>
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button id="btn-download-blank-templates" class="btn btn-secondary btn-sm">Download Blank CSV Templates</button>
              <button class="btn btn-primary btn-sm" onclick="window.app.ui.switchView('workspace')">Open Workspace →</button>
            </div>
          </div>

          <!-- First 5 Invoices Preview -->
          <div style="margin-bottom: 1rem;">
            <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem; text-transform: uppercase;">
              Recent Invoice Records (First 5 Rows)
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Invoice ID</th>
                    <th>Customer Name</th>
                    <th>Invoice Date</th>
                    <th>Due Date</th>
                    <th style="text-align: right;">Amount</th>
                    <th>Currency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.app.invoices.length === 0 ? `
                    <tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">
                      No invoices imported yet. Drag & drop a CSV file above or click "Load Sample".
                    </td></tr>
                  ` : this.app.invoices.slice(0, 5).map(inv => `
                    <tr>
                      <td class="font-mono font-medium">${inv.invoice_id}</td>
                      <td>${this.escapeHTML(inv.customer_name)}</td>
                      <td class="font-mono text-yellow">${inv.invoice_date}</td>
                      <td class="font-mono text-yellow">${inv.due_date}</td>
                      <td class="font-mono text-right font-medium">${formatMoney(inv.amount_paise, inv.currency)}</td>
                      <td class="font-mono">${inv.currency}</td>
                      <td><span class="status-indicator status-${inv.status === 'FULLY_PAID' ? 'matched' : (inv.status === 'PARTIALLY_PAID' ? 'partial' : 'unmatched')}">● ${inv.status}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    // Dropzone Events: Invoices
    const dropInv = document.getElementById('dropzone-invoice');
    const inputInv = document.getElementById('input-invoice-file');

    dropInv?.addEventListener('click', () => inputInv?.click());
    dropInv?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropInv.classList.add('dragover');
    });
    dropInv?.addEventListener('dragleave', () => dropInv.classList.remove('dragover'));
    dropInv?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropInv.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        const text = await file.text();
        await this.app.handleInvoiceUpload(text, file.name);
      }
    });
    inputInv?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        await this.app.handleInvoiceUpload(text, file.name);
      }
    });

    // Dropzone Events: Payments
    const dropPay = document.getElementById('dropzone-payment');
    const inputPay = document.getElementById('input-payment-file');

    dropPay?.addEventListener('click', () => inputPay?.click());
    dropPay?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropPay.classList.add('dragover');
    });
    dropPay?.addEventListener('dragleave', () => dropPay.classList.remove('dragover'));
    dropPay?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropPay.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) {
        const text = await file.text();
        await this.app.handlePaymentUpload(text, file.name);
      }
    });
    inputPay?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        const text = await file.text();
        await this.app.handlePaymentUpload(text, file.name);
      }
    });

    // Quick Sample Buttons
    document.getElementById('btn-quick-demo-inv')?.addEventListener('click', async () => {
      const resp = await fetch('/sample-data/demo-invoices.csv');
      const text = await resp.text();
      await this.app.handleInvoiceUpload(text, 'demo-invoices.csv');
    });

    document.getElementById('btn-quick-demo-pay')?.addEventListener('click', async () => {
      const resp = await fetch('/sample-data/demo-payments.csv');
      const text = await resp.text();
      await this.app.handlePaymentUpload(text, 'demo-payments.csv');
    });

    document.getElementById('btn-download-blank-templates')?.addEventListener('click', () => {
      const sampleInv = 'invoice_id,customer_name,invoice_date,due_date,total_amount,currency\nINV-001,Acme Corp,2026-10-01,2026-10-15,10000.00,INR';
      const samplePay = 'transaction_id,reference_id,payer_name,payment_date,amount,currency\nTXN-001,INV-001,Acme Corp,2026-10-05,10000.00,INR';
      const blob = new Blob([sampleInv + '\n\n' + samplePay], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'LedgerMatch_Templates.csv';
      a.click();
    });
  }

  // ==========================================
  // VIEW 3: RECONCILIATION WORKSPACE (Interactive Two-Panel)
  // ==========================================
  renderWorkspace(container) {
    const { session, suggestedMatches } = this.app.getState();
    const currency = session?.settings?.currency || 'INR';

    let openInvoices = this.app.invoices.filter(i => i.remaining_paise > 0);
    let availablePayments = this.app.payments.filter(p => !p.is_excluded && p.unallocated_paise > 0);

    // Filter by search terms
    if (this.invFilter) {
      const q = this.invFilter.toLowerCase();
      openInvoices = openInvoices.filter(i =>
        i.invoice_id.toLowerCase().includes(q) ||
        i.customer_name.toLowerCase().includes(q)
      );
    }
    if (this.payFilter) {
      const q = this.payFilter.toLowerCase();
      availablePayments = availablePayments.filter(p =>
        p.transaction_id.toLowerCase().includes(q) ||
        p.payer_name.toLowerCase().includes(q) ||
        (p.reference_id && p.reference_id.toLowerCase().includes(q))
      );
    }

    const selectedInv = openInvoices.find(i => i.invoice_id === this.selectedInvoiceId) || openInvoices[0] || null;
    const selectedPay = availablePayments.find(p => p.transaction_id === this.selectedPaymentId) || availablePayments[0] || null;

    if (selectedInv) this.selectedInvoiceId = selectedInv.invoice_id;
    if (selectedPay) this.selectedPaymentId = selectedPay.transaction_id;

    // Live comparison metrics
    let nameSim = 0;
    let daysDiff = null;
    let amountDiffPaise = 0;

    if (selectedInv && selectedPay) {
      nameSim = calculateSimilarity(selectedInv.customer_name, selectedPay.payer_name);
      daysDiff = getDaysDifference(selectedInv.invoice_date, selectedPay.payment_date);
      amountDiffPaise = selectedPay.unallocated_paise - selectedInv.remaining_paise;
    }

    // Check if there is an active suggested match for selected invoice
    const activeSuggestion = suggestedMatches.find(s => s.invoice.invoice_id === this.selectedInvoiceId);

    container.innerHTML = `
      <div style="height: 100%; display: flex; flex-direction: column;">
        <!-- Workspace Top Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <div>
            <h1 style="font-size: 1.25rem; font-weight: 700;">Reconciliation Workspace</h1>
            <p style="font-size: 0.75rem; color: var(--text-muted);">
              Select an invoice on the left and a payment on the right to compare, inspect deterministic heuristics, or allocate funds.
            </p>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button id="ws-run-auto" class="btn btn-primary btn-sm">⚡ Run Engine</button>
          </div>
        </div>

        <!-- 3-Column Workspace Grid -->
        <div class="workspace-grid">
          <!-- LEFT: Open Invoices -->
          <div class="workspace-panel">
            <div class="panel-header" style="flex-direction: column; align-items: stretch; gap: 0.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="font-semibold text-xs text-orange">OPEN INVOICES (${openInvoices.length})</span>
                <span class="font-mono text-xs text-amber font-semibold">${formatMoney(openInvoices.reduce((s, i) => s + i.remaining_paise, 0), currency, { compact: true })}</span>
              </div>
              <div class="search-wrapper">
                <span class="search-icon">🔍</span>
                <input type="text" id="ws-search-inv" class="search-input" style="width: 100%;" placeholder="Filter invoices..." value="${this.escapeHTML(this.invFilter)}" />
              </div>
            </div>

            <div class="panel-body">
              ${openInvoices.length === 0 ? '<div class="text-center py-8 text-xs text-amber">No open invoices matching filter</div>' : openInvoices.map(inv => `
                <div class="p-3 mb-2 rounded-md border cursor-pointer transition-all ${inv.invoice_id === this.selectedInvoiceId ? 'border-orange-500 bg-amber-50 dark:bg-amber-950/20' : 'border-subtle bg-surface-elevated hover:border-amber-400'}"
                     onclick="window.app.ui.selectInvoice('${inv.invoice_id}')">
                  <div class="flex justify-between items-start mb-1">
                    <span class="font-mono text-xs font-semibold text-orange">${inv.invoice_id}</span>
                    <span class="font-mono text-xs font-bold text-yellow">${formatMoney(inv.remaining_paise, inv.currency)}</span>
                  </div>
                  <div class="text-xs text-orange truncate font-medium mb-1" title="${inv.customer_name}">${inv.customer_name}</div>
                  <div class="flex justify-between text-[11px] text-amber">
                    <span>Due: ${inv.due_date || inv.invoice_date}</span>
                    <span class="status-indicator status-${inv.status === 'PARTIALLY_PAID' ? 'partial' : 'unmatched'}">● ${inv.status}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- CENTER: Match Inspector & Allocation Controls -->
          <div class="workspace-inspector">
            <div>
              <div class="text-xs font-bold uppercase tracking-wider text-yellow mb-3 border-b border-subtle pb-2 flex justify-between items-center">
                <span>Reconciliation Inspector</span>
                ${activeSuggestion ? `
                  <span class="meta-chip active" style="font-size: 10px;">★ Suggested Match Available</span>
                ` : ''}
              </div>

              ${(!selectedInv || !selectedPay) ? `
                <div class="text-center py-12 text-xs text-amber">
                  Select both an invoice and a payment to view matching heuristics and allocation tools.
                </div>
              ` : `
                <!-- Invoice Summary Card -->
                <div class="mb-3 p-2.5 rounded bg-surface-elevated border border-subtle text-xs">
                  <div class="flex justify-between text-[10px] text-amber uppercase">
                    <span>Selected Invoice</span>
                    <span>${selectedInv.invoice_date}</span>
                  </div>
                  <div class="font-mono font-bold text-orange mt-0.5 truncate">${selectedInv.invoice_id} · ${selectedInv.customer_name}</div>
                  <div class="flex justify-between text-yellow mt-1.5 pt-1.5 border-t border-subtle">
                    <span>Remaining Balance:</span>
                    <span class="font-mono font-bold text-yellow">${formatMoney(selectedInv.remaining_paise, selectedInv.currency)}</span>
                  </div>
                </div>

                <!-- Payment Summary Card -->
                <div class="mb-3 p-2.5 rounded bg-surface-elevated border border-subtle text-xs">
                  <div class="flex justify-between text-[10px] text-amber uppercase">
                    <span>Selected Payment</span>
                    <span>${selectedPay.payment_date}</span>
                  </div>
                  <div class="font-mono font-bold text-orange mt-0.5 truncate">${selectedPay.transaction_id} · ${selectedPay.payer_name}</div>
                  <div class="flex justify-between text-yellow mt-1.5 pt-1.5 border-t border-subtle">
                    <span>Unallocated Balance:</span>
                    <span class="font-mono font-bold text-orange">${formatMoney(selectedPay.unallocated_paise, selectedPay.currency)}</span>
                  </div>
                </div>

                <!-- Delta Gauges -->
                <div class="mb-3 p-3 rounded bg-surface-elevated border border-subtle text-xs space-y-2">
                  <div class="flex justify-between items-center">
                    <span class="text-yellow">Amount Variance:</span>
                    <span class="font-mono font-bold ${amountDiffPaise === 0 ? 'text-emerald-600' : 'text-orange'}">
                      ${amountDiffPaise === 0 ? 'Exact Match (₹0)' : formatMoney(amountDiffPaise, selectedInv.currency, { showSign: true })}
                    </span>
                  </div>
                  <div class="flex justify-between items-center">
                    <span class="text-yellow">Date Variance:</span>
                    <span class="font-mono font-medium text-orange">
                      ${daysDiff === null ? 'N/A' : (daysDiff === 0 ? 'Same Day' : `${Math.abs(daysDiff)} days ${daysDiff > 0 ? 'after' : 'before'}`)}
                    </span>
                  </div>
                  <div>
                    <div class="flex justify-between items-center">
                      <span class="text-yellow">Entity Similarity:</span>
                      <span class="font-mono font-bold ${nameSim >= 0.8 ? 'text-emerald-600' : (nameSim >= 0.6 ? 'text-yellow' : 'text-orange')}">
                        ${Math.round(nameSim * 100)}%
                      </span>
                    </div>
                    <div class="similarity-bar-wrap">
                      <div class="similarity-bar-fill" style="width: ${Math.round(nameSim * 100)}%; background-color: ${nameSim >= 0.8 ? 'var(--status-matched)' : (nameSim >= 0.6 ? 'var(--status-partial)' : 'var(--text-muted)')};"></div>
                    </div>
                  </div>
                </div>

                <!-- Suggested Match Reasons if Present -->
                ${activeSuggestion ? `
                  <div class="mb-3 p-2.5 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800">
                    <div class="text-[11px] font-semibold text-orange mb-1">
                      Matched by ${activeSuggestion.levelName} (${activeSuggestion.confidence} Confidence)
                    </div>
                    <div class="space-y-1">
                      ${activeSuggestion.reasons.map(r => `<div class="reason-item text-yellow">${this.escapeHTML(r)}</div>`).join('')}
                    </div>
                  </div>
                ` : ''}

                <!-- Allocation Amount Input -->
                <div class="mb-3">
                  <label class="text-[11px] font-semibold text-orange block mb-1">Allocation Tranche (₹):</label>
                  <input type="number" id="input-alloc-amount" class="search-input w-full text-xs font-mono"
                         value="${(Math.min(selectedInv.remaining_paise, selectedPay.unallocated_paise) / 100).toFixed(2)}"
                         max="${(selectedPay.unallocated_paise / 100).toFixed(2)}" min="0.01" step="0.01" />
                  <span class="text-[10px] text-amber mt-1 block">Maximum capacity: ${formatMoney(selectedPay.unallocated_paise, selectedPay.currency)}</span>
                </div>
              `}
            </div>

            <!-- Action Buttons -->
            ${(selectedInv && selectedPay) ? `
              <div class="space-y-2 pt-3 border-t border-subtle">
                <button id="btn-confirm-alloc" class="btn btn-primary w-full text-xs py-2">
                  ✓ Confirm Allocation
                </button>
              </div>
            ` : ''}
          </div>

          <!-- RIGHT: Available Payments -->
          <div class="workspace-panel">
            <div class="panel-header" style="flex-direction: column; align-items: stretch; gap: 0.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="font-semibold text-xs text-orange">AVAILABLE PAYMENTS (${availablePayments.length})</span>
                <span class="font-mono text-xs text-orange font-semibold">${formatMoney(availablePayments.reduce((s, p) => s + p.unallocated_paise, 0), currency, { compact: true })}</span>
              </div>
              <div class="search-wrapper">
                <span class="search-icon">🔍</span>
                <input type="text" id="ws-search-pay" class="search-input" style="width: 100%;" placeholder="Filter payments..." value="${this.escapeHTML(this.payFilter)}" />
              </div>
            </div>

            <div class="panel-body">
              ${availablePayments.length === 0 ? '<div class="text-center py-8 text-xs text-amber">No unallocated payments matching filter</div>' : availablePayments.map(pay => `
                <div class="p-3 mb-2 rounded-md border cursor-pointer transition-all ${pay.transaction_id === this.selectedPaymentId ? 'border-orange-500 bg-amber-50 dark:bg-amber-950/20' : 'border-subtle bg-surface-elevated hover:border-amber-400'}"
                     onclick="window.app.ui.selectPayment('${pay.transaction_id}')">
                  <div class="flex justify-between items-start mb-1">
                    <span class="font-mono text-xs font-semibold text-orange">${pay.transaction_id}</span>
                    <span class="font-mono text-xs font-bold text-yellow">${formatMoney(pay.unallocated_paise, pay.currency)}</span>
                  </div>
                  <div class="text-xs text-orange truncate font-medium mb-1" title="${pay.payer_name}">${pay.payer_name}</div>
                  <div class="flex justify-between text-[11px] text-amber">
                    <span>Date: ${pay.payment_date}</span>
                    <span class="font-mono text-yellow">${pay.reference_id ? 'Ref: ' + pay.reference_id : 'No Ref'}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind Workspace Search
    const searchInvEl = document.getElementById('ws-search-inv');
    searchInvEl?.addEventListener('input', (e) => {
      this.invFilter = e.target.value;
      this.renderWorkspace(container);
    });

    const searchPayEl = document.getElementById('ws-search-pay');
    searchPayEl?.addEventListener('input', (e) => {
      this.payFilter = e.target.value;
      this.renderWorkspace(container);
    });

    // Bind Workspace Actions
    document.getElementById('ws-run-auto')?.addEventListener('click', async () => {
      await this.app.runReconciliation();
    });

    document.getElementById('btn-confirm-alloc')?.addEventListener('click', async () => {
      if (!selectedInv || !selectedPay) return;
      const inputEl = document.getElementById('input-alloc-amount');
      const amtMajor = parseFloat(inputEl?.value || '0');
      if (isNaN(amtMajor) || amtMajor <= 0) {
        this.showToast('Please specify a valid allocation amount greater than zero', 'error');
        return;
      }
      const amtPaise = Math.round(amtMajor * 100);
      await this.app.allocatePayment(selectedInv, selectedPay, amtPaise);
    });
  }

  selectInvoice(invId) {
    this.selectedInvoiceId = invId;
    this.renderWorkspace(document.getElementById('view-container'));
  }

  selectPayment(payId) {
    this.selectedPaymentId = payId;
    this.renderWorkspace(document.getElementById('view-container'));
  }

  // ==========================================
  // VIEW 4: MATCHED TRANSACTIONS
  // ==========================================
  renderMatched(container) {
    let matched = this.app.invoices.filter(i => i.status === 'FULLY_PAID');

    if (this.tableFilter) {
      const q = this.tableFilter.toLowerCase();
      matched = matched.filter(i =>
        i.invoice_id.toLowerCase().includes(q) ||
        i.customer_name.toLowerCase().includes(q)
      );
    }

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700;">Matched Transactions</h1>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
              Sales invoices fully reconciled and settled against verified payments (${matched.length} records)
            </p>
          </div>
          <div style="display: flex; gap: 0.75rem;">
            <div class="search-wrapper">
              <span class="search-icon">🔍</span>
              <input type="text" id="filter-matched-input" class="search-input" placeholder="Search matched records..." value="${this.escapeHTML(this.tableFilter)}" />
            </div>
            <button id="btn-export-matched" class="btn btn-secondary btn-sm">Export Matched (CSV)</button>
          </div>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Customer Name</th>
                <th>Invoice Date</th>
                <th>Due Date</th>
                <th style="text-align: right;">Total Amount</th>
                <th style="text-align: right;">Allocated Payment</th>
                <th>Reconciliation Status</th>
              </tr>
            </thead>
            <tbody>
              ${matched.length === 0 ? `
                <tr><td colspan="7" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                  No fully matched transactions found matching criteria.
                </td></tr>
              ` : matched.map(inv => `
                <tr>
                  <td class="font-mono font-medium">${inv.invoice_id}</td>
                  <td>${this.escapeHTML(inv.customer_name)}</td>
                  <td class="font-mono text-yellow">${inv.invoice_date}</td>
                  <td class="font-mono text-yellow">${inv.due_date}</td>
                  <td class="font-mono text-right font-medium">${formatMoney(inv.amount_paise, inv.currency)}</td>
                  <td class="font-mono text-right font-bold text-emerald-400">${formatMoney(inv.allocated_paise, inv.currency)}</td>
                  <td><span class="status-indicator status-matched">● FULLY MATCHED</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('filter-matched-input')?.addEventListener('input', (e) => {
      this.tableFilter = e.target.value;
      this.renderMatched(container);
    });

    document.getElementById('btn-export-matched')?.addEventListener('click', () => {
      exportMatchedInvoicesCSV(matched);
      this.showToast('Exported matched transactions to CSV', 'success');
    });
  }

  // ==========================================
  // VIEW 5: PARTIAL PAYMENTS
  // ==========================================
  renderPartials(container) {
    const partials = this.app.invoices.filter(i => i.status === 'PARTIALLY_PAID');

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700;">Partial Payments</h1>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
              Invoices with partial remittances applied and open residual balances (${partials.length} records)
            </p>
          </div>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Customer Name</th>
                <th style="text-align: right;">Total Invoiced</th>
                <th style="text-align: right;">Total Received</th>
                <th style="text-align: right;">Remaining Balance</th>
                <th>Settlement %</th>
                <th>Due Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${partials.length === 0 ? `
                <tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                  No partially paid invoices found.
                </td></tr>
              ` : partials.map(inv => {
                const pct = Math.round((inv.allocated_paise / inv.amount_paise) * 100);
                return `
                  <tr>
                    <td class="font-mono font-medium">${inv.invoice_id}</td>
                    <td>${this.escapeHTML(inv.customer_name)}</td>
                    <td class="font-mono text-right font-medium">${formatMoney(inv.amount_paise, inv.currency)}</td>
                    <td class="font-mono text-right font-bold text-emerald-400">${formatMoney(inv.allocated_paise, inv.currency)}</td>
                    <td class="font-mono text-right font-bold text-amber-400">${formatMoney(inv.remaining_paise, inv.currency)}</td>
                    <td class="font-mono font-medium">${pct}%</td>
                    <td class="font-mono text-yellow">${inv.due_date}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="window.app.ui.selectInvoice('${inv.invoice_id}'); window.app.ui.switchView('workspace');">
                        Add Tranche
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================
  // VIEW 6: UNMATCHED INVOICES
  // ==========================================
  renderUnmatchedInvoices(container) {
    const openInvs = this.app.invoices.filter(i => i.remaining_paise > 0);
    const today = new Date().toISOString().slice(0, 10);

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700;">Unmatched Invoices</h1>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
              Outstanding customer invoices awaiting full settlement (${openInvs.length} records)
            </p>
          </div>
          <button id="btn-export-unmatched-inv" class="btn btn-secondary btn-sm">Export Unmatched Invoices (CSV)</button>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Customer Name</th>
                <th>Invoice Date</th>
                <th>Due Date</th>
                <th>Aging Status</th>
                <th style="text-align: right;">Total Amount</th>
                <th style="text-align: right;">Outstanding</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${openInvs.length === 0 ? `
                <tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                  All sales invoices are fully paid.
                </td></tr>
              ` : openInvs.map(inv => {
                const daysOver = inv.due_date ? getDaysDifference(inv.due_date, today) : 0;
                const isOverdue = daysOver !== null && daysOver > 0;
                return `
                  <tr>
                    <td class="font-mono font-medium">${inv.invoice_id}</td>
                    <td>${this.escapeHTML(inv.customer_name)}</td>
                    <td class="font-mono text-yellow">${inv.invoice_date}</td>
                    <td class="font-mono text-yellow">${inv.due_date}</td>
                    <td>
                      <span class="status-indicator status-${isOverdue ? 'unmatched' : 'info'}">
                        ● ${isOverdue ? `${daysOver}d Overdue` : 'Within Terms'}
                      </span>
                    </td>
                    <td class="font-mono text-right font-medium">${formatMoney(inv.amount_paise, inv.currency)}</td>
                    <td class="font-mono text-right font-bold text-amber-400">${formatMoney(inv.remaining_paise, inv.currency)}</td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="window.app.ui.selectInvoice('${inv.invoice_id}'); window.app.ui.switchView('workspace');">
                        Reconcile
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-export-unmatched-inv')?.addEventListener('click', () => {
      exportUnmatchedInvoicesCSV(openInvs);
      this.showToast('Exported unmatched invoices to CSV', 'success');
    });
  }

  // ==========================================
  // VIEW 7: UNMATCHED PAYMENTS
  // ==========================================
  renderUnmatchedPayments(container) {
    const unallocated = this.app.payments.filter(p => !p.is_excluded && p.unallocated_paise > 0);

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700;">Unmatched Payments</h1>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
              Bank receipts and remittances with unallocated balances (${unallocated.length} records)
            </p>
          </div>
          <button id="btn-export-unmatched-pay" class="btn btn-secondary btn-sm">Export Unmatched Payments (CSV)</button>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Transaction ID</th>
                <th>Reference ID</th>
                <th>Payer Name</th>
                <th>Payment Date</th>
                <th>Channel</th>
                <th style="text-align: right;">Payment Amount</th>
                <th style="text-align: right;">Unallocated Balance</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${unallocated.length === 0 ? `
                <tr><td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                  All payment transactions have been fully matched and applied.
                </td></tr>
              ` : unallocated.map(pay => `
                <tr>
                  <td class="font-mono font-medium">${pay.transaction_id}</td>
                  <td class="font-mono text-yellow">${this.escapeHTML(pay.reference_id || 'None')}</td>
                  <td>${this.escapeHTML(pay.payer_name)}</td>
                  <td class="font-mono text-yellow">${pay.payment_date}</td>
                  <td class="text-xs text-yellow">${this.escapeHTML(pay.payment_method || 'Transfer')}</td>
                  <td class="font-mono text-right font-medium">${formatMoney(pay.amount_paise, pay.currency)}</td>
                  <td class="font-mono text-right font-bold text-emerald-400">${formatMoney(pay.unallocated_paise, pay.currency)}</td>
                  <td>
                    <button class="btn btn-secondary btn-sm" onclick="window.app.ui.selectPayment('${pay.transaction_id}'); window.app.ui.switchView('workspace');">
                      Allocate
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('btn-export-unmatched-pay')?.addEventListener('click', () => {
      exportUnmatchedPaymentsCSV(unallocated);
      this.showToast('Exported unmatched payments to CSV', 'success');
    });
  }

  // ==========================================
  // VIEW 8: DUPLICATE DETECTION
  // ==========================================
  renderDuplicates(container) {
    const { duplicateResults } = this.app.getState();
    const groups = duplicateResults?.groups || [];

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700;">Duplicate Detection</h1>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
              Automated detection of repeated transaction IDs, repeated invoices, and identical payment attributes.
            </p>
          </div>
        </div>

        ${groups.length === 0 ? `
          <div class="card" style="text-align: center; padding: 3rem;">
            <p style="color: var(--status-matched); font-weight: 600;">✓ No duplicate transactions or invoices detected.</p>
          </div>
        ` : groups.map(group => `
          <div class="card" style="border-left: 3px solid var(--status-unmatched);">
            <div class="card-header">
              <div>
                <span class="status-indicator status-unmatched font-bold">● ${group.severity}</span>
                <p class="text-xs text-yellow mt-1">${this.escapeHTML(group.reason)}</p>
              </div>
            </div>
            <div class="table-container">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Record ID</th>
                    <th>Entity</th>
                    <th>Date</th>
                    <th style="text-align: right;">Amount</th>
                    <th>Status</th>
                    <th>Audit Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.items.map(item => `
                    <tr>
                      <td class="font-mono font-medium">${item.transaction_id || item.invoice_id}</td>
                      <td>${this.escapeHTML(item.payer_name || item.customer_name)}</td>
                      <td class="font-mono text-yellow">${item.payment_date || item.invoice_date}</td>
                      <td class="font-mono text-right font-medium">${formatMoney(item.amount_paise, item.currency)}</td>
                      <td>
                        <span class="status-indicator status-${item.is_excluded ? 'unmatched' : 'info'}">
                          ● ${item.is_excluded ? 'EXCLUDED FROM RECON' : 'ACTIVE IN DATASET'}
                        </span>
                      </td>
                      <td>
                        ${item.is_excluded ? `
                          <button class="btn btn-secondary btn-sm" onclick="window.app.restoreExcludedRecord('${item.id}')">Restore Record</button>
                        ` : `
                          <button class="btn btn-danger btn-sm" onclick="window.app.excludeDuplicateRecord('${item.id}')">Exclude Duplicate</button>
                        `}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ==========================================
  // VIEW 9: MANUAL REVIEW QUEUE
  // ==========================================
  renderReview(container) {
    const { manualReviewQueue } = this.app.getState();

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.5rem; font-weight: 700;">Manual Review Queue</h1>
          <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
            Transactions with ambiguous matches, multiple candidate invoices, or unknown references requiring auditor inspection.
          </p>
        </div>

        ${manualReviewQueue.length === 0 ? `
          <div class="card" style="text-align: center; padding: 3rem;">
            <p style="color: var(--status-matched); font-weight: 600;">✓ Manual review queue is clear. No ambiguous transactions pending.</p>
          </div>
        ` : `
          <div class="table-container">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Payer Name</th>
                  <th>Reference</th>
                  <th>Payment Date</th>
                  <th style="text-align: right;">Amount</th>
                  <th>Ambiguity / Flag Reason</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${manualReviewQueue.map(item => `
                  <tr>
                    <td class="font-mono font-medium">${item.payment.transaction_id}</td>
                    <td>${this.escapeHTML(item.payment.payer_name)}</td>
                    <td class="font-mono text-yellow">${this.escapeHTML(item.payment.reference_id || 'None')}</td>
                    <td class="font-mono text-yellow">${item.payment.payment_date}</td>
                    <td class="font-mono text-right font-medium">${formatMoney(item.payment.amount_paise, item.payment.currency)}</td>
                    <td style="font-size: 0.75rem; color: var(--status-partial); max-width: 320px; white-space: normal;">
                      ${this.escapeHTML(item.reason)}
                    </td>
                    <td>
                      <button class="btn btn-secondary btn-sm" onclick="window.app.ui.selectPayment('${item.payment.transaction_id}'); window.app.ui.switchView('workspace');">
                        Resolve in Workspace
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;
  }

  // ==========================================
  // VIEW 10: REPORTS
  // ==========================================
  renderReports(container) {
    const { session, totals, discrepancies } = this.app.getState();
    const currency = session?.settings?.currency || 'INR';

    const matched = this.app.invoices.filter(i => i.status === 'FULLY_PAID');
    const partials = this.app.invoices.filter(i => i.status === 'PARTIALLY_PAID');
    const unmatchedInvoices = this.app.invoices.filter(i => i.remaining_paise > 0);
    const unmatchedPayments = this.app.payments.filter(p => !p.is_excluded && p.unallocated_paise > 0);

    const reportHTML = generatePrintableReportHTML({
      session,
      companyName: 'Corporate Accounts Department',
      currency,
      totals,
      matched,
      partials,
      unmatchedInvoices,
      unmatchedPayments,
      discrepancies
    });

    container.innerHTML = `
      <div style="max-width: 1000px; margin: 0 auto;">
        <div class="no-print" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
          <div>
            <h1 style="font-size: 1.5rem; font-weight: 700;">Reconciliation Statement & Reports</h1>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
              Official accounting certification statement. Format is ready for PDF export or printing.
            </p>
          </div>
          <div style="display: flex; gap: 0.75rem;">
            <button id="btn-print-kpi-report" class="btn btn-secondary btn-sm">🖨 Print Executive KPI Summary</button>
            <button id="btn-print-report" class="btn btn-primary btn-sm">🖨 Print Full Statement</button>
          </div>
        </div>

        <div class="card" style="padding: 0; overflow: hidden; background: #ffffff;">
          ${reportHTML}
        </div>
      </div>
    `;

    document.getElementById('btn-print-kpi-report')?.addEventListener('click', () => {
      this.printDashboardKPIReport();
    });

    document.getElementById('btn-print-report')?.addEventListener('click', () => {
      window.print();
    });
  }

  // ==========================================
  // VIEW 11: AUDIT HISTORY
  // ==========================================
  renderHistory(container) {
    const { auditLogs } = this.app.getState();

    container.innerHTML = `
      <div style="max-width: 1400px; margin: 0 auto;">
        <div style="margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.5rem; font-weight: 700;">Reconciliation Audit History</h1>
          <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
            Immutable chronological audit log of all reconciliation runs, manual matches, and exclusion decisions.
          </p>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Description</th>
                <th>Related Record IDs</th>
              </tr>
            </thead>
            <tbody>
              ${auditLogs.length === 0 ? `
                <tr><td colspan="4" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                  No audit events recorded for this session yet.
                </td></tr>
              ` : auditLogs.map(evt => {
                const dateStr = new Date(evt.timestamp).toLocaleString();
                return `
                  <tr>
                    <td class="font-mono text-xs text-yellow">${dateStr}</td>
                    <td>
                      <span class="status-indicator status-info font-mono text-xs">● ${evt.type}</span>
                    </td>
                    <td style="max-width: 480px; white-space: normal; font-size: 0.8125rem;">
                      ${this.escapeHTML(evt.description)}
                    </td>
                    <td class="font-mono text-xs text-yellow">
                      ${(evt.recordIds || []).slice(0, 3).join(', ')} ${(evt.recordIds || []).length > 3 ? '...' : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==========================================
  // VIEW 12: SETTINGS & DIAGNOSTICS
  // ==========================================
  renderSettings(container) {
    const { session } = this.app.getState();

    container.innerHTML = `
      <div style="max-width: 800px; margin: 0 auto;">
        <div style="margin-bottom: 1.5rem;">
          <h1 style="font-size: 1.5rem; font-weight: 700;">Settings & Diagnostics</h1>
          <p style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.25rem;">
            Configure reconciliation parameters, backup session data, or run automated test diagnostics.
          </p>
        </div>

        <!-- Matching Rules Settings -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Matching Engine Rules</span>
          </div>
          <div style="space-y: 1.25rem;">
            <div style="margin-bottom: 1rem;">
              <label style="font-size: 0.8125rem; font-weight: 600; display: block; margin-bottom: 0.375rem;">
                Date Tolerance Window (Days): <span id="val-tolerance" class="font-mono text-indigo-400">${session?.settings?.dateToleranceDays || 30} days</span>
              </label>
              <input type="range" id="input-tolerance" min="1" max="90" value="${session?.settings?.dateToleranceDays || 30}" style="width: 100%;" />
              <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;">
                Maximum allowed calendar days between invoice date and payment date for Level 3 matches.
              </p>
            </div>

            <div style="margin-bottom: 1rem;">
              <label style="font-size: 0.8125rem; font-weight: 600; display: block; margin-bottom: 0.375rem;">
                Default Currency:
              </label>
              <select id="select-currency" class="btn btn-secondary text-xs" style="padding: 0.375rem 0.75rem;">
                <option value="INR" ${session?.settings?.currency === 'INR' ? 'selected' : ''}>INR (Indian Rupee - ₹)</option>
                <option value="USD" ${session?.settings?.currency === 'USD' ? 'selected' : ''}>USD (US Dollar - $)</option>
                <option value="EUR" ${session?.settings?.currency === 'EUR' ? 'selected' : ''}>EUR (Euro - €)</option>
              </select>
            </div>
            <button id="btn-save-settings" class="btn btn-primary btn-sm">Save Parameters</button>
          </div>
        </div>

        <!-- Backup & Restore -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Local Session Backup & Restore</span>
          </div>
          <p style="font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 1rem;">
            Export a complete JSON snapshot of this session including all invoices, payments, allocations, and audit history.
          </p>
          <div style="display: flex; gap: 0.75rem;">
            <button id="btn-backup-session" class="btn btn-secondary btn-sm">Export Session Backup (JSON)</button>
            <input type="file" id="input-restore-backup" accept=".json" style="display: none;" />
            <button class="btn btn-secondary btn-sm" onclick="document.getElementById('input-restore-backup').click()">Restore Session from JSON</button>
          </div>
        </div>

        <!-- Core Test Runner -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">Automated Engine Diagnostics</span>
          </div>
          <p style="font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 1rem;">
            Execute all unit and integration tests (CSV parser, paise precision, Levenshtein distance, formula injection protection).
          </p>
          <button id="btn-run-tests" class="btn btn-secondary btn-sm">▶ Execute Core Test Suite</button>
          <div id="test-output-box" style="margin-top: 1rem; display: none;"></div>
        </div>
      </div>
    `;

    // Tolerance slider live update
    const tolSlider = document.getElementById('input-tolerance');
    const tolVal = document.getElementById('val-tolerance');
    tolSlider?.addEventListener('input', () => {
      if (tolVal) tolVal.textContent = `${tolSlider.value} days`;
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
      const days = parseInt(tolSlider?.value || '30', 10);
      const curr = document.getElementById('select-currency')?.value || 'INR';
      if (session) {
        session.settings = session.settings || {};
        session.settings.dateToleranceDays = days;
        session.settings.currency = curr;
        await this.app.saveSessionSettings(session);
        this.showToast('Reconciliation parameters updated', 'success');
      }
    });

    // Backup & Restore
    document.getElementById('btn-backup-session')?.addEventListener('click', async () => {
      if (!session) return;
      const backup = await exportSessionBackup(session.id);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LedgerMatch_Backup_${session.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
      a.click();
      this.showToast('Session backup downloaded', 'success');
    });

    const restoreInput = document.getElementById('input-restore-backup');
    restoreInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          const text = await file.text();
          const json = JSON.parse(text);
          await restoreSessionBackup(json);
          this.showToast('Session restored successfully', 'success');
          await this.app.loadSession(this.app.activeSession.id);
        } catch (err) {
          this.showToast('Failed to restore backup: ' + err.message, 'error');
        }
      }
    });

    // Run tests
    document.getElementById('btn-run-tests')?.addEventListener('click', () => {
      const box = document.getElementById('test-output-box');
      if (!box) return;
      const testRes = runAllTests();
      box.style.display = 'block';
      box.innerHTML = `
        <div style="background: var(--bg-surface-elevated); padding: 1rem; border-radius: var(--radius-md); font-size: 0.75rem;">
          <div style="font-weight: bold; margin-bottom: 0.5rem; color: ${testRes.failed === 0 ? 'var(--status-matched)' : 'var(--status-unmatched)'}">
            Test Results: ${testRes.passed} Passed / ${testRes.failed} Failed (Total ${testRes.total})
          </div>
          <div style="max-height: 200px; overflow-y: auto; font-family: var(--font-mono); font-size: 0.6875rem;">
            ${testRes.results.map(r => `
              <div style="color: ${r.success ? 'var(--status-matched)' : 'var(--status-unmatched)'}; padding: 0.125rem 0;">
                ${r.success ? '✓' : '✗'} ${r.name} — ${r.message}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });
  }

  // ==========================================
  // MODALS
  // ==========================================
  openSessionModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const sessions = this.app.sessions || [];

    backdrop.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <span style="font-weight: 700; font-size: 1rem;">Reconciliation Sessions</span>
          <button id="modal-close-btn" class="btn btn-secondary btn-sm">✕</button>
        </div>
        <div class="modal-body">
          <div style="margin-bottom: 1.5rem; display: flex; gap: 0.5rem;">
            <input type="text" id="new-session-name" placeholder="New Session Name (e.g. FY26 Q3)" class="w-full bg-neutral-900 border border-neutral-700 rounded px-3 py-1.5 text-xs text-white" />
            <button id="btn-create-session" class="btn btn-primary btn-sm">Create</button>
          </div>
          <div style="font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); margin-bottom: 0.5rem;">
            Existing Sessions
          </div>
          <div style="max-height: 240px; overflow-y: auto;">
            ${sessions.map(s => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.625rem; border-radius: 4px; margin-bottom: 0.375rem; background: ${s.id === this.app.activeSession?.id ? 'var(--bg-surface-hover)' : 'transparent'}; border: 1px solid var(--border-subtle);">
                <div>
                  <div style="font-weight: 600; font-size: 0.8125rem; color: var(--text-primary);">${this.escapeHTML(s.name)}</div>
                  <div style="font-size: 0.6875rem; color: var(--text-muted);">Created: ${new Date(s.createdAt).toLocaleDateString()}</div>
                </div>
                <div style="display: flex; gap: 0.375rem;">
                  <button class="btn btn-secondary btn-sm" onclick="window.app.switchActiveSession('${s.id}')">Open</button>
                  ${s.id !== this.app.activeSession?.id ? `
                    <button class="btn btn-danger btn-sm" onclick="window.app.removeSession('${s.id}')">Delete</button>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.querySelector('#modal-close-btn')?.addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#btn-create-session')?.addEventListener('click', async () => {
      const name = backdrop.querySelector('#new-session-name')?.value;
      if (name) {
        await this.app.createNewSession(name);
        backdrop.remove();
      }
    });
  }

  openMappingWizardModal(type, headers, initialMapping, sampleRows, onConfirm) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const schema = type === 'invoice' ? [
      { key: 'invoice_id', label: 'Invoice ID *', required: true },
      { key: 'customer_name', label: 'Customer Name *', required: true },
      { key: 'invoice_date', label: 'Invoice Date *', required: true },
      { key: 'due_date', label: 'Due Date', required: false },
      { key: 'total_amount', label: 'Invoice Amount *', required: true },
      { key: 'currency', label: 'Currency', required: false }
    ] : [
      { key: 'transaction_id', label: 'Transaction ID *', required: true },
      { key: 'reference_id', label: 'Reference / Invoice ID', required: false },
      { key: 'payer_name', label: 'Payer Name *', required: true },
      { key: 'payment_date', label: 'Payment Date *', required: true },
      { key: 'amount', label: 'Payment Amount *', required: true },
      { key: 'currency', label: 'Currency', required: false }
    ];

    backdrop.innerHTML = `
      <div class="modal-dialog" style="max-width: 680px;">
        <div class="modal-header">
          <div>
            <span style="font-weight: 700; font-size: 1rem;">Column Mapping Wizard: ${type.toUpperCase()}</span>
            <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.125rem;">
              Align your CSV headers to canonical LedgerMatch fields.
            </p>
          </div>
          <button id="map-close-btn" class="btn btn-secondary btn-sm">✕</button>
        </div>
        <div class="modal-body">
          <!-- Mapping selectors -->
          <div style="space-y: 0.75rem; margin-bottom: 1.5rem;">
            ${schema.map(field => `
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.625rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border-subtle);">
                <div>
                  <label style="font-size: 0.8125rem; font-weight: 600; color: var(--text-primary);">${field.label}</label>
                  <span style="font-size: 0.6875rem; color: var(--text-muted); display: block;">${field.required ? 'Mandatory for matching' : 'Optional reference'}</span>
                </div>
                <select id="map-sel-${field.key}" class="btn btn-secondary text-xs" style="width: 240px; padding: 0.375rem 0.5rem;">
                  <option value="">-- Do Not Map --</option>
                  ${headers.map(h => `
                    <option value="${h}" ${initialMapping[field.key] === h ? 'selected' : ''}>${h}</option>
                  `).join('')}
                </select>
              </div>
            `).join('')}
          </div>

          <!-- Sample Rows Preview Table -->
          <div>
            <div style="font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.375rem; text-transform: uppercase;">
              Raw File Sample Preview (First 3 Rows)
            </div>
            <div class="table-container" style="max-height: 140px;">
              <table class="data-table" style="font-size: 0.75rem;">
                <thead>
                  <tr>
                    ${headers.slice(0, 5).map(h => `<th>${h}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${sampleRows.slice(0, 3).map(row => `
                    <tr>
                      ${headers.slice(0, 5).map(h => `<td>${this.escapeHTML(row[h] || '')}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="map-cancel-btn" class="btn btn-secondary btn-sm">Cancel</button>
          <button id="map-confirm-btn" class="btn btn-primary btn-sm">Confirm & Import</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    backdrop.querySelector('#map-close-btn')?.addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#map-cancel-btn')?.addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#map-confirm-btn')?.addEventListener('click', () => {
      const chosenMapping = {};
      schema.forEach(f => {
        const sel = backdrop.querySelector(`#map-sel-${f.key}`);
        chosenMapping[f.key] = sel?.value || '';
      });
      backdrop.remove();
      onConfirm(chosenMapping);
    });
  }

  /**
   * Generates and triggers the native browser print/PDF export dialog for the
   * Dashboard KPI Summary. Uses an isolated print host container styled for A4 portrait.
   */
  printDashboardKPIReport() {
    const { totals, session, discrepancies } = this.app.getState();
    const currency = session?.settings?.currency || 'INR';

    const matchedInvoices = this.app.invoices.filter(i => i.status === 'FULLY_PAID');
    const partialInvoices = this.app.invoices.filter(i => i.status === 'PARTIALLY_PAID');
    const unpaidInvoices = this.app.invoices.filter(i => i.status === 'UNPAID');
    const unmatchedPayments = this.app.payments.filter(p => !p.is_excluded && p.unallocated_paise > 0);
    const duplicates = this.app.duplicates || [];

    // Calculate customer outstanding exposures
    const customerBalMap = new Map();
    for (const inv of this.app.invoices) {
      if (inv.remaining_paise > 0) {
        const cur = customerBalMap.get(inv.customer_name) || 0;
        customerBalMap.set(inv.customer_name, cur + inv.remaining_paise);
      }
    }
    const topCustomers = Array.from(customerBalMap.entries())
      .map(([name, outstandingPaise]) => ({ name, outstandingPaise }))
      .sort((a, b) => b.outstandingPaise - a.outstandingPaise);

    const reportHTML = generatePrintableKPIReportHTML({
      session,
      companyName: session?.name || 'Executive Accounts & Treasury',
      currency,
      totals,
      matchedCount: matchedInvoices.length,
      partialCount: partialInvoices.length,
      unpaidCount: unpaidInvoices.length,
      unmatchedPayCount: unmatchedPayments.length,
      duplicateCount: duplicates.length,
      topCustomers,
      discrepancies
    });

    let printContainer = document.getElementById('print-host-container');
    if (!printContainer) {
      printContainer = document.createElement('div');
      printContainer.id = 'print-host-container';
      document.body.appendChild(printContainer);
    }
    printContainer.innerHTML = reportHTML;

    this.showToast('Opening PDF print dialog... Select "Save as PDF" to export.', 'info');

    // Trigger browser print dialog
    window.print();

    // Clean up container after print dialog finishes or cancels
    const cleanup = () => {
      if (printContainer) printContainer.innerHTML = '';
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    // Safety fallback
    setTimeout(cleanup, 4000);
  }
}
