/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Discrepancy & Exception Detection Engine
 * Flags root-cause accounting discrepancies with expected vs actual values,
 * impact analysis, and resolution tracking.
 */

import { formatMoney } from './money-utils.js';
import { getDaysDifference } from './normalization.js';

export const DISCREPANCY_TYPES = {
  EXCESS_PAYMENT: 'EXCESS_PAYMENT',
  PARTIAL_PAYMENT: 'PARTIAL_PAYMENT',
  UNALLOCATED_PAYMENT: 'UNALLOCATED_PAYMENT',
  UNPAID_OVERDUE: 'UNPAID_OVERDUE',
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
  DATE_ANOMALY: 'DATE_ANOMALY',
  MISSING_REFERENCE: 'MISSING_REFERENCE'
};

/**
 * Analyzes current session state and returns active discrepancy records.
 * @param {Array<object>} invoices 
 * @param {Array<object>} payments 
 * @param {Array<object>} allocations 
 * @returns {Array<object>} List of discrepancy objects
 */
export function auditDiscrepancies(invoices = [], payments = [], allocations = []) {
  const discrepancies = [];
  const today = new Date().toISOString().slice(0, 10);

  // 1. Invoices: Check for Overpaid, Partial, and Overdue
  for (const inv of invoices) {
    if (inv.status === 'OVERPAID') {
      const excessPaise = inv.allocated_paise - inv.amount_paise;
      discrepancies.push({
        id: 'disc_over_' + inv.invoice_id,
        type: DISCREPANCY_TYPES.EXCESS_PAYMENT,
        title: `Overpaid Invoice: ${inv.invoice_id}`,
        recordId: inv.invoice_id,
        recordType: 'INVOICE',
        expectedValue: formatMoney(inv.amount_paise, inv.currency),
        actualValue: formatMoney(inv.allocated_paise, inv.currency),
        difference: `+${formatMoney(excessPaise, inv.currency)}`,
        explanation: `Invoice total is ${formatMoney(inv.amount_paise, inv.currency)}, but total allocated payments equal ${formatMoney(inv.allocated_paise, inv.currency)}. Excess funds must be refunded or carried forward as customer credit.`,
        suggestedAction: 'Issue credit memo or adjust payment allocation',
        severity: 'HIGH',
        status: inv._disc_status || 'OPEN'
      });
    } else if (inv.status === 'PARTIALLY_PAID') {
      discrepancies.push({
        id: 'disc_part_' + inv.invoice_id,
        type: DISCREPANCY_TYPES.PARTIAL_PAYMENT,
        title: `Incomplete Settlement: ${inv.invoice_id}`,
        recordId: inv.invoice_id,
        recordType: 'INVOICE',
        expectedValue: formatMoney(inv.amount_paise, inv.currency),
        actualValue: formatMoney(inv.allocated_paise, inv.currency),
        difference: `-${formatMoney(inv.remaining_paise, inv.currency)} remaining`,
        explanation: `Invoice of ${formatMoney(inv.amount_paise, inv.currency)} for "${inv.customer_name}" has received ${formatMoney(inv.allocated_paise, inv.currency)}, leaving ${formatMoney(inv.remaining_paise, inv.currency)} unpaid.`,
        suggestedAction: 'Request remainder settlement or link secondary tranche',
        severity: 'MEDIUM',
        status: inv._disc_status || 'OPEN'
      });
    }

    // Overdue unpaid check
    if (inv.due_date && inv.remaining_paise > 0) {
      const daysOverdue = getDaysDifference(inv.due_date, today);
      if (daysOverdue !== null && daysOverdue > 0) {
        discrepancies.push({
          id: 'disc_due_' + inv.invoice_id,
          type: DISCREPANCY_TYPES.UNPAID_OVERDUE,
          title: `Overdue Invoice: ${inv.invoice_id} (${daysOverdue} days)`,
          recordId: inv.invoice_id,
          recordType: 'INVOICE',
          expectedValue: `Paid by ${inv.due_date}`,
          actualValue: `Unpaid as of ${today}`,
          difference: formatMoney(inv.remaining_paise, inv.currency),
          explanation: `Invoice is past due date ${inv.due_date} by ${daysOverdue} days with an outstanding balance of ${formatMoney(inv.remaining_paise, inv.currency)}.`,
          suggestedAction: 'Initiate collection notice or dunning follow-up',
          severity: daysOverdue > 30 ? 'HIGH' : 'MEDIUM',
          status: inv._disc_status || 'OPEN'
        });
      }
    }
  }

  // 2. Payments: Check for Unallocated and Duplicates
  for (const pay of payments) {
    if (pay.is_excluded) continue;

    if (pay.status === 'UNALLOCATED') {
      discrepancies.push({
        id: 'disc_unalloc_' + pay.transaction_id,
        type: DISCREPANCY_TYPES.UNALLOCATED_PAYMENT,
        title: `Unapplied Payment: ${pay.transaction_id}`,
        recordId: pay.transaction_id,
        recordType: 'PAYMENT',
        expectedValue: 'Allocated to valid sales invoice',
        actualValue: `${formatMoney(pay.amount_paise, pay.currency)} completely unallocated`,
        difference: formatMoney(pay.amount_paise, pay.currency),
        explanation: `Payment of ${formatMoney(pay.amount_paise, pay.currency)} received on ${pay.payment_date} from "${pay.payer_name}" has not been matched or linked to any open invoice.`,
        suggestedAction: 'Search open customer invoices in Manual Review workspace',
        severity: 'MEDIUM',
        status: pay._disc_status || 'OPEN'
      });
    }

    if (pay.is_duplicate) {
      discrepancies.push({
        id: 'disc_dup_' + pay.transaction_id,
        type: DISCREPANCY_TYPES.DUPLICATE_TRANSACTION,
        title: `Suspected Duplicate: ${pay.transaction_id}`,
        recordId: pay.transaction_id,
        recordType: 'PAYMENT',
        expectedValue: 'Unique transaction record',
        actualValue: 'Repeated transaction ID or identical payment attributes',
        difference: formatMoney(pay.amount_paise, pay.currency),
        explanation: pay.duplicate_reason || 'Repeated payment detected in transaction records',
        suggestedAction: 'Review and exclude duplicate or verify legitimate secondary transfer',
        severity: 'HIGH',
        status: pay._disc_status || 'OPEN'
      });
    }
  }

  return discrepancies;
}
