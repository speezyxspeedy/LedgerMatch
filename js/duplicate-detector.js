/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * LedgerMatch — Duplicate Transaction Detector
 * Identifies exact and heuristic duplicate payments and invoices with non-destructive exclusion.
 */

import { calculateSimilarity } from './normalization.js';

export const DUPLICATE_SEVERITY = {
  EXACT: 'EXACT_DUPLICATE',
  POSSIBLE: 'POSSIBLE_DUPLICATE'
};

/**
 * Runs duplicate detection analysis on invoices and payments.
 * @param {Array<object>} invoices 
 * @param {Array<object>} payments 
 * @returns {{ duplicateInvoices: Array<object>, duplicatePayments: Array<object>, groups: Array<object> }}
 */
export function detectDuplicates(invoices = [], payments = []) {
  const groups = [];
  const dupInvoices = [];
  const dupPayments = [];

  // 1. Duplicate Invoice IDs
  const invIdMap = new Map();
  for (const inv of invoices) {
    const list = invIdMap.get(inv.invoice_id) || [];
    list.push(inv);
    invIdMap.set(inv.invoice_id, list);
  }

  for (const [invId, list] of invIdMap.entries()) {
    if (list.length > 1) {
      const group = {
        groupId: 'grp_inv_' + invId,
        type: 'INVOICE',
        severity: DUPLICATE_SEVERITY.EXACT,
        key: invId,
        reason: `Duplicate invoice ID "${invId}" found across ${list.length} records`,
        items: list
      };
      groups.push(group);
      dupInvoices.push(...list);
    }
  }

  // 2. Duplicate Transaction IDs in payments
  const payTxnMap = new Map();
  for (const pay of payments) {
    const list = payTxnMap.get(pay.transaction_id) || [];
    list.push(pay);
    payTxnMap.set(pay.transaction_id, list);
  }

  const processedPayIds = new Set();

  for (const [txnId, list] of payTxnMap.entries()) {
    if (list.length > 1) {
      const group = {
        groupId: 'grp_pay_txn_' + txnId,
        type: 'PAYMENT',
        severity: DUPLICATE_SEVERITY.EXACT,
        key: txnId,
        reason: `Identical transaction ID "${txnId}" repeated ${list.length} times in payment records`,
        items: list
      };
      groups.push(group);
      for (const p of list) {
        p.is_duplicate = true;
        p.duplicate_severity = DUPLICATE_SEVERITY.EXACT;
        p.duplicate_reason = group.reason;
        dupPayments.push(p);
        processedPayIds.add(p.id);
      }
    }
  }

  // 3. Heuristic Payment Duplicates: Same amount + date + similar payer (even with different txn_id)
  for (let i = 0; i < payments.length; i++) {
    const payA = payments[i];
    if (processedPayIds.has(payA.id)) continue;

    const similarBatch = [payA];

    for (let j = i + 1; j < payments.length; j++) {
      const payB = payments[j];
      if (processedPayIds.has(payB.id)) continue;

      // Amounts must match exactly
      if (payA.amount_paise !== payB.amount_paise) continue;
      // Currencies must match
      if (payA.currency !== payB.currency) continue;

      // Dates must be identical or within 1 calendar day
      const dateA = payA.payment_date;
      const dateB = payB.payment_date;
      const sameDate = dateA === dateB;

      // Customer name similarity
      const nameSim = calculateSimilarity(payA.payer_name, payB.payer_name);

      // Reference similarity
      const sameRef = payA.reference_id && payB.reference_id && payA.reference_id === payB.reference_id;

      if ((sameDate && nameSim >= 0.85) || sameRef) {
        similarBatch.push(payB);
      }
    }

    if (similarBatch.length > 1) {
      const isExactMatch = similarBatch.every(p => p.payer_name === payA.payer_name && p.payment_date === payA.payment_date);
      const severity = isExactMatch ? DUPLICATE_SEVERITY.EXACT : DUPLICATE_SEVERITY.POSSIBLE;
      const reason = isExactMatch
        ? `Identical payment amount (${payA.amount_paise / 100} ${payA.currency}), date (${payA.payment_date}), and payer`
        : `Potential duplicate: Same amount with matching date and similar payer name`;

      const group = {
        groupId: 'grp_pay_heur_' + payA.id,
        type: 'PAYMENT',
        severity,
        key: `${payA.amount_paise}_${payA.payment_date}`,
        reason,
        items: similarBatch
      };

      groups.push(group);

      // Mark the subsequent items as potential duplicates
      for (let k = 1; k < similarBatch.length; k++) {
        const item = similarBatch[k];
        item.is_duplicate = true;
        item.duplicate_severity = severity;
        item.duplicate_reason = reason;
        dupPayments.push(item);
        processedPayIds.add(item.id);
      }
      processedPayIds.add(payA.id);
    }
  }

  return {
    duplicateInvoices: dupInvoices,
    duplicatePayments: dupPayments,
    groups
  };
}
