/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Main Application Bootstrap
 * Coordinates local IndexedDB state, reconciliation workflows, demo datasets,
 * and attaches global controllers for browser interaction.
 */

import { UIEngine } from './ui.js';
import {
  getSessions,
  getSession,
  createSession,
  deleteSession,
  setActiveSessionId,
  getActiveSessionId,
  getInvoices,
  getPayments,
  getAllocations,
  saveAllocation,
  savePayments,
  saveInvoices,
  updateSession
} from './data-store.js';
import { importInvoiceCSV, importPaymentCSV } from './import-manager.js';
import { executeReconciliation } from './reconciliation.js';
import { recalculateAllBalances, createAllocationRecord, validateAllocation } from './allocation-engine.js';
import { detectDuplicates } from './duplicate-detector.js';
import { auditDiscrepancies } from './discrepancy-engine.js';
import { logAudit, getSessionAuditLogs, AUDIT_EVENT_TYPE } from './audit-log.js';
import { calculatePercentage } from './money-utils.js';

export class LedgerMatchApp {
  constructor() {
    this.ui = new UIEngine(this);
    this.sessions = [];
    this.activeSession = null;
    this.invoices = [];
    this.payments = [];
    this.allocations = [];
    this.suggestedMatches = [];
    this.manualReviewQueue = [];
    this.duplicateResults = { duplicateInvoices: [], duplicatePayments: [], groups: [] };
    this.discrepancies = [];
    this.auditLogs = [];
  }

  async boot() {
    this.ui.init();
    await this.refreshSessions();

    const activeId = await getActiveSessionId();
    if (activeId && this.sessions.some(s => s.id === activeId)) {
      await this.loadSession(activeId);
    } else if (this.sessions.length > 0) {
      await this.loadSession(this.sessions[0].id);
    } else {
      // First boot: Automatically load the rich demo reconciliation dataset
      await this.loadDemoDataset();
    }
  }

  async refreshSessions() {
    this.sessions = await getSessions();
  }

  async createNewSession(name) {
    const session = await createSession(name, {
      currency: 'INR',
      dateToleranceDays: 30
    });
    await this.refreshSessions();
    await this.loadSession(session.id);
    this.ui.showToast(`Session "${session.name}" created`, 'success');
  }

  async switchActiveSession(sessionId) {
    await setActiveSessionId(sessionId);
    await this.loadSession(sessionId);
    const sessionModal = document.querySelector('.modal-backdrop');
    if (sessionModal) sessionModal.remove();
    this.ui.showToast(`Switched to session "${this.activeSession.name}"`, 'info');
  }

  async removeSession(sessionId) {
    await deleteSession(sessionId);
    await this.refreshSessions();
    if (this.sessions.length > 0) {
      await this.loadSession(this.sessions[0].id);
    } else {
      await this.createNewSession('Default Workspace');
    }
    const sessionModal = document.querySelector('.modal-backdrop');
    if (sessionModal) sessionModal.remove();
    this.ui.showToast('Session deleted', 'info');
  }

  async saveSessionSettings(session) {
    await updateSession(session);
    this.activeSession = session;
    await this.runReconciliation({ silent: true });
    this.ui.switchView(this.ui.currentView);
  }

  async loadSession(sessionId) {
    this.activeSession = await getSession(sessionId);
    if (!this.activeSession) return;

    await setActiveSessionId(sessionId);

    // Update top bar title
    const sessionLabel = document.getElementById('current-session-label');
    if (sessionLabel) {
      sessionLabel.textContent = this.activeSession.name;
    }

    // Load records
    this.invoices = await getInvoices(sessionId);
    this.payments = await getPayments(sessionId);
    this.allocations = await getAllocations(sessionId);

    // Balance recalculation
    recalculateAllBalances(this.invoices, this.payments, this.allocations);

    // Duplicates & Discrepancies
    this.duplicateResults = detectDuplicates(this.invoices, this.payments);
    this.discrepancies = auditDiscrepancies(this.invoices, this.payments, this.allocations);
    this.auditLogs = await getSessionAuditLogs(sessionId);

    this.ui.switchView(this.ui.currentView);
  }

  async handleInvoiceUpload(csvText, fileName) {
    if (!this.activeSession) return;
    try {
      const res = await importInvoiceCSV(this.activeSession.id, csvText, fileName);
      if (res.requiresMapping) {
        this.ui.openMappingWizardModal('invoice', res.headers, res.mapping, res.sampleRows, async (customMapping) => {
          const secondTry = await importInvoiceCSV(this.activeSession.id, csvText, fileName, customMapping);
          this.ui.showToast(`Successfully imported ${secondTry.importedCount} invoices`, 'success');
          await this.loadSession(this.activeSession.id);
        });
      } else {
        this.ui.showToast(`Successfully imported ${res.importedCount} invoices`, 'success');
        await this.loadSession(this.activeSession.id);
      }
    } catch (err) {
      this.ui.showToast('Failed to import invoices: ' + err.message, 'error');
    }
  }

  async handlePaymentUpload(csvText, fileName) {
    if (!this.activeSession) return;
    try {
      const res = await importPaymentCSV(this.activeSession.id, csvText, fileName);
      if (res.requiresMapping) {
        this.ui.openMappingWizardModal('payment', res.headers, res.mapping, res.sampleRows, async (customMapping) => {
          const secondTry = await importPaymentCSV(this.activeSession.id, csvText, fileName, customMapping);
          this.ui.showToast(`Successfully imported ${secondTry.importedCount} payments`, 'success');
          await this.loadSession(this.activeSession.id);
        });
      } else {
        this.ui.showToast(`Successfully imported ${res.importedCount} payments`, 'success');
        await this.loadSession(this.activeSession.id);
      }
    } catch (err) {
      this.ui.showToast('Failed to import payments: ' + err.message, 'error');
    }
  }

  async runReconciliation(options = {}) {
    if (!this.activeSession) return;
    const { silent = false } = options;

    const res = await executeReconciliation(this.activeSession.id, {
      autoApplyLevel1: true,
      dateToleranceDays: this.activeSession.settings?.dateToleranceDays || 30
    });

    this.invoices = res.invoices;
    this.payments = res.payments;
    this.allocations = res.allocations;
    this.suggestedMatches = res.stagedSuggestions;
    this.manualReviewQueue = res.manualReviewQueue;
    this.duplicateResults = res.duplicateResults;
    this.discrepancies = auditDiscrepancies(this.invoices, this.payments, this.allocations);
    this.auditLogs = await getSessionAuditLogs(this.activeSession.id);

    if (!silent) {
      this.ui.showToast(
        `Reconciliation complete: ${res.appliedAllocations.length} auto-matches applied, ${res.stagedSuggestions.length} suggestions ready.`,
        'success'
      );
    }

    this.ui.switchView(this.ui.currentView);
  }

  async allocatePayment(invoice, payment, amountPaise) {
    const validation = validateAllocation(invoice, payment, amountPaise, this.allocations);
    if (!validation.valid) {
      this.ui.showToast(validation.error || 'Allocation invalid', 'error');
      return;
    }

    const allocation = createAllocationRecord(
      this.activeSession.id,
      invoice,
      payment,
      amountPaise,
      'MANUAL',
      `Manual reconciliation by user`
    );

    await saveAllocation(allocation);
    this.allocations.push(allocation);

    recalculateAllBalances(this.invoices, this.payments, this.allocations);
    await saveInvoices(this.invoices);
    await savePayments(this.payments);

    await logAudit(
      this.activeSession.id,
      AUDIT_EVENT_TYPE.ALLOCATION_CREATED,
      `Allocated ₹${(amountPaise / 100).toFixed(2)} from payment ${payment.transaction_id} to invoice ${invoice.invoice_id}`,
      [invoice.invoice_id, payment.transaction_id],
      { amountPaise }
    );

    this.discrepancies = auditDiscrepancies(this.invoices, this.payments, this.allocations);
    this.auditLogs = await getSessionAuditLogs(this.activeSession.id);

    this.ui.showToast(`Allocated ₹${(amountPaise / 100).toFixed(2)} to ${invoice.invoice_id}`, 'success');
    this.ui.switchView(this.ui.currentView);
  }

  async excludeDuplicateRecord(recordId) {
    const pay = this.payments.find(p => p.id === recordId);
    if (!pay) return;

    pay.is_excluded = true;
    await savePayments(this.payments);

    await logAudit(
      this.activeSession.id,
      AUDIT_EVENT_TYPE.RECORD_EXCLUDED,
      `Excluded duplicate payment record ${pay.transaction_id} from reconciliation`,
      [pay.transaction_id]
    );

    await this.runReconciliation({ silent: true });
    this.ui.showToast(`Payment ${pay.transaction_id} excluded from reconciliation`, 'info');
  }

  async restoreExcludedRecord(recordId) {
    const pay = this.payments.find(p => p.id === recordId);
    if (!pay) return;

    pay.is_excluded = false;
    await savePayments(this.payments);

    await logAudit(
      this.activeSession.id,
      AUDIT_EVENT_TYPE.RECORD_RESTORED,
      `Restored excluded payment record ${pay.transaction_id} to active dataset`,
      [pay.transaction_id]
    );

    await this.runReconciliation({ silent: true });
    this.ui.showToast(`Payment ${pay.transaction_id} restored to dataset`, 'success');
  }

  async loadDemoDataset() {
    // Create new dedicated demo session
    const demoSession = await createSession('B2B Wholesale Demo Reconciliation', {
      isDemo: true,
      currency: 'INR',
      dateToleranceDays: 30
    });
    await this.refreshSessions();
    this.activeSession = demoSession;

    // Fetch demo CSVs
    const [invResp, payResp] = await Promise.all([
      fetch('/sample-data/demo-invoices.csv'),
      fetch('/sample-data/demo-payments.csv')
    ]);

    const invText = await invResp.text();
    const payText = await payResp.text();

    await importInvoiceCSV(demoSession.id, invText, 'demo-invoices.csv');
    await importPaymentCSV(demoSession.id, payText, 'demo-payments.csv');

    // Run reconciliation
    await this.loadSession(demoSession.id);
    await this.runReconciliation({ silent: true });

    this.ui.showToast('Loaded B2B Wholesale Demo Reconciliation dataset', 'success');
  }

  getState() {
    const invoicedPaise = this.invoices.reduce((sum, i) => sum + i.amount_paise, 0);
    const receivedPaise = this.payments.reduce((sum, p) => p.is_excluded ? sum : sum + p.amount_paise, 0);
    const allocatedPaise = this.invoices.reduce((sum, i) => sum + i.allocated_paise, 0);
    const outstandingPaise = this.invoices.reduce((sum, i) => sum + i.remaining_paise, 0);
    const reconciliationRate = calculatePercentage(allocatedPaise, invoicedPaise);

    return {
      session: this.activeSession,
      totals: {
        invoicedPaise,
        receivedPaise,
        allocatedPaise,
        outstandingPaise,
        invoiceCount: this.invoices.length,
        paymentCount: this.payments.length,
        reconciliationRate
      },
      suggestedMatches: this.suggestedMatches,
      manualReviewQueue: this.manualReviewQueue,
      duplicateResults: this.duplicateResults,
      discrepancies: this.discrepancies,
      auditLogs: this.auditLogs
    };
  }
}

// Instantiate and expose globally
const app = new LedgerMatchApp();
window.app = app;

document.addEventListener('DOMContentLoaded', () => {
  app.boot();
});
